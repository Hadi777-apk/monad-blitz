// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DemoDistribution} from "../src/DemoDistribution.sol";
import {DistributionFactory, FaucetToken} from "../src/DistributionFactory.sol";

contract DemoDistributionTest is Test {
    DistributionFactory f;
    FaucetToken t;
    DemoDistribution d;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint64 T0 = 1000;

    function setUp() public {
        vm.warp(T0);
        f = new DistributionFactory();
        t = new FaucetToken();
        vm.startPrank(alice);
        t.faucet();
        t.approve(address(f), 100 ether);
        d = DemoDistribution(f.createDemo(IERC20(address(t)), 100 ether, T0 + 1000, T0 + 2000, T0 + 3000));
        vm.stopPrank();
    }

    function test_factoryFlagsDemoAndSetsController() public view {
        assertTrue(f.isDemo(address(d)));
        assertEq(d.controller(), alice);
        assertEq(d.treasury(), alice);
        assertEq(t.balanceOf(address(d)), 100 ether);
    }

    function test_onlyControllerCanSkip() public {
        vm.prank(bob); vm.expectRevert(DemoDistribution.NotController.selector); d.skip();
    }

    function test_skipRegistrationOpensReportingAndKeepsLaterLengths() public {
        vm.prank(bob); d.register();
        vm.prank(alice); d.skip();
        assertEq(d.registerEnd(), T0);
        assertEq(d.reportEnd(), T0 + 1000);
        assertEq(d.claimEnd(), T0 + 2000);
        vm.prank(bob); d.report(7_000_000);
        vm.prank(address(0xC)); vm.expectRevert(DemoDistribution.WrongPhase.selector); d.register();
    }

    function test_fullDemoInOneBlockTimestampWithThreeSkips() public {
        vm.prank(bob); d.register();
        vm.startPrank(alice);
        d.skip(); // registration -> reporting
        vm.stopPrank();
        vm.prank(bob); d.report(5_000_000);
        vm.prank(alice); d.skip(); // reporting -> claiming
        d.claim(bob);
        assertEq(t.balanceOf(bob), 100 ether);
        vm.prank(alice); d.skip(); // claiming -> ended
        vm.expectRevert(DemoDistribution.WrongPhase.selector); d.claim(bob);
        d.sweep();
        vm.prank(alice); vm.expectRevert(DemoDistribution.WrongPhase.selector); d.skip();
    }

    function test_withoutSkipTimesStillRule() public {
        vm.prank(bob); d.register();
        vm.prank(bob); vm.expectRevert(DemoDistribution.WrongPhase.selector); d.report(1);
        vm.warp(T0 + 1000);
        vm.prank(bob); d.report(1);
        vm.warp(T0 + 2000);
        d.claim(bob);
        assertEq(t.balanceOf(bob), 100 ether);
    }

    function test_skipDuringReportingEndsItNowAndLeavesClaimWindow() public {
        vm.prank(bob); d.register();
        vm.warp(T0 + 1500);
        vm.prank(bob); d.report(3);
        vm.prank(alice); d.skip();
        assertEq(d.reportEnd(), T0 + 1500);
        assertEq(d.claimEnd(), T0 + 1500 + 1000);
        vm.prank(bob); vm.expectRevert(DemoDistribution.WrongPhase.selector); d.report(4);
        d.claim(bob);
    }
}
