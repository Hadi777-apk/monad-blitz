// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice DEMO ONLY. Same rules as `Distribution`, except that the creator (`controller`) can press
/// `skip()` to end the current phase immediately, so a live demo does not have to wait for the clock.
/// Anyone joining should know the controller can end registration or reporting early; the page marks
/// these campaigns as "演示". Real campaigns use `Distribution`, which has no such power.
contract DemoDistribution {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable treasury;
    address public immutable controller;
    uint64 public registerEnd;
    uint64 public reportEnd;
    uint64 public claimEnd;

    mapping(address => bool) public registered;
    mapping(address => uint256) public usage;
    mapping(address => bool) public claimed;
    address[] private _participants;
    uint256 public totalUsage;
    uint256 public pool;
    bool public finalized;

    error BadConfig();
    error WrongPhase();
    error NotController();
    error AlreadyRegistered();
    error NotRegistered();
    error NoNewUsage();
    error AlreadyClaimed();
    error NothingToClaim();

    event Registered(address indexed wallet, uint256 index);
    event UsageReported(address indexed wallet, uint256 cumulative, uint256 totalUsage);
    event Finalized(uint256 pool, uint256 totalUsage);
    event Claimed(address indexed wallet, uint256 amount);
    event Swept(uint256 amount);
    event Skipped(uint64 registerEnd, uint64 reportEnd, uint64 claimEnd);

    constructor(IERC20 token_, address treasury_, address controller_, uint64 registerEnd_, uint64 reportEnd_, uint64 claimEnd_) {
        if (address(token_) == address(0) || treasury_ == address(0) || controller_ == address(0)) revert BadConfig();
        if (!(block.timestamp < registerEnd_ && registerEnd_ < reportEnd_ && reportEnd_ < claimEnd_)) revert BadConfig();
        token = token_;
        treasury = treasury_;
        controller = controller_;
        registerEnd = registerEnd_;
        reportEnd = reportEnd_;
        claimEnd = claimEnd_;
    }

    /// @notice Ends the current phase now. Later phases keep their configured lengths.
    function skip() external {
        if (msg.sender != controller) revert NotController();
        uint64 t = uint64(block.timestamp);
        if (t < registerEnd) {
            uint64 reportLen = reportEnd - registerEnd;
            uint64 claimLen = claimEnd - reportEnd;
            registerEnd = t;
            reportEnd = t + reportLen;
            claimEnd = reportEnd + claimLen;
        } else if (t < reportEnd) {
            uint64 claimLen = claimEnd - reportEnd;
            reportEnd = t;
            claimEnd = t + claimLen;
        } else if (t < claimEnd) {
            claimEnd = t;
        } else {
            revert WrongPhase();
        }
        emit Skipped(registerEnd, reportEnd, claimEnd);
    }

    function register() external {
        if (block.timestamp >= registerEnd) revert WrongPhase();
        if (registered[msg.sender]) revert AlreadyRegistered();
        registered[msg.sender] = true;
        _participants.push(msg.sender);
        emit Registered(msg.sender, _participants.length - 1);
    }

    function report(uint256 cumulative) external {
        if (block.timestamp < registerEnd || block.timestamp >= reportEnd) revert WrongPhase();
        if (!registered[msg.sender]) revert NotRegistered();
        uint256 previous = usage[msg.sender];
        if (cumulative <= previous) revert NoNewUsage();
        usage[msg.sender] = cumulative;
        totalUsage += cumulative - previous;
        emit UsageReported(msg.sender, cumulative, totalUsage);
    }

    function finalize() public {
        if (block.timestamp < reportEnd) revert WrongPhase();
        if (finalized) return;
        finalized = true;
        pool = token.balanceOf(address(this));
        emit Finalized(pool, totalUsage);
    }

    function shareOf(address wallet) public view returns (uint256) {
        if (totalUsage == 0) return 0;
        return Math.mulDiv(pool, usage[wallet], totalUsage);
    }

    function claim(address wallet) external returns (uint256 amount) {
        if (block.timestamp >= claimEnd) revert WrongPhase();
        finalize();
        if (claimed[wallet]) revert AlreadyClaimed();
        amount = shareOf(wallet);
        if (amount == 0) revert NothingToClaim();
        claimed[wallet] = true;
        token.safeTransfer(wallet, amount);
        emit Claimed(wallet, amount);
    }

    function sweep() external {
        if (block.timestamp < claimEnd) revert WrongPhase();
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(treasury, amount);
        emit Swept(amount);
    }

    function participantCount() external view returns (uint256) { return _participants.length; }
    function participants(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 n = _participants.length;
        if (offset >= n) return out;
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = _participants[i];
    }
}
