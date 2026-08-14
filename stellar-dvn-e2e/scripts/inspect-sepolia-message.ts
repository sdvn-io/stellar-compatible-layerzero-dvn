import { ethers } from "hardhat";
import networks from "../config/networks.json";

const txHash = process.env.SOURCE_TX_HASH;
if (!txHash) throw new Error("SOURCE_TX_HASH is required");

const endpointInterface = new ethers.Interface([
  "event PacketSent(bytes encodedPayload,bytes options,address sendLibrary)",
]);

async function main() {
  const receipt = await ethers.provider.getTransactionReceipt(txHash!);
  if (!receipt) throw new Error(`receipt not found: ${txHash}`);
  const endpoint = networks.sepolia.endpointV2.toLowerCase();
  const logs = receipt.logs
    .filter((log) => log.address.toLowerCase() === endpoint)
    .map((log) => endpointInterface.parseLog(log))
    .filter((log) => log?.name === "PacketSent");
  console.dir({ status: receipt.status, blockNumber: receipt.blockNumber, logs }, { depth: 5 });
  if (logs.length !== 1) throw new Error(`expected one PacketSent event, got ${logs.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
