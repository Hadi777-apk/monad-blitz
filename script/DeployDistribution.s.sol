// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Distribution} from "../src/Distribution.sol";
import {UsageDemoToken} from "../src/UsageMining.sol";

/// Run on the server, with the key only in that shell's environment (never in a file or chat):
///   export PRIVATE_KEY=0x...   # deployer; needs testnet MON for gas
///   forge script script/DeployDistribution.s.sol --rpc-url $RPC --broadcast
/// Optional env: TOKEN (existing ERC-20 as the reward; if unset a new 200-token demo asset is minted to the deployer),
/// TREASURY (default: deployer), POOL (wei, default: whole demo supply),
/// REGISTER_SECS / REPORT_SECS / CLAIM_SECS (default 1h / 1h / 7d).
contract DeployDistribution is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);
        address tokenAddr = vm.envOr("TOKEN", address(0));
        uint64 regSecs = uint64(vm.envOr("REGISTER_SECS", uint256(1 hours)));
        uint64 repSecs = uint64(vm.envOr("REPORT_SECS", uint256(1 hours)));
        uint64 claimSecs = uint64(vm.envOr("CLAIM_SECS", uint256(7 days)));

        vm.startBroadcast(pk);
        IERC20 token = tokenAddr == address(0) ? IERC20(address(new UsageDemoToken())) : IERC20(tokenAddr);
        uint256 pool = vm.envOr("POOL", token.balanceOf(deployer));
        uint64 t = uint64(block.timestamp);
        Distribution d = new Distribution(token, treasury, t + regSecs, t + regSecs + repSecs, t + regSecs + repSecs + claimSecs);
        token.transfer(address(d), pool);
        vm.stopBroadcast();

        console.log("Distribution:", address(d));
        console.log("Token:", address(token));
        console.log("Pool:", pool);
        console.log("Put the Distribution address into web/src/hub.json");
    }
}
