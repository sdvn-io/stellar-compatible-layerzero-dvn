import {
  Address,
  nativeToScVal,
  scvSortedMap,
  xdr,
} from "@stellar/stellar-sdk";
import networks from "../config/networks.json";

const confirmations = BigInt(process.env.ULN_CONFIRMATIONS ?? "2");

function field(name: string, value: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({
    key: xdr.ScVal.scvSymbol(name),
    val: value,
  });
}

const ulnConfig = scvSortedMap([
  field("confirmations", nativeToScVal(confirmations, { type: "u64" })),
  field("required_dvns", xdr.ScVal.scvVec([
    Address.fromString(networks.stellarTestnet.testProviderDvn).toScVal(),
  ])),
  field("optional_dvns", xdr.ScVal.scvVec([])),
  field("optional_dvn_threshold", nativeToScVal(0, { type: "u32" })),
]);

const oappConfig = scvSortedMap([
  field("use_default_confirmations", xdr.ScVal.scvBool(false)),
  field("use_default_required_dvns", xdr.ScVal.scvBool(false)),
  field("use_default_optional_dvns", xdr.ScVal.scvBool(false)),
  field("uln_config", ulnConfig),
]);

console.log(oappConfig.toXDR("hex"));
