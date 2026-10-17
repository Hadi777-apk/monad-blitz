// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice One distribution event: register wallets, collect self-reported usage in a fixed
/// window, then split a fixed pool by usage share. No owner and no admin keys.
/// Usage is self-reported from each participant's machine and cannot be verified on-chain.
/// This instance has no artificial per-wallet token cap.
contract Distribution is EIP712 {
    using SafeERC20 for IERC20;

    bytes32 private constant REPORT_TYPEHASH =
        keccak256("Report(address wallet,uint256 cumulative,uint256 deadline)");

    IERC20 public immutable token;
    address public immutable treasury;
    uint64 public immutable registerEnd;
    uint64 public immutable reportEnd;
    uint64 public immutable claimEnd;

    mapping(address => bool) public registered;
    mapping(address => uint256) public usage;
    mapping(address => bool) public claimed;
    address[] private _participants;
    uint256 public totalUsage;
    uint256 public pool;
    bool public finalized;

    error BadConfig();
    error WrongPhase();
    error AlreadyRegistered();
    error NotRegistered();
    error NoNewUsage();
    error BadSignature();
    error SignatureExpired();
    error AlreadyClaimed();
    error NothingToClaim();

    event Registered(address indexed wallet, uint256 index);
    event UsageReported(address indexed wallet, uint256 cumulative, uint256 totalUsage);
    event Finalized(uint256 pool, uint256 totalUsage);
    event Claimed(address indexed wallet, uint256 amount);
    event Swept(uint256 amount);

    constructor(IERC20 token_, address treasury_, uint64 registerEnd_, uint64 reportEnd_, uint64 claimEnd_)
        EIP712("Distribution", "1")
    {
        if (address(token_) == address(0) || treasury_ == address(0)) revert BadConfig();
        if (!(block.timestamp < registerEnd_ && registerEnd_ < reportEnd_ && reportEnd_ < claimEnd_)) revert BadConfig();
        token = token_;
        treasury = treasury_;
        registerEnd = registerEnd_;
        reportEnd = reportEnd_;
        claimEnd = claimEnd_;
    }

    // ---- phase 1: registration ----
    function register() external {
        if (block.timestamp >= registerEnd) revert WrongPhase();
        if (registered[msg.sender]) revert AlreadyRegistered();
        registered[msg.sender] = true;
        _participants.push(msg.sender);
        emit Registered(msg.sender, _participants.length - 1);
    }

    // ---- phase 2: usage reporting ----
    /// @param cumulative usage since the participant's own baseline (taken at registration).
    function report(uint256 cumulative) external {
        _report(msg.sender, cumulative);
    }

    /// @notice Anyone may relay a wallet-signed report, so participants need no gas.
    function reportBySig(address wallet, uint256 cumulative, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REPORT_TYPEHASH, wallet, cumulative, deadline)));
        if (ECDSA.recover(digest, sig) != wallet) revert BadSignature();
        _report(wallet, cumulative);
    }

    function _report(address wallet, uint256 cumulative) internal {
        if (block.timestamp < registerEnd || block.timestamp >= reportEnd) revert WrongPhase();
        if (!registered[wallet]) revert NotRegistered();
        uint256 previous = usage[wallet];
        // Monotonic: a replayed or stale signature can never lower or double-count usage.
        if (cumulative <= previous) revert NoNewUsage();
        usage[wallet] = cumulative;
        totalUsage += cumulative - previous;
        emit UsageReported(wallet, cumulative, totalUsage);
    }

    // ---- phase 3: settlement ----
    /// @notice Fixes the pool at the current balance. Anyone may call it once reporting ends.
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

    /// @notice Anyone may relay; the reward always goes to the wallet itself.
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

    /// @notice After the claim window, leftovers (rounding dust, unclaimed, zero-usage pool) go to the treasury.
    function sweep() external {
        if (block.timestamp < claimEnd) revert WrongPhase();
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(treasury, amount);
        emit Swept(amount);
    }

    // ---- views ----
    function participantCount() external view returns (uint256) { return _participants.length; }
    function participantAt(uint256 i) external view returns (address) { return _participants[i]; }
    function participants(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 n = _participants.length;
        if (offset >= n) return out;
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = _participants[i];
    }
}
