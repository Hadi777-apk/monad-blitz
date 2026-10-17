// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {UsageMining, UsageDemoToken} from "../src/UsageMining.sol";

contract UsageMiningTest is Test {
    UsageMining m;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    bytes32 constant SOURCE = keccak256("session-1");
    function setUp() public {
        vm.warp(1000);
        m = new UsageMining(address(this), 60);
        m.registerSource(SOURCE, alice, 50000);
    }
    function finish() internal { vm.warp(block.timestamp + 60); m.closeRound(); }
    function conserved() internal {
        assertEq(m.accountedTotal(), 200 ether);
        assertEq(m.token().balanceOf(address(m)) + m.paid(), 200 ether);
        assertEq(m.unclaimed() + m.paid(), m.validRounds() * 2 ether);
    }
    function test_initialBaselineDoesNotAwardHistory() public {
        assertEq(m.eligibleTokens(alice), 0);
        assertEq(m.token().balanceOf(alice), 0);
        conserved();
    }
    function test_automaticRelayPaysOriginalWallet() public {
        m.openRound(); m.reportUsage(SOURCE, 51000, bytes32(uint256(1))); finish();
        vm.prank(bob); m.claim(0);
        assertEq(m.token().balanceOf(alice), 2 ether);
        assertEq(m.token().balanceOf(bob), 0);
        conserved();
    }
    function test_onlyFixedReporterCanRegisterOrReport() public {
        vm.prank(bob); vm.expectRevert(UsageMining.NotReporter.selector);
        m.registerSource(keccak256("other"), bob, 0);
        m.openRound();
        vm.prank(bob); vm.expectRevert(UsageMining.NotReporter.selector);
        m.reportUsage(SOURCE, 51000, keccak256("report"));
    }
    function test_sourceCannotBeRebound() public {
        vm.expectRevert(UsageMining.SourceAlreadyRegistered.selector);
        m.registerSource(SOURCE, bob, 0);
    }
    function test_duplicateAndCounterRollbackRejected() public {
        m.openRound(); m.reportUsage(SOURCE, 51000, bytes32(uint256(1)));
        vm.expectRevert(UsageMining.DuplicateReport.selector);
        m.reportUsage(SOURCE, 52000, bytes32(uint256(1)));
        vm.expectRevert(UsageMining.NoNewUsage.selector);
        m.reportUsage(SOURCE, 51000, bytes32(uint256(2)));
        vm.expectRevert(UsageMining.NoNewUsage.selector);
        m.reportUsage(SOURCE, 49000, bytes32(uint256(3)));
        assertEq(m.eligibleTokens(alice), 1000);
    }
    function test_remainderCarriesAcrossRoundsAndSources() public {
        m.openRound(); m.reportUsage(SOURCE, 50650, bytes32(uint256(1))); finish();
        assertEq(m.validRounds(), 0);
        assertEq(m.remaining(), 200 ether);
        bytes32 second = keccak256("session-2");
        m.registerSource(second, alice, 90000);
        m.openRound(); m.reportUsage(second, 90800, bytes32(uint256(2))); finish();
        assertEq(m.eligibleTokens(alice), 1450);
        m.claim(0); assertEq(m.token().balanceOf(alice), 2 ether); conserved();
    }
    function test_timeBoundsAndDoubleClaim() public {
        m.openRound();
        vm.expectRevert(UsageMining.RoundStillOpen.selector); m.openRound();
        vm.expectRevert(UsageMining.RoundNotEnded.selector); m.closeRound();
        m.reportUsage(SOURCE, 51000, bytes32(uint256(1)));
        vm.expectRevert(UsageMining.RoundNotClosed.selector); m.claim(0);
        vm.warp(1060);
        vm.expectRevert(UsageMining.RoundExpired.selector);
        m.reportUsage(SOURCE, 52000, bytes32(uint256(2)));
        m.closeRound(); m.claim(0);
        vm.expectRevert(UsageMining.AlreadyClaimed.selector); m.claim(0);
        conserved();
    }
    function test_hundredRoundsCannotExceedSupply() public {
        for (uint256 i = 1; i <= 100; i++) {
            m.openRound(); m.reportUsage(SOURCE, 50000 + 1000 * i, bytes32(i)); finish(); m.claim(i - 1);
        }
        vm.expectRevert(UsageMining.QuotaExhausted.selector); m.openRound();
        assertEq(m.token().balanceOf(alice), 200 ether); conserved();
    }
    function testFuzz_weightedSplitExact(uint16 a, uint16 b) public {
        uint256 p = bound(a, 1, 10000); uint256 q = bound(b, 1, 10000);
        bytes32 second = keccak256("bob"); m.registerSource(second, bob, 0);
        m.openRound(); m.reportUsage(SOURCE, 50000 + p * 1000, bytes32(uint256(1)));
        m.reportUsage(second, q * 1000, bytes32(uint256(2))); finish();
        m.claim(0); m.claim(1);
        assertEq(m.token().balanceOf(alice) + m.token().balanceOf(bob), 2 ether); conserved();
    }
}
