import { ethers } from "hardhat";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import networks from "../config/networks.json";

const endpointAbi = [
  "function isSupportedEid(uint32) view returns (bool)",
  "function defaultSendLibrary(uint32) view returns (address)",
  "function getSendLibrary(address,uint32) view returns (address)",
  "function getConfig(address,address,uint32,uint32) view returns (bytes)",
];

async function main() {
  const oappAddress = process.env.SEPOLIA_MESSAGE_OAPP;
  const message = process.env.MESSAGE ?? "Hello Stellar";
  if (!oappAddress) throw new Error("SEPOLIA_MESSAGE_OAPP is required");
  const endpoint = new ethers.Contract(
    networks.sepolia.endpointV2,
    endpointAbi,
    ethers.provider,
  );
  const sender = await ethers.getContractAt(
    "StellarMessageOApp",
    oappAddress,
  );
  const dstEid = networks.stellarTestnet.eid;
  const supported = await endpoint.isSupportedEid(dstEid);
  const defaultSendLibrary = await endpoint.defaultSendLibrary(dstEid);
  const sendLibrary = await endpoint.getSendLibrary(
    oappAddress,
    dstEid,
  );

  console.log({ supported, defaultSendLibrary, sendLibrary });
  if (!supported || sendLibrary === ethers.ZeroAddress) return;

  const rawConfig = await endpoint.getConfig(
    oappAddress,
    sendLibrary,
    dstEid,
    2,
  );
  const [uln] = ethers.AbiCoder.defaultAbiCoder().decode(
    ["tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)"],
    rawConfig,
  );
  console.log("ULN302 send config:", uln);

  const options = Options.newOptions()
    .addExecutorLzReceiveOption(500_000, 0)
    .toHex();
  const fee = await sender.quoteMessage(dstEid, message, options);
  console.log({ message, options, nativeFee: fee.nativeFee.toString(), lzTokenFee: fee.lzTokenFee.toString() });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
