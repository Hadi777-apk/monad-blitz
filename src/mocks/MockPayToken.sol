// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test payment asset (demo fixture, not a core module). Open mint.
contract MockPayToken is ERC20 {
    constructor() ERC20("Mock Pay Token", "MPAY") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
