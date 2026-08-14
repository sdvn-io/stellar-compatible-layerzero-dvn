import "dotenv/config";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { z } from "zod";
import {
  Address,
  BASE_FEE,
  Contract as StellarContract,
  Keypair,
  Networks,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  scvSortedMap,
  xdr,
} from "@stellar/stellar-sdk";
import {
  Contract,
  FetchRequest,
  Interface,
  JsonRpcProvider,
  SigningKey,
  Wallet,
  ZeroHash,
  concat,
  getBytes,
  hexlify,
  keccak256,
  toUtf8String,
} from "ethers";
import { config } from "./config.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const stellarRpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const stellarServer = new rpc.Server(stellarRpcUrl);
const evmRequest = new FetchRequest(sepoliaRpcUrl);
evmRequest.timeout = 15_000;
const evmProvider = new JsonRpcProvider(
  evmRequest,
  { chainId: config.sepolia.chainId, name: "sepolia" },
  { staticNetwork: true },
);
const OPTIONS = getBytes(config.options);

const evmOappAbi = [
  "function receivedMessageCount() view returns (uint64)",
  "function lastMessage() view returns (string)",
];
const endpointAbi = [
  "function lzReceive((uint32 srcEid,bytes32 sender,uint64 nonce) origin,address receiver,bytes32 guid,bytes message,bytes extraData) payable",
  "function lazyInboundNonce(address receiver,uint32 srcEid,bytes32 sender) view returns (uint64)",
  "function inboundPayloadHash(address receiver,uint32 srcEid,bytes32 sender,uint64 nonce) view returns (bytes32)",
];
const receiveUlnAbi = [
  "function verify(bytes packetHeader,bytes32 payloadHash,uint64 confirmations)",
  "function commitVerification(bytes packetHeader,bytes32 payloadHash)",
];
const packetSentInterface = new Interface([
  "event PacketSent(bytes encodedPayload,bytes options,address sendLibrary)",
]);

type RelayJob = {
  status: "running" | "complete" | "failed";
  stage: string;
  progress: number;
  result?: unknown;
  error?: string;
};
const relayJobs = new Map<string, RelayJob>();
let stellarInboundQueue = Promise.resolve();

function requireRelayers() {
  const evmSecret = process.env.EVM_PRIVATE_KEY;
  const stellarSecret = process.env.STELLAR_RELAYER_SECRET;
  if (!evmSecret || !stellarSecret) {
    throw new Error("Relay is not configured: EVM_PRIVATE_KEY and STELLAR_RELAYER_SECRET are required");
  }
  const evm = new Wallet(evmSecret, evmProvider);
  const stellar = Keypair.fromSecret(stellarSecret);
  if (evm.address.toLowerCase() !== config.sepolia.verifier.toLowerCase()) {
    throw new Error(`Wrong EVM relay key: loaded ${evm.address}, expected configured verifier ${config.sepolia.verifier}`);
  }
  if (stellar.publicKey() !== config.stellar.relayer) {
    throw new Error(`Wrong Stellar relay key: loaded ${stellar.publicKey()}, expected configured DVN admin ${config.stellar.relayer}`);
  }
  return {
    evm,
    stellar,
    evmSecret,
  };
}

function field(name: string, value: xdr.ScVal) {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val: value });
}

function struct(entries: [string, xdr.ScVal][]) {
  return scvSortedMap(entries.map(([name, value]) => field(name, value)));
}

function call(to: string, func: string, args: xdr.ScVal[]) {
  return struct([
    ["to", Address.fromString(to).toScVal()],
    ["func", xdr.ScVal.scvSymbol(func)],
    ["args", xdr.ScVal.scvVec(args)],
  ]);
}

function parsePacket(encodedPacket: string) {
  const packet = getBytes(encodedPacket);
  if (packet.length < 113 || packet[0] !== 1) throw new Error("Invalid LayerZero V1 packet");
  const header = packet.slice(0, 81);
  return {
    packet,
    header,
    nonce: BigInt(hexlify(packet.slice(1, 9))),
    srcEid: Number(BigInt(hexlify(packet.slice(9, 13)))),
    sender: hexlify(packet.slice(13, 45)),
    dstEid: Number(BigInt(hexlify(packet.slice(45, 49)))),
    receiver: hexlify(packet.slice(49, 81)),
    guid: hexlify(packet.slice(81, 113)),
    message: hexlify(packet.slice(113)),
    payloadHash: keccak256(packet.slice(81)),
  };
}

async function waitStellar(hash: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await stellarServer.getTransaction(hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return result;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`Stellar transaction failed: ${hash}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for Stellar transaction ${hash}`);
}

async function sendStellar(operation: xdr.Operation, signer: Keypair) {
  const account = await stellarServer.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(operation).setTimeout(90).build();
  const simulation = await stellarServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) throw new Error(simulation.error);
  const assembled = rpc.assembleTransaction(tx, simulation).build();
  assembled.sign(signer);
  const submitted = await stellarServer.sendTransaction(assembled);
  if (submitted.status === "ERROR") throw new Error("Stellar RPC rejected transaction");
  await waitStellar(submitted.hash);
  return submitted.hash;
}

async function simulateReturn(operation: xdr.Operation, source: Keypair | string) {
  const publicKey = typeof source === "string" ? source : source.publicKey();
  const account = await stellarServer.getAccount(publicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(operation).setTimeout(90).build();
  const simulation = await stellarServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result?.retval) {
    throw new Error(rpc.Api.isSimulationError(simulation) ? simulation.error : "Missing simulation return value");
  }
  return simulation.result.retval;
}

async function rawStellarTransaction(hash: string) {
  const response = await fetch(stellarRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash } }),
  });
  const body = await response.json() as { result?: { events?: { contractEventsXdr?: unknown } } };
  return body.result;
}

async function extractStellarPacket(hash: string) {
  const result = await rawStellarTransaction(hash);
  const nested = result?.events?.contractEventsXdr;
  const values: string[] = [];
  const flatten = (value: unknown) => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(flatten);
  };
  flatten(nested);
  for (const value of values) {
    const event = xdr.ContractEvent.fromXDR(value, "base64");
    const body = event.body().v0();
    const topics = body.topics().map((topic) => scValToNative(topic));
    if (topics[0] !== "packet_sent") continue;
    const data = scValToNative(body.data()) as Record<string, unknown>;
    const packet = data.encoded_packet;
    if (Buffer.isBuffer(packet) || packet instanceof Uint8Array) return hexlify(packet);
  }
  throw new Error(`PacketSent event not found in Stellar transaction ${hash}`);
}

type StellarEvent = { txHash: string; value: string };

async function stellarPacketBacklog(target: ReturnType<typeof parsePacket>) {
  const packets = new Map<bigint, { encodedPacket: string; sourceTx: string }>();
  let cursor: string | undefined;
  do {
    const response = await fetch(stellarRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getEvents", params: {
          startLedger: config.stellar.scanStartLedger,
          filters: [{ type: "contract", contractIds: [config.stellar.endpoint] }],
          pagination: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      }),
    });
    const body = await response.json() as { error?: { message?: string }; result?: { events?: StellarEvent[]; cursor?: string } };
    if (body.error) throw new Error(`Stellar event scan failed: ${body.error.message ?? "unknown RPC error"}`);
    const events = body.result?.events ?? [];
    for (const event of events) {
      const native = scValToNative(xdr.ScVal.fromXDR(event.value, "base64")) as Record<string, unknown>;
      const bytes = native.encoded_packet;
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) continue;
      const encodedPacket = hexlify(bytes);
      const packet = parsePacket(encodedPacket);
      if (
        packet.srcEid === target.srcEid && packet.dstEid === target.dstEid &&
        packet.sender.toLowerCase() === target.sender.toLowerCase() &&
        packet.receiver.toLowerCase() === target.receiver.toLowerCase() &&
        packet.nonce <= target.nonce
      ) packets.set(packet.nonce, { encodedPacket, sourceTx: event.txHash });
    }
    const next = body.result?.cursor;
    cursor = events.length === 100 && next && next !== cursor ? next : undefined;
  } while (cursor);
  return packets;
}

async function evmPacket(hash: string) {
  const receipt = await evmProvider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1) throw new Error("Sepolia source transaction is not successful");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.sepolia.endpoint.toLowerCase()) continue;
    try {
      const parsed = packetSentInterface.parseLog(log);
      if (parsed?.name === "PacketSent") return parsed.args.encodedPayload as string;
    } catch { /* unrelated endpoint event */ }
  }
  throw new Error("PacketSent event not found in Sepolia receipt");
}

async function evmPacketBacklog(target: ReturnType<typeof parsePacket>) {
  const packets = new Map<bigint, { encodedPacket: string; sourceTx: string }>();
  const latest = await evmProvider.getBlockNumber();
  const packetSentEvent = packetSentInterface.getEvent("PacketSent");
  if (!packetSentEvent) throw new Error("PacketSent ABI is unavailable");
  const topic = packetSentEvent.topicHash;
  for (let fromBlock = config.sepolia.scanStartBlock; fromBlock <= latest; fromBlock += 10_000) {
    const logs = await evmProvider.getLogs({
      address: config.sepolia.endpoint,
      topics: [topic],
      fromBlock,
      toBlock: Math.min(fromBlock + 9_999, latest),
    });
    for (const log of logs) {
      const parsed = packetSentInterface.parseLog(log);
      if (parsed?.name !== "PacketSent") continue;
      const encodedPacket = parsed.args.encodedPayload as string;
      const packet = parsePacket(encodedPacket);
      if (
        packet.srcEid === target.srcEid && packet.dstEid === target.dstEid &&
        packet.sender.toLowerCase() === target.sender.toLowerCase() &&
        packet.receiver.toLowerCase() === target.receiver.toLowerCase() &&
        packet.nonce <= target.nonce
      ) packets.set(packet.nonce, { encodedPacket, sourceTx: log.transactionHash });
    }
  }
  return packets;
}

function validateStellarMessage(signedXdr: string) {
  const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  if (tx.operations.length !== 1) throw new Error("The Stellar transaction must contain exactly one operation");
  const operation = tx.operations[0];
  if (operation.type !== "invokeHostFunction") throw new Error("Only a Soroban message invocation can be submitted");
  if (operation.func.switch().name !== "hostFunctionTypeInvokeContract") throw new Error("Only a direct contract invocation can be submitted");
  const invocation = operation.func.invokeContract();
  const contractId = hexlify(Uint8Array.from(invocation.contractAddress().contractId() as unknown as number[]));
  const expectedId = hexlify(Uint8Array.from(Address.fromString(config.stellar.oapp).toScAddress().contractId() as unknown as number[]));
  if (contractId.toLowerCase() !== expectedId.toLowerCase() || invocation.functionName().toString() !== "send_message") {
    throw new Error("The signed transaction does not call send_message on the configured Stellar OApp");
  }
  return tx;
}

async function attestOnStellar(encodedPacket: string, relayer: Keypair, evmSecret: string) {
  const packet = parsePacket(encodedPacket);
  if (packet.srcEid !== config.sepolia.eid || packet.dstEid !== config.stellar.eid) throw new Error("Packet EID mismatch");
  const dvn = new StellarContract(config.stellar.dvn);
  const verifyArgs = [
    Address.fromString(config.stellar.dvn).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(packet.header)),
    xdr.ScVal.scvBytes(Buffer.from(getBytes(packet.payloadHash))),
    nativeToScVal(2n, { type: "u64" }),
  ];
  const innerCalls = xdr.ScVal.scvVec([call(config.stellar.uln302, "verify", verifyArgs)]);
  const authCalls = xdr.ScVal.scvVec([call(config.stellar.dvn, "execute_transaction", [innerCalls])]);
  const expiration = BigInt(Math.floor(Date.now() / 1000) + 600);
  const callHashVal = await simulateReturn(dvn.call(
    "hash_call_data", nativeToScVal(10600, { type: "u32" }), nativeToScVal(expiration, { type: "u64" }), authCalls,
  ), relayer);
  const secp = new SigningKey(evmSecret).sign(hexlify(callHashVal.bytes()));
  const secpSignature = getBytes(concat([secp.r, secp.s, new Uint8Array([27 + secp.yParity])]));

  const account = await stellarServer.getAccount(relayer.publicKey());
  const bare = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(dvn.call("execute_transaction", innerCalls)).setTimeout(90).build();
  const firstSimulation = await stellarServer.simulateTransaction(bare);
  if (rpc.Api.isSimulationError(firstSimulation)) throw new Error(firstSimulation.error);
  const assembled = rpc.assembleTransaction(bare, firstSimulation).build();
  const operation = assembled.operations[0];
  if (operation.type !== "invokeHostFunction" || !operation.auth?.[0]) throw new Error("DVN auth entry missing");
  const sender = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Admin"),
    xdr.ScVal.scvBytes(relayer.rawPublicKey()),
    xdr.ScVal.scvBytes(Buffer.alloc(64)),
  ]);
  const latest = await stellarServer.getLatestLedger();
  const signedAuth = await authorizeEntry(operation.auth[0], async (_preimage, payload) => {
    const signedSender = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Admin"), xdr.ScVal.scvBytes(relayer.rawPublicKey()), xdr.ScVal.scvBytes(relayer.sign(payload)),
    ]);
    return { address: config.stellar.dvn, signatureScVal: struct([
      ["vid", nativeToScVal(10600, { type: "u32" })],
      ["expiration", nativeToScVal(expiration, { type: "u64" })],
      ["signatures", xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(secpSignature))])],
      ["sender", signedSender],
    ]) };
  }, latest.sequence + 100, Networks.TESTNET, config.stellar.dvn);
  void sender;
  operation.auth[0] = signedAuth;
  const authenticatedSimulation = await stellarServer.simulateTransaction(assembled);
  if (rpc.Api.isSimulationError(authenticatedSimulation)) throw new Error(authenticatedSimulation.error);
  const finalTx = rpc.assembleTransaction(assembled, authenticatedSimulation).build();
  const finalOp = finalTx.operations[0];
  if (finalOp.type !== "invokeHostFunction" || !finalOp.auth) throw new Error("Final DVN auth missing");
  finalOp.auth[0] = signedAuth;
  finalTx.sign(relayer);
  const submitted = await stellarServer.sendTransaction(finalTx);
  if (submitted.status === "ERROR") throw new Error("DVN attestation submission failed");
  await waitStellar(submitted.hash);
  return { hash: submitted.hash, packet };
}

function links(source: { chain: "stellar" | "sepolia"; hash: string }, verify: string, commit: string, destination: { chain: "stellar" | "sepolia"; hash: string }) {
  const explorer = (chain: "stellar" | "sepolia", hash: string) => chain === "stellar" ? config.stellar.explorer + hash : config.sepolia.explorer + hash;
  return [
    { label: "Source transaction", hash: source.hash, url: explorer(source.chain, source.hash) },
    { label: "DVN verification", hash: verify, url: explorer(destination.chain, verify) },
    { label: "ULN commit", hash: commit, url: explorer(destination.chain, commit) },
    { label: "Destination execution", hash: destination.hash, url: explorer(destination.chain, destination.hash) },
    { label: "LayerZero Scan", hash: source.hash, url: config.layerZeroScan + source.hash },
  ];
}

app.get("/api/config", (_req, res) => res.json({
  stellar: { eid: config.stellar.eid, oapp: config.stellar.oapp, explorer: config.stellar.explorer },
  sepolia: { eid: config.sepolia.eid, chainId: config.sepolia.chainId, oapp: config.sepolia.oapp, explorer: config.sepolia.explorer },
  layerZeroScan: config.layerZeroScan,
  options: config.options,
}));

app.post("/api/stellar/prepare", async (req, res, next) => {
  try {
    const { address, message } = z.object({
      address: z.string().min(56).max(56),
      message: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= 256, "Message must be at most 256 UTF-8 bytes"),
    }).parse(req.body);
    const oapp = new StellarContract(config.stellar.oapp);
    const messageBytes = Buffer.from(message, "utf8");
    const quote = await simulateReturn(oapp.call(
      "quote", nativeToScVal(config.sepolia.eid, { type: "u32" }), xdr.ScVal.scvBytes(messageBytes),
      xdr.ScVal.scvBytes(Buffer.from(OPTIONS)), xdr.ScVal.scvBool(false),
    ), address);
    const fee = scValToNative(quote) as { native_fee: bigint; zro_fee: bigint };
    const account = await stellarServer.getAccount(address);
    const operation = oapp.call(
      "send_message", Address.fromString(address).toScVal(), nativeToScVal(config.sepolia.eid, { type: "u32" }),
      xdr.ScVal.scvBytes(messageBytes), xdr.ScVal.scvBytes(Buffer.from(OPTIONS)),
      struct([["native_fee", nativeToScVal(fee.native_fee, { type: "i128" })], ["zro_fee", nativeToScVal(fee.zro_fee, { type: "i128" })]]),
    );
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).addOperation(operation).setTimeout(120).build();
    const simulation = await stellarServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) throw new Error(simulation.error);
    const assembled = rpc.assembleTransaction(tx, simulation).build();
    res.json({ xdr: assembled.toXDR(), fee: fee.native_fee.toString() });
  } catch (error) { next(error); }
});

app.post("/api/stellar/submit", async (req, res, next) => {
  try {
    const { signedXdr } = z.object({ signedXdr: z.string().min(20) }).parse(req.body);
    const tx = validateStellarMessage(signedXdr);
    const submitted = await stellarServer.sendTransaction(tx);
    if (submitted.status === "ERROR") throw new Error("Stellar RPC rejected the wallet-signed transaction");
    await waitStellar(submitted.hash);
    res.json({ sourceTx: submitted.hash, encodedPacket: await extractStellarPacket(submitted.hash) });
  } catch (error) { next(error); }
});

const stellarRelayInput = z.object({ sourceTx: z.string().length(64), encodedPacket: z.string().startsWith("0x").optional() });

async function relayStellarToSepolia(
  input: z.infer<typeof stellarRelayInput>,
  update: (stage: string, progress: number) => void = () => undefined,
) {
    update("Validating canonical Stellar packet", 2);
    const { evm } = requireRelayers();
    const canonicalPacket = await extractStellarPacket(input.sourceTx);
    if (input.encodedPacket && canonicalPacket.toLowerCase() !== input.encodedPacket.toLowerCase()) throw new Error("Packet does not match the confirmed Stellar source transaction");
    const packet = parsePacket(canonicalPacket);
    const expectedReceiver = hexlify(getBytes(config.sepolia.oapp).reduce((a, b, i) => { a[i + 12] = b; return a; }, new Uint8Array(32)));
    if (packet.srcEid !== config.stellar.eid || packet.dstEid !== config.sepolia.eid || packet.receiver.toLowerCase() !== expectedReceiver.toLowerCase()) throw new Error("Packet route validation failed");
    const uln = new Contract(config.sepolia.receiveUln302, receiveUlnAbi, evm);
    const endpoint = new Contract(config.sepolia.endpoint, endpointAbi, evm);
    const currentNonce = BigInt(await endpoint.lazyInboundNonce(config.sepolia.oapp, packet.srcEid, packet.sender));
    update(`Scanning Stellar backlog after nonce ${currentNonce}`, 2);
    const backlog = await stellarPacketBacklog(packet);
    const recoveryLinks: { label: string; hash: string; url: string }[] = [];
    let verifyHash = "";
    let commitHash = "";
    for (let nonce = currentNonce + 1n; nonce <= packet.nonce; nonce += 1n) {
      const entry = backlog.get(nonce);
      if (!entry) throw new Error(`Cannot recover LayerZero nonce ${nonce}: matching Stellar packet_sent event was not found`);
      const pending = parsePacket(entry.encodedPacket);
      const existingPayload = await endpoint.inboundPayloadHash(config.sepolia.oapp, pending.srcEid, pending.sender, nonce);
      if (existingPayload !== ZeroHash) {
        update(`Nonce ${nonce} already committed; continuing`, 4);
        continue;
      }
      update(`Verifying LayerZero nonce ${nonce} of ${packet.nonce}`, 2);
      const verify = await uln.verify(hexlify(pending.header), pending.payloadHash, 1); await verify.wait();
      update(`DVN verified nonce ${nonce}; committing to ULN302`, 3);
      const commit = await uln.commitVerification(hexlify(pending.header), pending.payloadHash); await commit.wait();
      update(`ULN302 committed nonce ${nonce} of ${packet.nonce}`, 4);
      verifyHash = verify.hash;
      commitHash = commit.hash;
      if (nonce < packet.nonce) recoveryLinks.push({
        label: `Backfilled nonce ${nonce}`,
        hash: commit.hash,
        url: config.sepolia.explorer + commit.hash,
      });
    }
    if (!verifyHash || !commitHash) throw new Error("This LayerZero packet nonce has already been cleared");
    const oapp = new Contract(config.sepolia.oapp, evmOappAbi, evm);
    const before = await oapp.receivedMessageCount();
    update(`Executing nonce ${packet.nonce} on Sepolia`, 4);
    const execute = await endpoint.lzReceive({ srcEid: packet.srcEid, sender: packet.sender, nonce: packet.nonce }, config.sepolia.oapp, packet.guid, packet.message, "0x"); await execute.wait();
    const count = await oapp.receivedMessageCount();
    if (count !== before + 1n) throw new Error("Sepolia received-message count did not increment");
    const message = await oapp.lastMessage() as string;
    if (message !== toUtf8String(packet.message)) throw new Error("Sepolia stored message does not match the canonical packet");
    update("Delivered on Sepolia", 5);
    return { sourceTx: input.sourceTx, destinationTx: execute.hash, guid: packet.guid, message, receivedCount: count.toString(), links: [...recoveryLinks, ...links({ chain: "stellar", hash: input.sourceTx }, verifyHash, commitHash, { chain: "sepolia", hash: execute.hash })] };
}

app.post("/api/relay/stellar-to-sepolia", async (req, res, next) => {
  try {
    res.json(await relayStellarToSepolia(stellarRelayInput.parse(req.body)));
  } catch (error) { next(error); }
});

app.post("/api/relay/stellar-to-sepolia/start", (req, res, next) => {
  try {
    const input = stellarRelayInput.parse(req.body);
    const id = randomUUID();
    const job: RelayJob = { status: "running", stage: "Queued for verification", progress: 2 };
    relayJobs.set(id, job);
    void relayStellarToSepolia(input, (stage, progress) => Object.assign(job, { stage, progress }))
      .then((result) => Object.assign(job, { status: "complete", stage: "Delivered", progress: 5, result }))
      .catch((error: unknown) => {
        console.error(error);
        Object.assign(job, { status: "failed", stage: "Relay failed", error: error instanceof Error ? error.message : String(error) });
      });
    res.status(202).json({ jobId: id });
  } catch (error) { next(error); }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = relayJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Relay job not found (the server may have restarted)" });
  res.json(job);
});

app.post("/api/relay/sepolia-to-stellar", async (req, res, next) => {
  try {
    const { sourceTx } = z.object({ sourceTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.body);
    const previous = stellarInboundQueue;
    let unlock: () => void = () => undefined;
    stellarInboundQueue = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
    const { stellar, evmSecret } = requireRelayers();
    const encodedPacket = await evmPacket(sourceTx);
    const packet = parsePacket(encodedPacket);
    if (packet.srcEid !== config.sepolia.eid || packet.dstEid !== config.stellar.eid) throw new Error("Packet EID mismatch");
    const uln = new StellarContract(config.stellar.uln302);
    const endpoint = new StellarContract(config.stellar.endpoint);
    const oapp = new StellarContract(config.stellar.oapp);
    const inboundNonce = BigInt(scValToNative(await simulateReturn(endpoint.call(
      "inbound_nonce", Address.fromString(config.stellar.oapp).toScVal(), nativeToScVal(packet.srcEid, { type: "u32" }),
      xdr.ScVal.scvBytes(Buffer.from(getBytes(packet.sender))),
    ), stellar)));
    const backlog = await evmPacketBacklog(packet);
    const firstNonce = inboundNonce < packet.nonce ? inboundNonce + 1n : packet.nonce;
    const recoveryLinks: { label: string; hash: string; url: string }[] = [];
    let targetVerify = "";
    let targetCommit = "";
    let targetExecute = "";
    let targetCount = 0n;
    let targetMessage = "";

    for (let nonce = firstNonce; nonce <= packet.nonce; nonce += 1n) {
      const entry = nonce === packet.nonce ? { encodedPacket, sourceTx } : backlog.get(nonce);
      if (!entry) throw new Error(`Cannot recover LayerZero nonce ${nonce}: matching Sepolia PacketSent log was not found`);
      const pending = parsePacket(entry.encodedPacket);
      const { hash: verify } = await attestOnStellar(entry.encodedPacket, stellar, evmSecret);
      const commit = await sendStellar(uln.call(
        "commit_verification", xdr.ScVal.scvBytes(Buffer.from(pending.header)),
        xdr.ScVal.scvBytes(Buffer.from(getBytes(pending.payloadHash))),
      ), stellar);
      const before = BigInt(scValToNative(await simulateReturn(oapp.call("received_message_count"), stellar)));
      const execute = await sendStellar(oapp.call(
        "lz_receive", Address.fromString(stellar.publicKey()).toScVal(),
        struct([["nonce", nativeToScVal(pending.nonce, { type: "u64" })], ["sender", xdr.ScVal.scvBytes(Buffer.from(getBytes(pending.sender)))], ["src_eid", nativeToScVal(pending.srcEid, { type: "u32" })]]),
        xdr.ScVal.scvBytes(Buffer.from(getBytes(pending.guid))), xdr.ScVal.scvBytes(Buffer.from(getBytes(pending.message))),
        xdr.ScVal.scvBytes(Buffer.from([0])), nativeToScVal(0n, { type: "i128" }),
      ), stellar);
      const count = BigInt(scValToNative(await simulateReturn(oapp.call("received_message_count"), stellar)));
      if (count !== before + 1n) throw new Error(`Stellar received-message count did not increment for nonce ${nonce}`);
      const stored = scValToNative(await simulateReturn(oapp.call("last_message"), stellar));
      const storedBytes = Buffer.isBuffer(stored) || stored instanceof Uint8Array ? stored : Buffer.from(stored as number[]);
      const message = storedBytes.toString("utf8");
      if (message !== toUtf8String(pending.message)) throw new Error(`Stellar stored message does not match nonce ${nonce}`);
      if (nonce < packet.nonce) {
        recoveryLinks.push(
          { label: `Recovered nonce ${nonce} source`, hash: entry.sourceTx, url: config.sepolia.explorer + entry.sourceTx },
          { label: `Recovered nonce ${nonce} execution`, hash: execute, url: config.stellar.explorer + execute },
        );
      } else {
        targetVerify = verify;
        targetCommit = commit;
        targetExecute = execute;
        targetCount = count;
        targetMessage = message;
      }
    }
    res.json({
      sourceTx, destinationTx: targetExecute, guid: packet.guid, message: targetMessage, receivedCount: targetCount.toString(),
      links: [...recoveryLinks, ...links({ chain: "sepolia", hash: sourceTx }, targetVerify, targetCommit, { chain: "stellar", hash: targetExecute })],
    });
    } finally {
      unlock();
    }
  } catch (error) { next(error); }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
});

app.listen(Number(process.env.PORT ?? 8787), () => {
  console.log(`Relay API listening on http://localhost:${process.env.PORT ?? 8787}`);
});
