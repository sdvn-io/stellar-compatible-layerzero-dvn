// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Origin} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {StellarMessageOApp} from "../StellarMessageOApp.sol";

contract StellarMessageOAppHarness is StellarMessageOApp {
    constructor(address endpoint) StellarMessageOApp(endpoint, msg.sender) {}

    function exposedReceive(Origin calldata origin, bytes32 guid, bytes calldata message, bytes calldata extraData) external {
        _lzReceive(origin, guid, message, msg.sender, extraData);
    }
}

contract MockEndpoint {
    address public delegate;

    function setDelegate(address value) external {
        delegate = value;
    }
}
