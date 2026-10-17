// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Mining} from "../src/Mining.sol";
import {BLITZ} from "../src/BLITZ.sol";

contract MiningTest is Test {
    Mining m;
    BLITZ blitz;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    uint256 constant ROUND_LEN = 60;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        m = new Mining(8, ROUND_LEN); // 8 bits keeps test searches short
        blitz = m.blitz();
    }

    function _solve(address who, uint256 start) internal view returns (uint256 n) {
        uint256 round = m.openRoundId();
        for (n = start;; n++) {
            if (uint256(m.answerDigest(round, who, n)) >> 248 == 0) return n;
        }
    }

    function _mine(address who, uint256 start) internal returns (uint256 nonce) {
        nonce = _solve(who, start);
        vm.prank(who);
        m.submit(nonce);
    }

    function _closeAfterDeadline() internal {
        vm.warp(block.timestamp + ROUND_LEN);
        m.closeRound();
    }

    function _assertConserved() internal {
        assertEq(m.accountedTotal(), 1000 ether, "R+E+U+C+L");
        assertEq(m.closedUnclaimedA() + m.paidA(), 8 ether * m.validRounds());
        assertEq(blitz.totalSupply(), 1000 ether);
        assertEq(blitz.balanceOf(address(m)) + m.paidA(), 1000 ether);
    }

    function test_initialState() public {
        assertEq(blitz.totalSupply(), 1000 ether);
        assertEq(blitz.balanceOf(address(m)), 1000 ether);
        assertEq(m.remainingA(), 800 ether);
        _assertConserved();
    }

    function test_singleMinerGetsWholeRound() public {
        m.openRound();
        assertEq(m.openReserveA(), 8 ether);
        _mine(alice, 0);
        _closeAfterDeadline();
        assertEq(m.claim(0), 8 ether);
        assertEq(blitz.balanceOf(alice), 8 ether);
        assertEq(m.validRounds(), 1);
        _assertConserved();
    }

    function test_threeEqualContributionsSumToEight() public {
        m.openRound();
        _mine(alice, 0);
        _mine(bob, 0);
        _mine(carol, 0);
        _closeAfterDeadline();
        assertEq(m.rewardOf(0), 2_666_666_666_666_666_666);
        assertEq(m.rewardOf(1), 2_666_666_666_666_666_667);
        assertEq(m.rewardOf(2), 2_666_666_666_666_666_667);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 0;
        ids[1] = 1;
        ids[2] = 2;
        m.claimMany(ids);
        assertEq(blitz.balanceOf(alice) + blitz.balanceOf(bob) + blitz.balanceOf(carol), 8 ether);
        assertEq(m.closedUnclaimedA(), 0);
        _assertConserved();
    }

    function test_emptyRoundReturnsBudgetAndKeepsQuota() public {
        m.openRound();
        _closeAfterDeadline();
        assertEq(m.remainingA(), 800 ether);
        assertEq(m.validRounds(), 0);
        assertEq(m.openReserveA(), 0);
        _assertConserved();
        m.openRound(); // can reopen immediately
        assertEq(m.roundCount(), 2);
    }

    function test_onlyOneRoundAtATime() public {
        m.openRound();
        vm.expectRevert(Mining.RoundStillOpen.selector);
        m.openRound();
    }

    function test_deadlineBoundaries() public {
        m.openRound();
        uint256 n = _solve(alice, 0);
        uint256 deadline = block.timestamp + ROUND_LEN;
        vm.warp(deadline - 1);
        vm.prank(alice);
        m.submit(n); // still valid just before
        vm.warp(deadline);
        vm.expectRevert(Mining.RoundExpired.selector);
        vm.prank(alice);
        m.submit(n + 1);
        m.closeRound(); // allowed exactly at deadline
    }

    function test_cannotCloseEarly() public {
        m.openRound();
        vm.warp(block.timestamp + ROUND_LEN - 1);
        vm.expectRevert(Mining.RoundNotEnded.selector);
        m.closeRound();
    }

    function test_badAnswerAndDuplicateRejected() public {
        m.openRound();
        uint256 n = _solve(alice, 0);
        uint256 bad = n + 1;
        while (uint256(m.answerDigest(1, alice, bad)) >> 248 == 0) bad++;
        vm.expectRevert(Mining.BadAnswer.selector);
        vm.prank(alice);
        m.submit(bad);
        vm.prank(alice);
        m.submit(n);
        vm.expectRevert(Mining.DuplicateAnswer.selector);
        vm.prank(alice);
        m.submit(n);
    }

    function test_answerBoundToWallet() public {
        m.openRound();
        uint256 n = _solve(alice, 0);
        // Bob replaying Alice's nonce almost surely fails the 8-bit check (digest differs)
        assertTrue(m.answerDigest(1, alice, n) != m.answerDigest(1, bob, n));
    }

    function test_answerBoundToChainAndInstance() public {
        m.openRound();
        bytes32 d1 = m.answerDigest(1, alice, 7);
        vm.chainId(999);
        assertTrue(d1 != m.answerDigest(1, alice, 7));
        vm.chainId(31337);
        Mining m2 = new Mining(8, ROUND_LEN);
        m2.openRound();
        assertTrue(m2.answerDigest(1, alice, 7) != d1);
    }

    function test_claimBeforeCloseReverts() public {
        m.openRound();
        _mine(alice, 0);
        vm.expectRevert(Mining.RoundNotClosed.selector);
        m.claim(0);
    }

    function test_doubleClaimReverts() public {
        m.openRound();
        _mine(alice, 0);
        _closeAfterDeadline();
        m.claim(0);
        vm.expectRevert(Mining.AlreadyClaimed.selector);
        m.claim(0);
    }

    function test_claimPaysRecordedOwnerNotCaller() public {
        m.openRound();
        _mine(alice, 0);
        _closeAfterDeadline();
        vm.prank(bob);
        m.claim(0);
        assertEq(blitz.balanceOf(alice), 8 ether);
        assertEq(blitz.balanceOf(bob), 0);
    }

    function test_unknownContributionReverts() public {
        vm.expectRevert(Mining.UnknownContribution.selector);
        m.claim(5);
    }

    /// Plays all 100 valid rounds, interleaving an empty round, then checks no 101st round and B locked.
    function test_hundredValidRoundsThenQuotaExhausted() public {
        for (uint256 i = 0; i < 100; i++) {
            m.openRound();
            if (i % 10 == 3) {
                _closeAfterDeadline(); // empty, doesn't count
                m.openRound();
            }
            _mine(i % 2 == 0 ? alice : bob, i * 1000);
            _closeAfterDeadline();
        }
        assertEq(m.validRounds(), 100);
        assertEq(m.remainingA(), 0);
        vm.expectRevert(Mining.QuotaExhausted.selector);
        m.openRound();

        uint256 n = m.contributionCount();
        assertEq(n, 100);
        for (uint256 i = 0; i < n; i++) m.claim(i);
        assertEq(m.paidA(), 800 ether);
        assertEq(m.closedUnclaimedA(), 0);
        assertEq(blitz.balanceOf(address(m)), 200 ether); // B stays locked
        assertEq(blitz.balanceOf(alice) + blitz.balanceOf(bob), 800 ether);
        _assertConserved();
    }

    function testFuzz_roundPayoutsSumToBudget(uint8 minersRaw) public {
        uint256 k = bound(minersRaw, 1, 25);
        m.openRound();
        uint256 nonce;
        for (uint256 i = 0; i < k; i++) {
            address who = address(uint160(0x1000 + (i % 7)));
            nonce = _solve(who, nonce);
            vm.prank(who);
            m.submit(nonce);
            nonce++;
        }
        _closeAfterDeadline();
        uint256 total;
        for (uint256 i = 0; i < k; i++) total += m.claim(i);
        assertEq(total, 8 ether);
        _assertConserved();
    }

    function test_noWayToMoveLockedB() public {
        // Mining exposes no function that transfers BLITZ except claim; BLITZ has no mint/burn.
        assertEq(blitz.balanceOf(address(m)) - m.closedUnclaimedA() - m.openReserveA() - m.remainingA(), 200 ether);
    }

    function test_badConfig() public {
        vm.expectRevert(Mining.BadConfig.selector);
        new Mining(0, 60);
        vm.expectRevert(Mining.BadConfig.selector);
        new Mining(8, 0);
    }
}
