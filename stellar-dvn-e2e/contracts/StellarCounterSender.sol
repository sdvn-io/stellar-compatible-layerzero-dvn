// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Bidirectional Sepolia OApp whose payload exactly matches LayerZero's
/// official Stellar OmniCounter codec: msg_type (u8) || src_eid (u32 big-endian).
contract StellarCounterSender is OApp {
    uint8 internal constant VANILLA = 1;
    uint32 public immutable localEid;
    uint64 public inboundCount;

    event IncrementSent(bytes32 indexed guid, uint32 indexed dstEid, uint64 nonce);
    event IncrementReceived(
        bytes32 indexed guid,
        uint32 indexed srcEid,
        bytes32 indexed sender,
        uint64 nonce
    );

    error InvalidCounterPayload();
    error PayloadSourceEidMismatch(uint32 originEid, uint32 payloadEid);

    constructor(address endpoint, address owner, uint32 eid)
        OApp(endpoint, owner)
        Ownable(owner)
    {
        localEid = eid;
    }

    function payload() public view returns (bytes memory) {
        return abi.encodePacked(VANILLA, localEid);
    }

    function quoteIncrement(uint32 dstEid, bytes calldata options)
        external
        view
        returns (MessagingFee memory)
    {
        return _quote(dstEid, payload(), options, false);
    }

    function sendIncrement(uint32 dstEid, bytes calldata options)
        external
        payable
        returns (MessagingReceipt memory receipt)
    {
        receipt = _lzSend(
            dstEid,
            payload(),
            options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );
        emit IncrementSent(receipt.guid, dstEid, receipt.nonce);
    }

    function _lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        if (message.length != 5 || uint8(message[0]) != VANILLA) {
            revert InvalidCounterPayload();
        }
        uint32 payloadEid =
            (uint32(uint8(message[1])) << 24) |
            (uint32(uint8(message[2])) << 16) |
            (uint32(uint8(message[3])) << 8) |
            uint32(uint8(message[4]));
        if (payloadEid != origin.srcEid) {
            revert PayloadSourceEidMismatch(origin.srcEid, payloadEid);
        }
        inboundCount += 1;
        emit IncrementReceived(guid, origin.srcEid, origin.sender, origin.nonce);
    }
}
