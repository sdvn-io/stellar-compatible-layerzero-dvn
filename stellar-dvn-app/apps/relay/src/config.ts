const stellarMessageOapp = process.env.STELLAR_MESSAGE_OAPP ?? "";
const sepoliaMessageOapp = process.env.SEPOLIA_MESSAGE_OAPP ?? "";

if (!/^C[A-Z2-7]{55}$/.test(stellarMessageOapp)) {
  throw new Error("STELLAR_MESSAGE_OAPP must be the deployed Stellar message contract address");
}
if (!/^0x[0-9a-fA-F]{40}$/.test(sepoliaMessageOapp)) {
  throw new Error("SEPOLIA_MESSAGE_OAPP must be the deployed Sepolia message contract address");
}

export const config = {
  stellar: {
    eid: 40600,
    oapp: stellarMessageOapp,
    endpoint: "CALTBA5S6GRJEHAXFP45LGGLKWWAF7HTZCPNUBUJF2HWWRRLQNV35AIV",
    uln302: "CCMLPCAWCPIIMXOHJJKU3NZLOFTT2O6QTB2UUFPN6SEHLK35QRHVKKMB",
    dvn: "CC76R4VVTLV72V55BCW4A35EZPYOY4CVQTTMVXPYGUFX74LDQDZ7GQC3",
    relayer: "GAGDETYIKLCBHDDKJGVESZB5AD24DIBZEJAHHLDP75TBMQX2775FU2VC",
    scanStartLedger: Number(process.env.STELLAR_SCAN_START_LEDGER ?? 4140252),
    explorer: "https://stellar.expert/explorer/testnet/tx/",
  },
  sepolia: {
    eid: 40161,
    chainId: 11155111,
    oapp: sepoliaMessageOapp,
    verifier: "0xAC57cbcd88f4BF925F7BA506bc0eF168F2D68B2B",
    endpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
    receiveUln302: "0xdAf00F5eE2158dD58E0d3857851c432E34A3A851",
    scanStartBlock: Number(process.env.SEPOLIA_SCAN_START_BLOCK ?? 11488800),
    explorer: "https://sepolia.etherscan.io/tx/",
  },
  layerZeroScan: "https://testnet.layerzeroscan.com/tx/",
  options: "0x0003010011010000000000000000000000000007a120",
} as const;
