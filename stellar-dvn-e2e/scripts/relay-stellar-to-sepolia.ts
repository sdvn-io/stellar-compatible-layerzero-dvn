import { ethers } from "hardhat";
import networks from "../config/networks.json";

const ENCODED_PACKET = process.env.STELLAR_ENCODED_PACKET;
if (!ENCODED_PACKET) throw new Error("STELLAR_ENCODED_PACKET is required");
const SEPOLIA_MESSAGE_OAPP = process.env.SEPOLIA_MESSAGE_OAPP;
if (!SEPOLIA_MESSAGE_OAPP) throw new Error("SEPOLIA_MESSAGE_OAPP is required");

const endpointAbi = [
  "function getReceiveLibrary(address receiver,uint32 srcEid) view returns (address lib,bool isDefault)",
  "function lzReceive((uint32 srcEid,bytes32 sender,uint64 nonce) origin,address receiver,bytes32 guid,bytes message,bytes extraData) payable",
];
const receiveUlnAbi = [
  "function verify(bytes packetHeader,bytes32 payloadHash,uint64 confirmations)",
  "function commitVerification(bytes packetHeader,bytes32 payloadHash)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const packet = ethers.getBytes(ENCODED_PACKET!);
  if (packet.length < 113 || packet[0] !== 1) {
    throw new Error(`invalid LayerZero V1 packet length/version: ${packet.length}/${packet[0]}`);
  }
  const header = ethers.hexlify(packet.slice(0, 81));
  const guid = ethers.hexlify(packet.slice(81, 113));
  const message = ethers.hexlify(packet.slice(113));
  const payloadHash = ethers.keccak256(packet.slice(81));
  const srcEid = Number(ethers.toBigInt(ethers.hexlify(packet.slice(9, 13))));
  const nonce = ethers.toBigInt(ethers.hexlify(packet.slice(1, 9)));
  const sender = ethers.hexlify(packet.slice(13, 45));
  const dstEid = Number(ethers.toBigInt(ethers.hexlify(packet.slice(45, 49))));
  const receiverBytes = ethers.hexlify(packet.slice(49, 81));
  const expectedReceiver = ethers.zeroPadValue(SEPOLIA_MESSAGE_OAPP!, 32);
  if (srcEid !== networks.stellarTestnet.eid || dstEid !== networks.sepolia.eid) {
    throw new Error(`unexpected EIDs ${srcEid} -> ${dstEid}`);
  }
  if (receiverBytes.toLowerCase() !== expectedReceiver.toLowerCase()) {
    throw new Error(`receiver mismatch: ${receiverBytes}`);
  }

  const endpoint = new ethers.Contract(networks.sepolia.endpointV2, endpointAbi, signer);
  const [receiveLibrary] = await endpoint.getReceiveLibrary(
    SEPOLIA_MESSAGE_OAPP!,
    srcEid,
  );
  const uln = new ethers.Contract(receiveLibrary, receiveUlnAbi, signer);
  const verifyTx = await uln.verify(header, payloadHash, 1);
  console.log(`verify transaction: ${verifyTx.hash}`);
  await verifyTx.wait();
  const commitTx = await uln.commitVerification(header, payloadHash);
  console.log(`commit transaction: ${commitTx.hash}`);
  await commitTx.wait();

  const oapp = await ethers.getContractAt("StellarMessageOApp", SEPOLIA_MESSAGE_OAPP!);
  const before = await oapp.receivedMessageCount();
  const executeTx = await endpoint.lzReceive(
    { srcEid, sender, nonce },
    SEPOLIA_MESSAGE_OAPP!,
    guid,
    message,
    "0x",
  );
  console.log(`execute transaction: ${executeTx.hash}`);
  await executeTx.wait();
  const after = await oapp.receivedMessageCount();
  if (after !== before + 1n) throw new Error(`received-message count did not increment: ${before} -> ${after}`);
  const storedMessage = await oapp.lastMessage();
  if (storedMessage !== ethers.toUtf8String(message)) throw new Error("stored message does not match packet payload");
  console.log({ header, guid, message: storedMessage, payloadHash, before: before.toString(), after: after.toString() });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
