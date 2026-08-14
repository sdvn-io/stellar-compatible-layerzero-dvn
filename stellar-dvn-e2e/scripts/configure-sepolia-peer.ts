import { ethers } from "hardhat";
import networks from "../config/networks.json";

async function main() {
  const deployment = await ethers.getContractFactory("StellarMessageOApp");
  const address = process.env.SEPOLIA_MESSAGE_OAPP;
  const stellarContractId = process.env.STELLAR_MESSAGE_CONTRACT_ID;
  if (!address || !stellarContractId || !/^[0-9a-fA-F]{64}$/.test(stellarContractId)) {
    throw new Error("SEPOLIA_MESSAGE_OAPP and 64-hex-character STELLAR_MESSAGE_CONTRACT_ID are required");
  }
  const sender = deployment.attach(address);
  const peer = `0x${stellarContractId}`;

  const current = await sender.peers(networks.stellarTestnet.eid);
  if (current.toLowerCase() !== peer.toLowerCase()) {
    const tx = await sender.setPeer(networks.stellarTestnet.eid, peer);
    console.log(`setPeer transaction: ${tx.hash}`);
    await tx.wait();
  }

  const configured = await sender.peers(networks.stellarTestnet.eid);
  if (configured.toLowerCase() !== peer.toLowerCase()) {
    throw new Error(`peer mismatch: expected ${peer}, got ${configured}`);
  }
  console.log(`Sepolia peer for EID ${networks.stellarTestnet.eid}: ${configured}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
