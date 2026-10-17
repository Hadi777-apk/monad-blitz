// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Distribution} from "../src/Distribution.sol";
import {DistributionFactory, FaucetToken} from "../src/DistributionFactory.sol";

contract DistributionFactoryTest is Test {
    DistributionFactory f;
    FaucetToken t;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint64 T0 = 1000;

    function setUp() public {
        vm.warp(T0);
        f = new DistributionFactory();
        t = new FaucetToken();
        vm.prank(alice); t.faucet();
    }

    function _create(address who, uint256 pool) internal returns (address c) {
        vm.startPrank(who);
        t.approve(address(f), pool);
        c = f.create(IERC20(address(t)), pool, T0 + 100, T0 + 200, T0 + 300);
        vm.stopPrank();
    }

    function test_createMovesPoolAndSetsCreatorAsTreasury() public {
        address c = _create(alice, 400 ether);
        assertEq(t.balanceOf(c), 400 ether);
        assertEq(t.balanceOf(alice), 600 ether);
        assertEq(Distribution(c).treasury(), alice);
        assertEq(f.creatorOf(c), alice);
        assertEq(f.campaignCount(), 1);
    }

    function test_campaignWorksEndToEnd() public {
        address c = _create(alice, 100 ether);
        vm.prank(bob); Distribution(c).register();
        vm.warp(T0 + 100);
        vm.prank(bob); Distribution(c).report(5_000_000);
        vm.warp(T0 + 200);
        Distribution(c).claim(bob);
        assertEq(t.balanceOf(bob), 100 ether);
    }

    function test_latestIsNewestFirstAndPaginates() public {
        address a = _create(alice, 1 ether);
        address b = _create(alice, 1 ether);
        address c = _create(alice, 1 ether);
        address[] memory page = f.latest(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0], c);
        assertEq(page[1], b);
        page = f.latest(2, 5);
        assertEq(page.length, 1);
        assertEq(page[0], a);
        assertEq(f.latest(9, 5).length, 0);
    }

    function test_revertsWithoutApprovalOrZeroPoolOrBadTimes() public {
        vm.startPrank(alice);
        vm.expectRevert(); f.create(IERC20(address(t)), 1 ether, T0 + 100, T0 + 200, T0 + 300);
        t.approve(address(f), 10 ether);
        vm.expectRevert(DistributionFactory.ZeroPool.selector); f.create(IERC20(address(t)), 0, T0 + 100, T0 + 200, T0 + 300);
        vm.expectRevert(Distribution.BadConfig.selector); f.create(IERC20(address(t)), 1 ether, T0 + 200, T0 + 100, T0 + 300);
        vm.expectRevert(Distribution.BadConfig.selector); f.create(IERC20(address(t)), 1 ether, T0 - 1, T0 + 200, T0 + 300);
        vm.stopPrank();
        assertEq(f.campaignCount(), 0);
    }

    function test_faucetCooldown() public {
        vm.prank(alice); vm.expectRevert(FaucetToken.TooSoon.selector); t.faucet();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice); t.faucet();
        assertEq(t.balanceOf(alice), 2000 ether);
    }
}
