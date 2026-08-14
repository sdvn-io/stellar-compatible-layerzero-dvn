// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Bidirectional LayerZero OApp for short UTF-8 demo messages.
contract StellarMessageOApp is OApp {
    uint256 public constant MAX_MESSAGE_BYTES = 256;

    string public lastMessage;
    uint32 public lastSourceEid;
    bytes32 public lastSender;
    bytes32 public lastGuid;
    uint64 public receivedMessageCount;
    uint64 public sentMessageCount;

    event MessageSent(bytes32 indexed guid, uint32 indexed dstEid, uint64 nonce, string message);
    event MessageReceived(
        bytes32 indexed guid,
        uint32 indexed srcEid,
        bytes32 indexed sender,
        uint64 nonce,
        string message
    );

    error EmptyMessage();
    error MessageTooLong(uint256 length);

    constructor(address endpoint, address owner) OApp(endpoint, owner) Ownable(owner) {}

    function quoteMessage(uint32 dstEid, string calldata message, bytes calldata options)
        external
        view
        returns (MessagingFee memory)
    {
        bytes memory payload = _validatedPayload(message);
        return _quote(dstEid, payload, options, false);
    }

    function sendMessage(uint32 dstEid, string calldata message, bytes calldata options)
        external
        payable
        returns (MessagingReceipt memory receipt)
    {
        bytes memory payload = _validatedPayload(message);
        receipt = _lzSend(dstEid, payload, options, MessagingFee(msg.value, 0), payable(msg.sender));
        sentMessageCount += 1;
        emit MessageSent(receipt.guid, dstEid, receipt.nonce, message);
    }

    function _lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        _validateLength(message.length);
        lastMessage = string(message);
        lastSourceEid = origin.srcEid;
        lastSender = origin.sender;
        lastGuid = guid;
        receivedMessageCount += 1;
        emit MessageReceived(guid, origin.srcEid, origin.sender, origin.nonce, string(message));
    }

    function _validatedPayload(string calldata message) private pure returns (bytes memory payload) {
        payload = bytes(message);
        _validateLength(payload.length);
    }

    function _validateLength(uint256 length) private pure {
        if (length == 0) revert EmptyMessage();
        if (length > MAX_MESSAGE_BYTES) revert MessageTooLong(length);
    }
}
