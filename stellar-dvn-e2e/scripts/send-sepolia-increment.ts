import { ethers } from "hardhat";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import networks from "../config/networks.json";

async function main() {
  const address = process.env.SEPOLIA_MESSAGE_OAPP;
  const message = process.env.MESSAGE ?? "Hello from Sepolia";
  if (!address) throw new Error("SEPOLIA_MESSAGE_OAPP is required");
  const sender = await ethers.getContractAt(
    "StellarMessageOApp",
    address,
  );
  const options = Options.newOptions()
    .addExecutorLzReceiveOption(500_000, 0)
    .toHex();
  const fee = await sender.quoteMessage(networks.stellarTestnet.eid, message, options);
  const value = (fee.nativeFee * 110n) / 100n;

  console.log({
    dstEid: networks.stellarTestnet.eid,
    message,
    options,
    quotedNativeFee: fee.nativeFee.toString(),
    suppliedNativeFee: value.toString(),
  });
  const tx = await sender.sendMessage(networks.stellarTestnet.eid, message, options, {
    value,
  });
  console.log(`send transaction: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`confirmed in Sepolia block ${receipt?.blockNumber}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
