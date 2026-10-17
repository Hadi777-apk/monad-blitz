// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply reward token. The whole 1,000 BLITZ is minted once, in the
/// constructor, to the Mining contract. No mint, burn, tax, owner or upgrade path exists.
contract BLITZ is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1000 ether;

    constructor(address initialHolder) ERC20("Blitz Mine", "BLITZ") {
        _mint(initialHolder, TOTAL_SUPPLY);
    }
}
