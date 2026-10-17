// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BLITZ} from "./BLITZ.sol";

/// @notice Group-A serial mining rounds (v0.5). One round open at a time; each accepted
/// SHA-256 answer is exactly 1 point; reward per contribution is
/// floor(B*end/T) - floor(B*start/T), which telescopes to exactly B per non-empty round.
/// Group B's 200 BLITZ stay in this contract with no path out.
/// No owner, no admin, not upgradeable. Does not call Escrow.
contract Mining {
    uint256 public constant TOTAL_SUPPLY = 1000 ether;
    uint256 public constant A_BUDGET = 800 ether;
    uint256 public constant LOCKED_B = 200 ether;
    uint256 public constant ROUND_REWARD = 8 ether;
    uint256 public constant MAX_VALID_ROUNDS = 100;

    BLITZ public immutable blitz;
    /// @dev Required number of leading zero bits of the SHA-256 digest (1..255).
    uint256 public immutable difficultyBits;
    /// @dev Seconds from opening block time to deadline, fixed per instance.
    uint256 public immutable roundLength;

    struct Round {
        bytes32 seed;
        uint64 openedAt;
        uint64 deadline;
        uint32 totalPoints;
        bool closed;
        uint256 reserved;
    }

    /// @dev Each contribution is exactly one point: range [start, start + 1).
    struct Contribution {
        address owner;
        uint32 round;
        uint32 start;
        bool claimed;
    }

    mapping(uint256 => Round) public rounds;
    Contribution[] private _contributions;
    mapping(bytes32 => bool) public usedAnswer;

    uint256 public roundCount; // ids issued so far (ids start at 1)
    uint256 public openRoundId; // 0 when no round is open

    // Budget accounting: R_A + E_A + U_A + C_A + L_B == 1000
    uint256 public remainingA; // R_A
    uint256 public openReserveA; // E_A
    uint256 public closedUnclaimedA; // U_A
    uint256 public paidA; // C_A
    uint256 public validRounds; // k: closed non-empty rounds

    event RoundOpened(uint256 indexed round, bytes32 seed, uint64 deadline);
    event AnswerAccepted(uint256 indexed round, address indexed miner, uint256 indexed contributionId, uint32 start);
    event RoundClosed(uint256 indexed round, uint32 totalPoints, bool empty);
    event Claimed(uint256 indexed contributionId, address indexed owner, uint256 amount);

    error RoundStillOpen();
    error NoOpenRound();
    error QuotaExhausted();
    error RoundExpired();
    error RoundNotEnded();
    error BadAnswer();
    error DuplicateAnswer();
    error RoundNotClosed();
    error AlreadyClaimed();
    error UnknownContribution();
    error BadConfig();

    constructor(uint256 difficultyBits_, uint256 roundLength_) {
        if (difficultyBits_ == 0 || difficultyBits_ > 255 || roundLength_ == 0) revert BadConfig();
        difficultyBits = difficultyBits_;
        roundLength = roundLength_;
        blitz = new BLITZ(address(this));
        remainingA = A_BUDGET;
    }

    // ------------------------------------------------------------------ rounds

    function openRound() external returns (uint256 id) {
        if (openRoundId != 0) revert RoundStillOpen();
        if (validRounds >= MAX_VALID_ROUNDS || remainingA < ROUND_REWARD) revert QuotaExhausted();

        id = ++roundCount;
        bytes32 seed = keccak256(abi.encode(blockhash(block.number - 1), block.chainid, address(this), id));
        uint64 deadline = uint64(block.timestamp + roundLength);

        remainingA -= ROUND_REWARD;
        openReserveA = ROUND_REWARD;
        openRoundId = id;
        rounds[id] = Round({
            seed: seed,
            openedAt: uint64(block.timestamp),
            deadline: deadline,
            totalPoints: 0,
            closed: false,
            reserved: ROUND_REWARD
        });
        emit RoundOpened(id, seed, deadline);
    }

    /// @notice Preimage = chainid || this || round || seed || miner || nonce (packed).
    function answerDigest(uint256 round, address miner, uint256 nonce) public view returns (bytes32) {
        return sha256(abi.encodePacked(block.chainid, address(this), round, rounds[round].seed, miner, nonce));
    }

    function submit(uint256 nonce) external returns (uint256 contributionId) {
        uint256 id = openRoundId;
        if (id == 0) revert NoOpenRound();
        Round storage r = rounds[id];
        if (block.timestamp >= r.deadline) revert RoundExpired();

        bytes32 digest = answerDigest(id, msg.sender, nonce);
        if (uint256(digest) >> (256 - difficultyBits) != 0) revert BadAnswer();
        if (usedAnswer[digest]) revert DuplicateAnswer();
        usedAnswer[digest] = true;

        uint32 start = r.totalPoints;
        r.totalPoints = start + 1;
        contributionId = _contributions.length;
        _contributions.push(Contribution({owner: msg.sender, round: uint32(id), start: start, claimed: false}));
        emit AnswerAccepted(id, msg.sender, contributionId, start);
    }

    function closeRound() external {
        uint256 id = openRoundId;
        if (id == 0) revert NoOpenRound();
        Round storage r = rounds[id];
        if (block.timestamp < r.deadline) revert RoundNotEnded();

        r.closed = true;
        openRoundId = 0;
        openReserveA = 0;
        bool empty = r.totalPoints == 0;
        if (empty) {
            remainingA += r.reserved; // budget returns, quota is not consumed
        } else {
            closedUnclaimedA += r.reserved;
            validRounds += 1;
        }
        emit RoundClosed(id, r.totalPoints, empty);
    }

    // ------------------------------------------------------------------ claims

    function rewardOf(uint256 contributionId) public view returns (uint256) {
        if (contributionId >= _contributions.length) revert UnknownContribution();
        Contribution storage c = _contributions[contributionId];
        Round storage r = rounds[c.round];
        if (!r.closed) revert RoundNotClosed();
        uint256 b = r.reserved;
        uint256 t = r.totalPoints;
        return (b * (uint256(c.start) + 1)) / t - (b * uint256(c.start)) / t;
    }

    /// @notice Anyone may trigger; payout always goes to the recorded owner.
    function claim(uint256 contributionId) public returns (uint256 amount) {
        amount = rewardOf(contributionId); // reverts if unknown / round not closed
        Contribution storage c = _contributions[contributionId];
        if (c.claimed) revert AlreadyClaimed();
        c.claimed = true;
        closedUnclaimedA -= amount;
        paidA += amount;
        require(IERC20(address(blitz)).transfer(c.owner, amount), "transfer failed");
        emit Claimed(contributionId, c.owner, amount);
    }

    function claimMany(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) claim(ids[i]);
    }

    // ------------------------------------------------------------------ views

    function contributionCount() external view returns (uint256) {
        return _contributions.length;
    }

    function contributions(uint256 id) external view returns (address owner, uint32 round, uint32 start, bool claimed) {
        Contribution storage c = _contributions[id];
        return (c.owner, c.round, c.start, c.claimed);
    }

    /// @dev R_A + E_A + U_A + C_A + L_B must equal 1000.
    function accountedTotal() external view returns (uint256) {
        return remainingA + openReserveA + closedUnclaimedA + paidA + LOCKED_B;
    }
}
