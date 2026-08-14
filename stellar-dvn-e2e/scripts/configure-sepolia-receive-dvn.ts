import { ethers } from "hardhat";
import networks from "../config/networks.json";

const endpointAbi = [
  "function getReceiveLibrary(address receiver,uint32 srcEid) view returns (address lib,bool isDefault)",
  "function setConfig(address oapp,address lib,(uint32 eid,uint32 configType,bytes config)[] params)",
  "function getConfig(address oapp,address lib,uint32 eid,uint32 configType) view returns (bytes)",
];

async function main() {
  const oapp = process.env.SEPOLIA_MESSAGE_OAPP;
  if (!oapp) throw new Error("SEPOLIA_MESSAGE_OAPP is required");
  const [signer] = await ethers.getSigners();
  const endpoint = new ethers.Contract(
    networks.sepolia.endpointV2,
    endpointAbi,
    signer,
  );
  const [receiveLibrary] = await endpoint.getReceiveLibrary(
    oapp,
    networks.stellarTestnet.eid,
  );
  const config = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)"],
    [[1, 1, 0, 0, [signer.address], []]],
  );
  const tx = await endpoint.setConfig(
    oapp,
    receiveLibrary,
    [{ eid: networks.stellarTestnet.eid, configType: 2, config }],
  );
  console.log(`setConfig transaction: ${tx.hash}`);
  await tx.wait();
  const stored = await endpoint.getConfig(
    oapp,
    receiveLibrary,
    networks.stellarTestnet.eid,
    2,
  );
  console.log({ receiveLibrary, requiredDvn: signer.address, stored });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
