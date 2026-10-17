// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DistributionFactory, FaucetToken} from "../src/DistributionFactory.sol";

/// Testnet deploy of the public campaign directory and the open test faucet.
///   PRIVATE_KEY=0x... forge script script/DeployFactory.s.sol --rpc-url $RPC --broadcast
contract DeployFactory is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        DistributionFactory f = new DistributionFactory();
        FaucetToken t = new FaucetToken();
        vm.stopBroadcast();
        console.log("Factory:", address(f));
        console.log("FaucetToken:", address(t));
    }
}
