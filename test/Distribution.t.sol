// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {Distribution} from "../src/Distribution.sol";
import {UsageDemoToken} from "../src/UsageMining.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DistributionTest is Test {
    Distribution d;
    UsageDemoToken t;
    address treasury = address(0x7EA);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    uint256 alicePk = 0xA11CE;
    address alice;
    uint64 constant T0 = 1000;

    function setUp() public {
        vm.warp(T0);
        alice = vm.addr(alicePk);
        t = new UsageDemoToken();
        d = new Distribution(IERC20(address(t)), treasury, T0 + 100, T0 + 200, T0 + 300);
        t.transfer(address(d), 200 ether);
    }

    function _reg() internal { vm.prank(alice); d.register(); vm.prank(bob); d.register(); vm.prank(carol); d.register(); }
    function _window() internal { vm.warp(T0 + 100); }

    function test_registerOnceAndOnlyBeforeEnd() public {
        vm.prank(alice); d.register();
        vm.prank(alice); vm.expectRevert(Distribution.AlreadyRegistered.selector); d.register();
        assertEq(d.participantCount(), 1);
        vm.warp(T0 + 100);
        vm.prank(bob); vm.expectRevert(Distribution.WrongPhase.selector); d.register();
    }

    function test_reportOnlyInsideWindowAndWhenRegistered() public {
        _reg();
        vm.prank(alice); vm.expectRevert(Distribution.WrongPhase.selector); d.report(10);
        _window();
        vm.prank(address(0xDEAD)); vm.expectRevert(Distribution.NotRegistered.selector); d.report(10);
        vm.warp(T0 + 200);
        vm.prank(alice); vm.expectRevert(Distribution.WrongPhase.selector); d.report(10);
    }

    function test_monotonicWithoutArtificialCap() public {
        _reg(); _window();
        vm.prank(alice); d.report(500);
        vm.prank(alice); vm.expectRevert(Distribution.NoNewUsage.selector); d.report(500);
        vm.prank(alice); vm.expectRevert(Distribution.NoNewUsage.selector); d.report(400);
        vm.prank(alice); d.report(10_000_001);
        assertEq(d.usage(alice), 10_000_001);
        assertEq(d.totalUsage(), 10_000_001);
    }

    function test_sharesSumToPoolAndPaidToWallet() public {
        _reg(); _window();
        vm.prank(alice); d.report(1000);
        vm.prank(bob); d.report(3000);
        vm.prank(carol); d.report(6000);
        vm.warp(T0 + 200);
        vm.prank(address(0x9)); d.claim(alice);
        d.claim(bob); d.claim(carol);
        assertEq(t.balanceOf(alice), 20 ether);
        assertEq(t.balanceOf(bob), 60 ether);
        assertEq(t.balanceOf(carol), 120 ether);
        assertEq(t.balanceOf(address(0x9)), 0);
        vm.expectRevert(Distribution.AlreadyClaimed.selector); d.claim(alice);
    }

    function test_neverPaysOutMoreThanPool() public {
        _reg(); _window();
        vm.prank(alice); d.report(1);
        vm.prank(bob); d.report(1);
        vm.prank(carol); d.report(1);
        vm.warp(T0 + 200);
        d.claim(alice); d.claim(bob); d.claim(carol);
        assertLe(t.balanceOf(alice) + t.balanceOf(bob) + t.balanceOf(carol), 200 ether);
        assertLt(t.balanceOf(address(d)), 3); // only rounding dust left
    }

    function test_lateFundingBeforeFinalizeIsDistributed() public {
        _reg(); _window();
        vm.prank(alice); d.report(1000);
        t.transfer(address(d), 0); // no-op
        vm.warp(T0 + 200);
        d.claim(alice);
        assertEq(t.balanceOf(alice), 200 ether);
    }

    function test_noUsageNoClaimAndSweepToTreasury() public {
        _reg();
        vm.warp(T0 + 200);
        vm.expectRevert(Distribution.NothingToClaim.selector); d.claim(alice);
        vm.expectRevert(Distribution.WrongPhase.selector); d.sweep();
        vm.warp(T0 + 300);
        d.sweep();
        assertEq(t.balanceOf(treasury), 200 ether);
    }

    function test_claimClosedAfterClaimEnd() public {
        _reg(); _window();
        vm.prank(alice); d.report(10);
        vm.warp(T0 + 300);
        vm.expectRevert(Distribution.WrongPhase.selector); d.claim(alice);
    }

    function _sign(uint256 pk, address w, uint256 cum, uint256 dl) internal view returns (bytes memory) {
        bytes32 th = keccak256("Report(address wallet,uint256 cumulative,uint256 deadline)");
        bytes32 ds = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Distribution"), keccak256("1"), block.chainid, address(d)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ds, keccak256(abi.encode(th, w, cum, dl))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_reportBySigRelayedAndReplaySafe() public {
        _reg(); _window();
        bytes memory sig = _sign(alicePk, alice, 700, T0 + 150);
        vm.prank(address(0x9)); d.reportBySig(alice, 700, T0 + 150, sig);
        assertEq(d.usage(alice), 700);
        vm.expectRevert(Distribution.NoNewUsage.selector); d.reportBySig(alice, 700, T0 + 150, sig);
    }

    function test_reportBySigRejectsForgeryAndExpiry() public {
        _reg(); _window();
        bytes memory forged = _sign(0xBAD, alice, 700, T0 + 150);
        vm.expectRevert(Distribution.BadSignature.selector); d.reportBySig(alice, 700, T0 + 150, forged);
        bytes memory good = _sign(alicePk, alice, 700, T0 + 105);
        vm.warp(T0 + 106);
        vm.expectRevert(Distribution.SignatureExpired.selector); d.reportBySig(alice, 700, T0 + 105, good);
    }

    function test_participantsPagination() public {
        _reg();
        address[] memory page = d.participants(1, 5);
        assertEq(page.length, 2);
        assertEq(page[0], bob);
        assertEq(d.participants(9, 5).length, 0);
    }
}
