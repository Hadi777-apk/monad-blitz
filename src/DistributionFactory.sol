// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Distribution} from "./Distribution.sol";
import {DemoDistribution} from "./DemoDistribution.sol";

/// @notice Anyone can open a distribution campaign: the factory deploys a fresh, ownerless
/// Distribution and moves the creator's pool into it in the same transaction. The creator is the
/// treasury (receives leftovers after the claim window). The factory has no admin and no power
/// over any campaign after creation; it is only a public directory.
contract DistributionFactory {
    using SafeERC20 for IERC20;

    address[] private _campaigns;
    mapping(address => address) public creatorOf;
    mapping(address => bool) public isDemo;

    error ZeroPool();

    event CampaignCreated(
        address indexed campaign, address indexed creator, address indexed token,
        uint256 pool, uint64 registerEnd, uint64 reportEnd, uint64 claimEnd
    );

    /// @dev The creator must first approve `pool` of `token` to this factory.
    function create(IERC20 token, uint256 pool, uint64 registerEnd, uint64 reportEnd, uint64 claimEnd)
        external
        returns (address campaign)
    {
        if (pool == 0) revert ZeroPool();
        // Distribution validates the token address and that registerEnd < reportEnd < claimEnd, all in the future.
        Distribution d = new Distribution(token, msg.sender, registerEnd, reportEnd, claimEnd);
        campaign = address(d);
        token.safeTransferFrom(msg.sender, campaign, pool);
        _campaigns.push(campaign);
        creatorOf[campaign] = msg.sender;
        emit CampaignCreated(campaign, msg.sender, address(token), pool, registerEnd, reportEnd, claimEnd);
    }

    /// @notice DEMO campaign: same as `create`, but the creator may call `skip()` to end phases early.
    /// Listed in the same directory and flagged via `isDemo`, so participants can see it.
    function createDemo(IERC20 token, uint256 pool, uint64 registerEnd, uint64 reportEnd, uint64 claimEnd)
        external
        returns (address campaign)
    {
        if (pool == 0) revert ZeroPool();
        DemoDistribution d = new DemoDistribution(token, msg.sender, msg.sender, registerEnd, reportEnd, claimEnd);
        campaign = address(d);
        token.safeTransferFrom(msg.sender, campaign, pool);
        _campaigns.push(campaign);
        creatorOf[campaign] = msg.sender;
        isDemo[campaign] = true;
        emit CampaignCreated(campaign, msg.sender, address(token), pool, registerEnd, reportEnd, claimEnd);
    }

    function campaignCount() external view returns (uint256) { return _campaigns.length; }

    /// @notice Newest first. `offset` counts from the newest campaign.
    function latest(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 n = _campaigns.length;
        if (offset >= n) return out;
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = _campaigns[n - 1 - i];
    }
}

/// @notice TESTNET ONLY. Open faucet so anyone can get a test reward token to try creating a campaign.
contract FaucetToken is ERC20 {
    uint256 public constant DRIP = 1000 ether;
    uint256 public constant COOLDOWN = 1 hours;
    mapping(address => uint256) public lastDrip;

    error TooSoon();

    constructor() ERC20("Blitz Test Token", "TBLITZ") {}

    function faucet() external {
        if (lastDrip[msg.sender] != 0 && block.timestamp < lastDrip[msg.sender] + COOLDOWN) revert TooSoon();
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, DRIP);
    }
}
