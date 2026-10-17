// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Mining} from "../src/Mining.sol";
import {Escrow} from "../src/Escrow.sol";
import {MockPayToken} from "../src/mocks/MockPayToken.sol";
import {MockNFT} from "../src/mocks/MockNFT.sol";

/// Usage: DIFFICULTY_BITS=16 ROUND_LENGTH=60 forge script script/Deploy.s.sol --rpc-url <url> --broadcast --private-key <key>
/// Difficulty and round length are fixed per instance at deploy time (v0.5: tentative 16 bits; 60s demo / 300s normal).
contract Deploy is Script {
    function run() external {
        uint256 bits = vm.envOr("DIFFICULTY_BITS", uint256(16));
        uint256 roundLength = vm.envOr("ROUND_LENGTH", uint256(60));
        vm.startBroadcast();
        Mining mining = new Mining(bits, roundLength);
        MockPayToken pay = new MockPayToken();
        MockNFT nft = new MockNFT();
        Escrow escrow = new Escrow(pay, nft);
        vm.stopBroadcast();
        console.log("MINING", address(mining));
        console.log("BLITZ", address(mining.blitz()));
        console.log("PAY", address(pay));
        console.log("NFT", address(nft));
        console.log("ESCROW", address(escrow));
    }
}
