// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {MockPayToken} from "../src/mocks/MockPayToken.sol";
import {MockNFT} from "../src/mocks/MockNFT.sol";

contract NoReceiver {} // contract without onERC721Received

contract EscrowTest is Test {
    Escrow e;
    MockPayToken pay;
    MockNFT nft;

    uint256 buyerPk = 0xB0B;
    uint256 sellerPk = 0x5E11;
    address buyer;
    address seller;
    address stranger = address(0xDEAD);
    uint256 constant P = 100 ether;
    uint256 tokenId;
    uint256 T0;

    function setUp() public {
        vm.warp(1_000_000);
        T0 = block.timestamp;
        pay = new MockPayToken();
        nft = new MockNFT();
        e = new Escrow(pay, nft);
        buyer = vm.addr(buyerPk);
        seller = vm.addr(sellerPk);
        pay.mint(buyer, 1000 ether);
        pay.mint(seller, 1000 ether);
        tokenId = nft.mint(seller);
        vm.prank(buyer);
        pay.approve(address(e), type(uint256).max);
        vm.startPrank(seller);
        pay.approve(address(e), type(uint256).max);
        nft.setApprovalForAll(address(e), true);
        vm.stopPrank();
    }

    function _terms(uint256 nonce) internal view returns (Escrow.Order memory) {
        return Escrow.Order({
            buyer: buyer,
            seller: seller,
            paymentAsset: address(pay),
            price: P,
            nft: address(nft),
            tokenId: tokenId,
            fundingDeadline: uint64(T0 + 10 minutes),
            deliveryDeadline: uint64(T0 + 15 minutes),
            version: 1,
            nonce: nonce
        });
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _create(Escrow.Order memory o) internal returns (bytes32 id) {
        id = e.hashOrder(o);
        bytes memory bs = _sign(buyerPk, id);
        bytes memory ss = _sign(sellerPk, id);
        vm.prank(buyer);
        e.createOrder(o, bs, ss);
    }

    function _newOrder() internal returns (bytes32) {
        return _create(_terms(1));
    }

    function _fundBoth(bytes32 id) internal {
        vm.prank(buyer);
        e.fundBuyer(id);
        vm.prank(seller);
        e.fundSeller(id);
    }

    function _bal(address who) internal view returns (uint256) {
        return e.balances(who, address(pay));
    }

    // ---------------------------------------------------------------- happy path

    function test_happyPath() public {
        bytes32 id = _newOrder();
        _fundBoth(id);
        assertTrue(e.isFullyFunded(id));
        assertEq(nft.ownerOf(tokenId), address(e));
        vm.prank(stranger);
        e.complete(id);
        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(_bal(seller), 2 * P);
        assertEq(_bal(buyer), 0);
        assertEq(uint8(e.getOrder(id).stage), uint8(Escrow.Stage.Completed));
        vm.prank(seller);
        e.withdraw(address(pay));
        assertEq(pay.balanceOf(seller), 1000 ether + P); // got deposit back plus payment
        assertEq(pay.balanceOf(buyer), 1000 ether - P);
        assertEq(pay.balanceOf(address(e)), 0);
        assertEq(e.liveOrderOfNft(e.nftKey(address(nft), tokenId)), bytes32(0));
    }

    function test_cannotCompleteTwiceOrExitAfterComplete() public {
        bytes32 id = _newOrder();
        _fundBoth(id);
        e.complete(id);
        vm.expectRevert(Escrow.WrongStage.selector);
        e.complete(id);
        vm.warp(T0 + 20 minutes);
        vm.expectRevert(Escrow.WrongStage.selector);
        e.deliveryTimeoutExit(id);
        vm.expectRevert(Escrow.WrongStage.selector);
        e.fundingTimeoutExit(id);
    }

    // ---------------------------------------------------------------- create rules

    function test_createRequiresBothValidSignatures() public {
        Escrow.Order memory o = _terms(1);
        bytes32 id = e.hashOrder(o);
        bytes memory good = _sign(buyerPk, id);
        bytes memory bad = _sign(0xBAD, id);
        vm.prank(buyer);
        vm.expectRevert(Escrow.BadSignature.selector);
        e.createOrder(o, good, bad);
        vm.prank(buyer);
        vm.expectRevert(Escrow.BadSignature.selector);
        e.createOrder(o, bad, _sign(sellerPk, id));
    }

    function test_createOnlyByParty() public {
        Escrow.Order memory o = _terms(1);
        bytes32 id = e.hashOrder(o);
        vm.prank(stranger);
        vm.expectRevert(Escrow.NotParty.selector);
        e.createOrder(o, _sign(buyerPk, id), _sign(sellerPk, id));
    }

    function test_createRejectsBadTerms() public {
        Escrow.Order memory o = _terms(1);
        o.price = 0;
        _expectBadTerms(o);
        o = _terms(1);
        o.fundingDeadline = uint64(block.timestamp); // now < F fails
        _expectBadTerms(o);
        o = _terms(1);
        o.deliveryDeadline = o.fundingDeadline; // F < D fails
        _expectBadTerms(o);
        o = _terms(1);
        o.version = 2;
        _expectBadTerms(o);
        o = _terms(1);
        o.paymentAsset = address(0x1234);
        _expectBadTerms(o);
        o = _terms(1);
        o.nft = address(0x1234);
        _expectBadTerms(o);
        o = _terms(1);
        o.seller = buyer;
        _expectBadTerms(o);
    }

    function _expectBadTerms(Escrow.Order memory o) internal {
        vm.prank(buyer);
        vm.expectRevert(Escrow.BadTerms.selector);
        e.createOrder(o, "", "");
    }

    function test_signatureNotReplayableAfterCreateOrOnOtherDomain() public {
        Escrow.Order memory o = _terms(1);
        _create(o);
        bytes32 id = e.hashOrder(o);
        vm.prank(buyer);
        vm.expectRevert(Escrow.AuthorizationUnavailable.selector);
        e.createOrder(o, _sign(buyerPk, id), _sign(sellerPk, id));

        // Same terms, different Escrow instance (different verifyingContract) => different hash
        Escrow e2 = new Escrow(pay, nft);
        assertTrue(e2.hashOrder(o) != id);
        // Different chain id => different hash
        vm.chainId(4242);
        Escrow e3 = new Escrow(pay, nft);
        assertTrue(e3.hashOrder(o) != id);
    }

    function test_cancelledAuthorizationCannotBeUsed() public {
        Escrow.Order memory o = _terms(1);
        bytes32 id = e.hashOrder(o);
        bytes memory bs = _sign(buyerPk, id);
        bytes memory ss = _sign(sellerPk, id);
        vm.prank(stranger);
        vm.expectRevert(Escrow.NotParty.selector);
        e.cancelAuthorization(o);
        vm.prank(seller);
        e.cancelAuthorization(o);
        vm.prank(buyer);
        vm.expectRevert(Escrow.AuthorizationUnavailable.selector);
        e.createOrder(o, bs, ss);
    }

    function test_cancelUnfundedOnlyBeforeAnyDeposit() public {
        bytes32 id = _newOrder();
        vm.prank(buyer);
        e.fundBuyer(id);
        vm.prank(seller);
        vm.expectRevert(Escrow.Funded.selector);
        e.cancelUnfunded(id);

        // a fresh unfunded order with different token can be cancelled and frees NFT reservation
        uint256 t2 = nft.mint(seller);
        Escrow.Order memory o = _terms(2);
        o.tokenId = t2;
        bytes32 id2 = _create(o);
        vm.prank(buyer);
        e.cancelUnfunded(id2);
        assertEq(uint8(e.getOrder(id2).stage), uint8(Escrow.Stage.Cancelled));
        assertEq(e.liveOrderOfNft(e.nftKey(address(nft), t2)), bytes32(0));
        vm.prank(buyer);
        vm.expectRevert(Escrow.WrongStage.selector);
        e.fundBuyer(id2);
    }

    function test_sameNftCannotBeInTwoLiveOrders() public {
        _newOrder();
        Escrow.Order memory o = _terms(2); // same token, different nonce
        bytes32 id = e.hashOrder(o);
        vm.prank(buyer);
        vm.expectRevert(Escrow.NftAlreadyReserved.selector);
        e.createOrder(o, _sign(buyerPk, id), _sign(sellerPk, id));
    }

    // ------------------------------------------------------------------- funding

    function test_fundingGuards() public {
        bytes32 id = _newOrder();
        vm.prank(stranger);
        vm.expectRevert(Escrow.NotAuthorized.selector);
        e.fundBuyer(id);
        vm.prank(buyer);
        vm.expectRevert(Escrow.NotAuthorized.selector);
        e.fundSeller(id);

        vm.prank(buyer);
        e.fundBuyer(id);
        vm.prank(buyer);
        vm.expectRevert(Escrow.AlreadyFunded.selector);
        e.fundBuyer(id);
        vm.prank(seller);
        e.fundSeller(id);
        vm.prank(seller);
        vm.expectRevert(Escrow.AlreadyFunded.selector);
        e.fundSeller(id);
        assertEq(pay.balanceOf(address(e)), 2 * P);
    }

    function test_fundSellerFailsIfNftNotOwnedBySeller() public {
        bytes32 id = _newOrder();
        vm.prank(seller);
        nft.transferFrom(seller, stranger, tokenId);
        vm.prank(seller);
        vm.expectRevert(Escrow.WrongNftOwner.selector);
        e.fundSeller(id);
    }

    function test_fundingRejectedExactlyAtF() public {
        bytes32 id = _newOrder();
        vm.warp(T0 + 10 minutes - 1);
        vm.prank(buyer);
        e.fundBuyer(id); // last valid second
        vm.warp(T0 + 10 minutes);
        vm.prank(seller);
        vm.expectRevert(Escrow.TooLate.selector);
        e.fundSeller(id);
    }

    function test_directNftSendToEscrowRejected() public {
        vm.prank(seller);
        vm.expectRevert();
        nft.safeTransferFrom(seller, address(e), tokenId);
    }

    // ---------------------------------------------------------- funding timeout

    function test_fundingTimeoutBuyerOnly() public {
        bytes32 id = _newOrder();
        vm.prank(buyer);
        e.fundBuyer(id);
        vm.warp(T0 + 10 minutes - 1);
        vm.expectRevert(Escrow.TooEarly.selector);
        e.fundingTimeoutExit(id);
        vm.warp(T0 + 10 minutes);
        vm.prank(stranger);
        e.fundingTimeoutExit(id);
        assertEq(_bal(buyer), P);
        assertEq(_bal(seller), 0);
        assertFalse(e.getOrder(id).nftReturnPending);
        assertEq(e.liveOrderOfNft(e.nftKey(address(nft), tokenId)), bytes32(0));
        vm.expectRevert(Escrow.WrongStage.selector);
        e.fundingTimeoutExit(id); // no second credit
        vm.prank(buyer);
        e.withdraw(address(pay));
        assertEq(pay.balanceOf(buyer), 1000 ether);
    }

    function test_fundingTimeoutSellerOnlyKeepsNftRecoverable() public {
        bytes32 id = _newOrder();
        vm.prank(seller);
        e.fundSeller(id);
        vm.warp(T0 + 10 minutes);
        e.fundingTimeoutExit(id);
        assertEq(_bal(seller), P);
        assertTrue(e.getOrder(id).nftReturnPending);
        assertEq(nft.ownerOf(tokenId), address(e)); // exit made no NFT call
        // NFT keeps reservation while pending
        assertEq(e.liveOrderOfNft(e.nftKey(address(nft), tokenId)), id);
        vm.prank(seller);
        e.recoverNFT(id, seller);
        assertEq(nft.ownerOf(tokenId), seller);
        assertEq(e.liveOrderOfNft(e.nftKey(address(nft), tokenId)), bytes32(0));
    }

    function test_fundingTimeoutCannotCancelFullyFundedOrder() public {
        bytes32 id = _newOrder();
        _fundBoth(id);
        vm.warp(T0 + 10 minutes);
        vm.expectRevert(Escrow.Funded.selector);
        e.fundingTimeoutExit(id);
        // fully funded after F remains completable before D
        e.complete(id);
        assertEq(nft.ownerOf(tokenId), buyer);
    }

    // ---------------------------------------------------------- delivery timeout

    function test_deliveryTimeoutBoundaries() public {
        bytes32 id = _newOrder();
        _fundBoth(id);
        vm.warp(T0 + 15 minutes - 1);
        vm.expectRevert(Escrow.TooEarly.selector);
        e.deliveryTimeoutExit(id);
        vm.warp(T0 + 15 minutes);
        vm.expectRevert(Escrow.TooLate.selector);
        e.complete(id); // rejected exactly at D
        e.deliveryTimeoutExit(id);
        assertEq(_bal(buyer), P);
        assertEq(_bal(seller), P);
        assertTrue(e.getOrder(id).nftReturnPending);
        vm.expectRevert(Escrow.WrongStage.selector);
        e.deliveryTimeoutExit(id);
        vm.expectRevert(Escrow.WrongStage.selector);
        e.complete(id);
    }

    function test_deliveryTimeoutNotAvailableIfNotFullyFunded() public {
        bytes32 id = _newOrder();
        vm.prank(buyer);
        e.fundBuyer(id);
        vm.warp(T0 + 15 minutes);
        vm.expectRevert(Escrow.NotFullyFunded.selector);
        e.deliveryTimeoutExit(id);
        e.fundingTimeoutExit(id); // right path
    }

    function test_completeRequiresFullFunding() public {
        bytes32 id = _newOrder();
        vm.prank(buyer);
        e.fundBuyer(id);
        vm.expectRevert(Escrow.NotFullyFunded.selector);
        e.complete(id);
    }

    // --------------------------------------------------- atomic failed delivery

    function test_failedNftDeliveryRollsBackCompletion() public {
        NoReceiver bad = new NoReceiver();
        // Buyer must be an EOA to sign; use a contract buyer via ERC-1271? Simpler: build the
        // order with an EOA buyer, then verify atomicity through a rejecting NFT transfer path
        // by making the buyer address a non-receiver contract through vm.etch.
        bytes32 id = _newOrder();
        _fundBoth(id);
        vm.etch(buyer, address(bad).code);
        vm.expectRevert();
        e.complete(id);
        Escrow.OrderState memory s = e.getOrder(id);
        assertEq(uint8(s.stage), uint8(Escrow.Stage.AwaitingFunding));
        assertEq(_bal(seller), 0);
        assertEq(nft.ownerOf(tokenId), address(e));
        // still exits cleanly at D
        vm.warp(T0 + 15 minutes);
        e.deliveryTimeoutExit(id);
        assertEq(_bal(seller), P);
    }

    // ------------------------------------------------------------ NFT recovery

    function _refundWithCustody() internal returns (bytes32 id) {
        id = _newOrder();
        _fundBoth(id);
        vm.warp(T0 + 15 minutes);
        e.deliveryTimeoutExit(id);
    }

    function test_recoveryOnlySellerAndOnce() public {
        bytes32 id = _refundWithCustody();
        vm.prank(buyer);
        vm.expectRevert(Escrow.NotAuthorized.selector);
        e.recoverNFT(id, buyer);
        vm.prank(seller);
        vm.expectRevert(Escrow.BadReceiver.selector);
        e.recoverNFT(id, address(0));
        vm.prank(seller);
        vm.expectRevert(Escrow.BadReceiver.selector);
        e.recoverNFT(id, address(e));
        vm.prank(seller);
        e.recoverNFT(id, seller);
        vm.prank(seller);
        vm.expectRevert(Escrow.NothingPending.selector);
        e.recoverNFT(id, seller);
    }

    function test_rejectedRecoveryKeepsEntitlementAndRefunds() public {
        bytes32 id = _refundWithCustody();
        NoReceiver bad = new NoReceiver();
        vm.prank(seller);
        vm.expectRevert();
        e.recoverNFT(id, address(bad));
        assertTrue(e.getOrder(id).nftReturnPending);
        assertEq(_bal(seller), P);
        assertEq(_bal(buyer), P);
        vm.prank(seller);
        e.recoverNFT(id, stranger); // retry to a valid address
        assertEq(nft.ownerOf(tokenId), stranger);
        // refunds still withdrawable
        vm.prank(seller);
        e.withdraw(address(pay));
        vm.prank(buyer);
        e.withdraw(address(pay));
        assertEq(pay.balanceOf(address(e)), 0);
    }

    function _recoverySig(bytes32 id, address receiver, uint256 nonce, uint256 expiry, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, e.hashRecovery(id, receiver, nonce, expiry));
    }

    function test_authorizedRecoveryByThirdParty() public {
        bytes32 id = _refundWithCustody();
        address receiver = address(0xFEED);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _recoverySig(id, receiver, 7, expiry, sellerPk);

        // wrong receiver (caller tries to redirect) fails signature check
        vm.prank(stranger);
        vm.expectRevert(Escrow.BadSignature.selector);
        e.recoverNFTWithAuth(id, stranger, 7, expiry, sig);

        // signature from non-seller fails
        bytes memory forged = _recoverySig(id, receiver, 7, expiry, buyerPk);
        vm.prank(stranger);
        vm.expectRevert(Escrow.BadSignature.selector);
        e.recoverNFTWithAuth(id, receiver, 7, expiry, forged);

        vm.prank(stranger);
        e.recoverNFTWithAuth(id, receiver, 7, expiry, sig);
        assertEq(nft.ownerOf(tokenId), receiver);

        // replay fails (nonce used)
        vm.prank(stranger);
        vm.expectRevert(Escrow.NonceUsed.selector);
        e.recoverNFTWithAuth(id, receiver, 7, expiry, sig);
    }

    function test_authorizedRecoveryExpiredFails() public {
        bytes32 id = _refundWithCustody();
        uint256 expiry = block.timestamp + 100;
        bytes memory sig = _recoverySig(id, stranger, 1, expiry, sellerPk);
        vm.warp(expiry + 1);
        vm.expectRevert(Escrow.AuthExpired.selector);
        e.recoverNFTWithAuth(id, stranger, 1, expiry, sig);
    }

    function test_authorizationBoundToOrder() public {
        bytes32 id = _refundWithCustody();
        // sign for a different (nonexistent) order id; must not work on this one
        bytes32 other = keccak256("other");
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _sign(sellerPk, keccak256(abi.encode(other)));
        vm.expectRevert(Escrow.BadSignature.selector);
        e.recoverNFTWithAuth(id, stranger, 1, expiry, sig);
    }

    function test_noRecoveryWhenNothingPending() public {
        bytes32 id = _newOrder();
        vm.prank(seller);
        vm.expectRevert(Escrow.NothingPending.selector);
        e.recoverNFT(id, seller);
    }

    // ------------------------------------------------------- withdraw + accounting

    function test_withdrawNothingReverts() public {
        vm.prank(stranger);
        vm.expectRevert(Escrow.NoBalance.selector);
        e.withdraw(address(pay));
    }

    function test_conservationAcrossScenarios() public {
        // order 1: completed
        bytes32 id1 = _newOrder();
        _fundBoth(id1);
        e.complete(id1);
        // order 2: delivery-timeout refund
        uint256 t2 = nft.mint(seller);
        Escrow.Order memory o2 = _terms(2);
        o2.tokenId = t2;
        bytes32 id2 = _create(o2);
        _fundBoth(id2);
        // order 3: funding timeout with buyer only
        uint256 t3 = nft.mint(seller);
        Escrow.Order memory o3 = _terms(3);
        o3.tokenId = t3;
        bytes32 id3 = _create(o3);
        vm.prank(buyer);
        e.fundBuyer(id3);

        // held = deposits(2P + 2P + P) = 5P ; credited so far = 2P (order 1)
        assertEq(pay.balanceOf(address(e)), 5 * P);
        vm.warp(T0 + 15 minutes);
        e.deliveryTimeoutExit(id2);
        e.fundingTimeoutExit(id3);
        uint256 credited = _bal(buyer) + _bal(seller);
        assertEq(credited, 5 * P);
        assertEq(pay.balanceOf(address(e)), credited);
        vm.prank(buyer);
        e.withdraw(address(pay));
        vm.prank(seller);
        e.withdraw(address(pay));
        assertEq(pay.balanceOf(address(e)), 0);
        assertEq(pay.balanceOf(buyer) + pay.balanceOf(seller), 2000 ether); // nothing created or lost
    }

    function test_reentrantWithdrawGuard() public {
        // withdrawals zero the balance before transfer and use nonReentrant; basic double-withdraw check
        bytes32 id = _newOrder();
        _fundBoth(id);
        e.complete(id);
        vm.prank(seller);
        e.withdraw(address(pay));
        vm.prank(seller);
        vm.expectRevert(Escrow.NoBalance.selector);
        e.withdraw(address(pay));
        id;
    }
}
