import "dotenv/config";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scvSortedMap,
  xdr,
} from "@stellar/stellar-sdk";
import { Interface, SigningKey, concat, getBytes, hexlify, keccak256 } from "ethers";
import networks from "../config/networks.json";

const SOURCE_TX_HASH = process.env.SOURCE_TX_HASH;
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
if (!SOURCE_TX_HASH || !EVM_PRIVATE_KEY) {
  throw new Error("SOURCE_TX_HASH and EVM_PRIVATE_KEY are required");
}

const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const IDENTITY_PATH = process.env.STELLAR_IDENTITY_PATH ?? ".stellar/identity/dvn-deployer.toml";
const identity = readFileSync(IDENTITY_PATH, "utf8");
const storedSecret = identity.match(/secret_key\s*=\s*"([A-Z0-9]+)"/)?.[1];
const secret = storedSecret ?? execFileSync(
  "/home/tinkerpal/.cargo/bin/stellar",
  ["keys", "secret", "dvn-deployer", "--config-dir", ".stellar"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
).trim();

const source = Keypair.fromSecret(secret);
const server = new rpc.Server(RPC_URL);
const dvn = new Contract(networks.stellarTestnet.testProviderDvn);
const uln = new Contract(networks.stellarTestnet.uln302);
const endpoint = new Contract(networks.stellarTestnet.endpointV2);
const receiver = networks.stellarTestnet.receiverOApp;

function field(name: string, value: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val: value });
}

function call(to: string, func: string, args: xdr.ScVal[]): xdr.ScVal {
  return scvSortedMap([
    field("to", Address.fromString(to).toScVal()),
    field("func", xdr.ScVal.scvSymbol(func)),
    field("args", xdr.ScVal.scvVec(args)),
  ]);
}

function senderAdmin(publicKey: Uint8Array, signature: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Admin"),
    xdr.ScVal.scvBytes(Buffer.from(publicKey)),
    xdr.ScVal.scvBytes(Buffer.from(signature)),
  ]);
}

function authData(
  expiration: bigint,
  secpSignature: Uint8Array,
  adminPayloadSignature: Uint8Array,
): xdr.ScVal {
  return scvSortedMap([
    field("vid", nativeToScVal(10600, { type: "u32" })),
    field("expiration", nativeToScVal(expiration, { type: "u64" })),
    field("signatures", xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(secpSignature))])),
    field("sender", senderAdmin(source.rawPublicKey(), adminPayloadSignature)),
  ]);
}

async function simulateReturn(operation: xdr.Operation): Promise<xdr.ScVal> {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
  const value = sim.result?.retval;
  if (!value) throw new Error("simulation returned no value");
  return value;
}

async function sourcePacket(): Promise<{ header: Uint8Array; payloadHash: Uint8Array }> {
  const provider = new (await import("ethers")).JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const receipt = await provider.getTransactionReceipt(SOURCE_TX_HASH!);
  if (!receipt) throw new Error("source receipt not found");
  const iface = new Interface(["event PacketSent(bytes encodedPayload,bytes options,address sendLibrary)"]);
  const event = receipt.logs
    .filter((log) => log.address.toLowerCase() === networks.sepolia.endpointV2.toLowerCase())
    .map((log) => iface.parseLog(log))
    .find((log) => log?.name === "PacketSent");
  if (!event) throw new Error("PacketSent not found");
  const packet = getBytes(event.args.encodedPayload);
  if (packet.length < 113) throw new Error(`invalid packet length ${packet.length}`);
  return { header: packet.slice(0, 81), payloadHash: getBytes(keccak256(packet.slice(81))) };
}

async function main() {
  const { header, payloadHash } = await sourcePacket();
  const expiration = BigInt(Math.floor(Date.now() / 1000) + 600);
  const verifyArgs = [
    Address.fromString(networks.stellarTestnet.testProviderDvn).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(header)),
    xdr.ScVal.scvBytes(Buffer.from(payloadHash)),
    nativeToScVal(2n, { type: "u64" }),
  ];
  const innerCalls = xdr.ScVal.scvVec([call(networks.stellarTestnet.uln302, "verify", verifyArgs)]);
  const authCalls = xdr.ScVal.scvVec([
    call(networks.stellarTestnet.testProviderDvn, "execute_transaction", [innerCalls]),
  ]);
  const callHashVal = await simulateReturn(dvn.call(
    "hash_call_data",
    nativeToScVal(10600, { type: "u32" }),
    nativeToScVal(expiration, { type: "u64" }),
    authCalls,
  ));
  const callHash = hexlify(callHashVal.bytes());
  const sig = new SigningKey(EVM_PRIVATE_KEY!).sign(callHash);
  const secpSignature = getBytes(concat([sig.r, sig.s, new Uint8Array([27 + sig.yParity])]));

  const account = await server.getAccount(source.publicKey());
  const bare = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(dvn.call("execute_transaction", innerCalls))
    .setTimeout(60)
    .build();
  const simulation = await server.simulateTransaction(bare);
  if (rpc.Api.isSimulationError(simulation)) throw new Error(`attestation simulation failed: ${simulation.error}`);
  const assembled = rpc.assembleTransaction(bare, simulation).build();
  const operation = assembled.operations[0];
  if (operation.type !== "invokeHostFunction" || !operation.auth || operation.auth.length !== 1) {
    throw new Error(`expected one custom auth entry, got ${operation.type === "invokeHostFunction" ? operation.auth?.length ?? 0 : 0}`);
  }
  const latest = await server.getLatestLedger();
  const validUntil = latest.sequence + 100;
  const signedAuth = await authorizeEntry(
    operation.auth[0],
    async (_preimage, payload) => ({
      address: networks.stellarTestnet.testProviderDvn,
      signatureScVal: authData(expiration, secpSignature, source.sign(payload)),
    }),
    validUntil,
    Networks.TESTNET,
    networks.stellarTestnet.testProviderDvn,
  );
  operation.auth[0] = signedAuth;

  // Custom-account validation reads additional DVN state (admins, signer set,
  // replay hash). Re-simulate with the completed auth entry so those keys are
  // included in the final Soroban footprint.
  const authenticatedSimulation = await server.simulateTransaction(assembled);
  if (rpc.Api.isSimulationError(authenticatedSimulation)) {
    throw new Error(`authenticated simulation failed: ${authenticatedSimulation.error}`);
  }
  const finalTx = rpc.assembleTransaction(assembled, authenticatedSimulation).build();
  const finalOperation = finalTx.operations[0];
  if (finalOperation.type !== "invokeHostFunction" || !finalOperation.auth) {
    throw new Error("final transaction lost invoke auth entries");
  }
  finalOperation.auth[0] = signedAuth;
  finalTx.sign(source);
  const sent = await server.sendTransaction(finalTx);
  if (sent.status === "ERROR") throw new Error(`submission failed: ${sent.errorResult?.toXDR("base64")}`);
  let result = await server.getTransaction(sent.hash);
  for (let attempt = 0; result.status === rpc.Api.GetTransactionStatus.NOT_FOUND && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`attestation transaction ${sent.hash} ended with ${result.status}`);
  }
  console.log({ header: hexlify(header), payloadHash: hexlify(payloadHash), callHash, attestationTx: sent.hash });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
