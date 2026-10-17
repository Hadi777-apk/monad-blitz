// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice A separate local-demo asset. It cannot unlock or migrate the A instance's BLITZ.
contract UsageDemoToken is ERC20 {
    constructor() ERC20("Blitz Usage Demo", "UBLITZ") {
        _mint(msg.sender, 200 ether);
    }
}

/// @notice Trusted-reporter AI usage experiment, NOT trustless proof of model consumption.
/// Fixed reporter and immutable rules: 1,000 non-cached-input + output tokens per point,
/// 100 nonempty rounds of 2 UBLITZ. First source snapshot is a baseline, never a reward.
contract UsageMining {
    uint256 public constant TOTAL_SUPPLY = 200 ether;
    uint256 public constant ROUND_REWARD = 2 ether;
    uint256 public constant MAX_VALID_ROUNDS = 100;
    uint256 public constant TOKENS_PER_POINT = 1000;
    address public immutable reporter;
    uint256 public immutable roundLength;
    UsageDemoToken public immutable token;

    struct Source { address wallet; uint256 cumulative; }
    struct Round { uint256 deadline; uint256 totalPoints; bool closed; }
    struct Contribution { address owner; uint256 round; uint256 start; uint256 points; bool claimed; }
    mapping(bytes32 => Source) public sources;
    mapping(bytes32 => bool) public usedReport;
    mapping(address => uint256) public eligibleTokens;
    mapping(uint256 => Round) public rounds;
    Contribution[] public contributions;
    uint256 public roundCount;
    uint256 public openRoundId;
    uint256 public validRounds;
    uint256 public remaining = TOTAL_SUPPLY;
    uint256 public reserved;
    uint256 public unclaimed;
    uint256 public paid;

    error NotReporter();
    error InvalidSource();
    error SourceAlreadyRegistered();
    error DuplicateReport();
    error NoNewUsage();
    error RoundStillOpen();
    error NoOpenRound();
    error RoundExpired();
    error RoundNotEnded();
    error QuotaExhausted();
    error RoundNotClosed();
    error AlreadyClaimed();
    error BadConfig();

    event SourceRegistered(bytes32 indexed source, address indexed wallet, uint256 baseline);
    event UsageRecorded(bytes32 indexed reportId, bytes32 indexed source, address indexed wallet, uint256 delta, uint256 points);
    event RoundOpened(uint256 indexed round, uint256 deadline);
    event ContributionRecorded(uint256 indexed id, address indexed owner, uint256 indexed round, uint256 points);
    event RoundClosed(uint256 indexed round, bool empty);
    event Claimed(uint256 indexed id, address indexed owner, uint256 amount);

    constructor(address reporter_, uint256 roundLength_) {
        if (reporter_ == address(0) || roundLength_ == 0) revert BadConfig();
        reporter = reporter_;
        roundLength = roundLength_;
        token = new UsageDemoToken();
    }

    modifier onlyReporter() {
        if (msg.sender != reporter) revert NotReporter();
        _;
    }

    function registerSource(bytes32 source, address wallet, uint256 baseline) external onlyReporter {
        if (source == bytes32(0) || wallet == address(0)) revert InvalidSource();
        if (sources[source].wallet != address(0)) revert SourceAlreadyRegistered();
        sources[source] = Source(wallet, baseline);
        emit SourceRegistered(source, wallet, baseline);
    }

    function openRound() external {
        if (openRoundId != 0) revert RoundStillOpen();
        if (validRounds >= MAX_VALID_ROUNDS || remaining < ROUND_REWARD) revert QuotaExhausted();
        uint256 id = ++roundCount;
        rounds[id].deadline = block.timestamp + roundLength;
        openRoundId = id;
        remaining -= ROUND_REWARD;
        reserved = ROUND_REWARD;
        emit RoundOpened(id, rounds[id].deadline);
    }

    function reportUsage(bytes32 source, uint256 cumulative, bytes32 reportId) external onlyReporter {
        Source storage s = sources[source];
        if (s.wallet == address(0) || reportId == bytes32(0)) revert InvalidSource();
        if (usedReport[reportId]) revert DuplicateReport();
        if (cumulative <= s.cumulative) revert NoNewUsage();
        uint256 id = openRoundId;
        if (id == 0) revert NoOpenRound();
        Round storage r = rounds[id];
        if (block.timestamp >= r.deadline) revert RoundExpired();
        uint256 delta = cumulative - s.cumulative;
        uint256 previous = eligibleTokens[s.wallet];
        uint256 total = previous + delta;
        uint256 points = total / TOKENS_PER_POINT - previous / TOKENS_PER_POINT;
        s.cumulative = cumulative;
        eligibleTokens[s.wallet] = total;
        usedReport[reportId] = true;
        if (points != 0) {
            uint256 contributionId = contributions.length;
            contributions.push(Contribution(s.wallet, id, r.totalPoints, points, false));
            r.totalPoints += points;
            emit ContributionRecorded(contributionId, s.wallet, id, points);
        }
        emit UsageRecorded(reportId, source, s.wallet, delta, points);
    }

    function closeRound() external {
        uint256 id = openRoundId;
        if (id == 0) revert NoOpenRound();
        Round storage r = rounds[id];
        if (block.timestamp < r.deadline) revert RoundNotEnded();
        r.closed = true;
        openRoundId = 0;
        reserved = 0;
        bool empty = r.totalPoints == 0;
        if (empty) remaining += ROUND_REWARD;
        else { validRounds++; unclaimed += ROUND_REWARD; }
        emit RoundClosed(id, empty);
    }

    function rewardOf(uint256 id) public view returns (uint256) {
        Contribution storage c = contributions[id];
        Round storage r = rounds[c.round];
        if (!r.closed) revert RoundNotClosed();
        return Math.mulDiv(ROUND_REWARD, c.start + c.points, r.totalPoints)
            - Math.mulDiv(ROUND_REWARD, c.start, r.totalPoints);
    }

    /// @notice Anyone may relay the claim; the original wallet always receives the reward.
    function claim(uint256 id) external returns (uint256 amount) {
        Contribution storage c = contributions[id];
        if (c.claimed) revert AlreadyClaimed();
        amount = rewardOf(id);
        c.claimed = true;
        unclaimed -= amount;
        paid += amount;
        token.transfer(c.owner, amount);
        emit Claimed(id, c.owner, amount);
    }

    function contributionCount() external view returns (uint256) { return contributions.length; }
    function accountedTotal() external view returns (uint256) { return remaining + reserved + unclaimed + paid; }
}
