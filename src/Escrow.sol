// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Same-chain test-NFT escrow (v0.5). Buyer and seller each deposit P; the NFT is
/// actually custodied. Successful delivery atomically sends the NFT to the buyer and credits
/// the seller 2P. Timeouts credit refunds and never touch the NFT; NFT recovery is a separate
/// action. No owner, no arbiter, not upgradeable. Does not call Mining.
/// First version is limited to one payment ERC-20 and one ERC-721 contract (set at deploy).
contract Escrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PROTOCOL_VERSION = 1;

    enum Stage {
        None,
        AwaitingFunding, // created; may be partly funded; Funded is derived (see isFullyFunded)
        Completed,
        Refunded,
        Cancelled
    }

    struct Order {
        address buyer;
        address seller;
        address paymentAsset;
        uint256 price;
        address nft;
        uint256 tokenId;
        uint64 fundingDeadline;
        uint64 deliveryDeadline;
        uint256 version;
        uint256 nonce;
    }

    struct OrderState {
        Stage stage;
        bool buyerFunded;
        bool sellerFunded; // implies NFT custody
        bool nftReturnPending; // entitlement of the original seller
        Order terms;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address buyer,address seller,address paymentAsset,uint256 price,address nft,uint256 tokenId,uint64 fundingDeadline,uint64 deliveryDeadline,uint256 version,uint256 nonce)"
    );
    bytes32 public constant RECOVER_TYPEHASH = keccak256(
        "RecoverNFT(bytes32 orderId,address nft,uint256 tokenId,address receiver,bytes32 action,uint256 version,uint256 nonce,uint256 expiry)"
    );
    bytes32 public constant RECOVER_ACTION = keccak256("RECOVER_NFT");

    IERC20 public immutable paymentAsset;
    IERC721 public immutable nftContract;

    mapping(bytes32 => OrderState) private _orders;
    mapping(bytes32 => bool) public cancelledAuthorization; // cancelled before creation
    /// @dev nftKey => live orderId (held until delivered, or until refunded and NFT recovered).
    mapping(bytes32 => bytes32) public liveOrderOfNft;
    mapping(address => mapping(address => uint256)) public balances; // owner => asset => claimable
    mapping(address => mapping(uint256 => bool)) public usedRecoveryNonce; // seller => nonce

    event OrderCreated(bytes32 indexed orderId, address indexed buyer, address indexed seller);
    event OrderAuthorizationCancelled(bytes32 indexed orderId, address indexed by);
    event OrderCancelled(bytes32 indexed orderId);
    event BuyerFunded(bytes32 indexed orderId);
    event SellerFunded(bytes32 indexed orderId);
    event Completed(bytes32 indexed orderId);
    event RefundedFundingTimeout(bytes32 indexed orderId);
    event RefundedDeliveryTimeout(bytes32 indexed orderId);
    event NFTRecovered(bytes32 indexed orderId, address indexed receiver);
    event Withdrawn(address indexed owner, address indexed asset, uint256 amount);

    error BadTerms();
    error BadSignature();
    error NotParty();
    error AuthorizationUnavailable();
    error NftAlreadyReserved();
    error WrongStage();
    error TooLate();
    error TooEarly();
    error AlreadyFunded();
    error NotFullyFunded();
    error Funded();
    error NotAuthorized();
    error NothingPending();
    error BadReceiver();
    error AuthExpired();
    error NonceUsed();
    error WrongNftOwner();
    error InexactDeposit();
    error NoBalance();

    constructor(IERC20 paymentAsset_, IERC721 nft_) EIP712("MonadBlitzEscrow", "1") {
        paymentAsset = paymentAsset_;
        nftContract = nft_;
    }

    // ----------------------------------------------------------------- hashing

    function hashOrder(Order memory o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    o.buyer,
                    o.seller,
                    o.paymentAsset,
                    o.price,
                    o.nft,
                    o.tokenId,
                    o.fundingDeadline,
                    o.deliveryDeadline,
                    o.version,
                    o.nonce
                )
            )
        );
    }

    function hashRecovery(bytes32 orderId, address receiver, uint256 nonce, uint256 expiry)
        public
        view
        returns (bytes32)
    {
        Order storage o = _orders[orderId].terms;
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECOVER_TYPEHASH,
                    orderId,
                    o.nft,
                    o.tokenId,
                    receiver,
                    RECOVER_ACTION,
                    PROTOCOL_VERSION,
                    nonce,
                    expiry
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ create

    /// @notice Either party submits the order with both EIP-712 signatures.
    function createOrder(Order calldata o, bytes calldata buyerSig, bytes calldata sellerSig)
        external
        returns (bytes32 id)
    {
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotParty();
        if (
            o.price == 0 || o.buyer == address(0) || o.seller == address(0) || o.buyer == o.seller
                || o.version != PROTOCOL_VERSION || o.paymentAsset != address(paymentAsset)
                || o.nft != address(nftContract) || !(block.timestamp < o.fundingDeadline)
                || !(o.fundingDeadline < o.deliveryDeadline)
        ) revert BadTerms();

        id = hashOrder(o);
        if (cancelledAuthorization[id] || _orders[id].stage != Stage.None) revert AuthorizationUnavailable();
        if (
            !SignatureChecker.isValidSignatureNow(o.buyer, id, buyerSig)
                || !SignatureChecker.isValidSignatureNow(o.seller, id, sellerSig)
        ) revert BadSignature();

        bytes32 key = _nftKey(o.nft, o.tokenId);
        if (liveOrderOfNft[key] != bytes32(0)) revert NftAlreadyReserved();
        liveOrderOfNft[key] = id;

        OrderState storage s = _orders[id];
        s.stage = Stage.AwaitingFunding;
        s.terms = o;
        emit OrderCreated(id, o.buyer, o.seller);
    }

    /// @notice A party kills a signed order that is not yet created.
    function cancelAuthorization(Order calldata o) external {
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotParty();
        bytes32 id = hashOrder(o);
        if (_orders[id].stage != Stage.None) revert AuthorizationUnavailable();
        cancelledAuthorization[id] = true;
        emit OrderAuthorizationCancelled(id, msg.sender);
    }

    /// @notice A party cancels a created order that has received no funds at all.
    function cancelUnfunded(bytes32 id) external {
        OrderState storage s = _orders[id];
        if (s.stage != Stage.AwaitingFunding) revert WrongStage();
        if (msg.sender != s.terms.buyer && msg.sender != s.terms.seller) revert NotParty();
        if (s.buyerFunded || s.sellerFunded) revert Funded();
        s.stage = Stage.Cancelled;
        delete liveOrderOfNft[_nftKey(s.terms.nft, s.terms.tokenId)];
        emit OrderCancelled(id);
    }

    // -------------------------------------------------------------------- fund

    function fundBuyer(bytes32 id) external nonReentrant {
        OrderState storage s = _orders[id];
        _requireFundable(s);
        if (msg.sender != s.terms.buyer) revert NotAuthorized();
        if (s.buyerFunded) revert AlreadyFunded();
        s.buyerFunded = true;
        _pull(msg.sender, s.terms.price);
        emit BuyerFunded(id);
    }

    /// @notice Seller deposits P and the exact NFT into custody. Needs prior ERC-20 and ERC-721 approvals.
    function fundSeller(bytes32 id) external nonReentrant {
        OrderState storage s = _orders[id];
        _requireFundable(s);
        if (msg.sender != s.terms.seller) revert NotAuthorized();
        if (s.sellerFunded) revert AlreadyFunded();
        s.sellerFunded = true;
        _pull(msg.sender, s.terms.price);
        if (nftContract.ownerOf(s.terms.tokenId) != msg.sender) revert WrongNftOwner();
        nftContract.transferFrom(msg.sender, address(this), s.terms.tokenId);
        if (nftContract.ownerOf(s.terms.tokenId) != address(this)) revert WrongNftOwner();
        emit SellerFunded(id);
    }

    // ---------------------------------------------------------------- complete

    function complete(bytes32 id) external nonReentrant {
        OrderState storage s = _orders[id];
        if (s.stage != Stage.AwaitingFunding) revert WrongStage();
        if (!_fullyFunded(s)) revert NotFullyFunded();
        if (!(block.timestamp < s.terms.deliveryDeadline)) revert TooLate();

        s.stage = Stage.Completed;
        balances[s.terms.seller][address(paymentAsset)] += 2 * s.terms.price;
        delete liveOrderOfNft[_nftKey(s.terms.nft, s.terms.tokenId)];
        // External call last; a revert here (e.g. buyer contract rejects) rolls back stage and credit.
        nftContract.safeTransferFrom(address(this), s.terms.buyer, s.terms.tokenId);
        emit Completed(id);
    }

    // ---------------------------------------------------------------- timeouts

    function fundingTimeoutExit(bytes32 id) external {
        OrderState storage s = _orders[id];
        if (s.stage != Stage.AwaitingFunding) revert WrongStage();
        if (_fullyFunded(s)) revert Funded();
        if (block.timestamp < s.terms.fundingDeadline) revert TooEarly();
        _refund(id, s);
        emit RefundedFundingTimeout(id);
    }

    function deliveryTimeoutExit(bytes32 id) external {
        OrderState storage s = _orders[id];
        if (s.stage != Stage.AwaitingFunding) revert WrongStage();
        if (!_fullyFunded(s)) revert NotFullyFunded();
        if (block.timestamp < s.terms.deliveryDeadline) revert TooEarly();
        _refund(id, s);
        emit RefundedDeliveryTimeout(id);
    }

    function _refund(bytes32 id, OrderState storage s) private {
        s.stage = Stage.Refunded;
        address asset = address(paymentAsset);
        if (s.buyerFunded) balances[s.terms.buyer][asset] += s.terms.price;
        if (s.sellerFunded) {
            balances[s.terms.seller][asset] += s.terms.price;
            s.nftReturnPending = true; // NFT stays in custody until separately recovered
        } else {
            delete liveOrderOfNft[_nftKey(s.terms.nft, s.terms.tokenId)];
        }
        id; // silence unused warning
    }

    // ------------------------------------------------------------ NFT recovery

    /// @notice Original seller recovers the custodied NFT to a receiver of their choice.
    function recoverNFT(bytes32 id, address receiver) external nonReentrant {
        OrderState storage s = _orders[id];
        if (msg.sender != s.terms.seller) revert NotAuthorized();
        _recover(id, s, receiver);
    }

    /// @notice Anyone holding the seller's specific EIP-712 authorization may execute the recovery.
    function recoverNFTWithAuth(
        bytes32 id,
        address receiver,
        uint256 nonce,
        uint256 expiry,
        bytes calldata sellerSig
    ) external nonReentrant {
        OrderState storage s = _orders[id];
        if (block.timestamp > expiry) revert AuthExpired();
        address seller = s.terms.seller;
        if (usedRecoveryNonce[seller][nonce]) revert NonceUsed();
        if (!SignatureChecker.isValidSignatureNow(seller, hashRecovery(id, receiver, nonce, expiry), sellerSig)) {
            revert BadSignature();
        }
        usedRecoveryNonce[seller][nonce] = true;
        _recover(id, s, receiver);
    }

    function _recover(bytes32 id, OrderState storage s, address receiver) private {
        if (!s.nftReturnPending) revert NothingPending();
        if (receiver == address(0) || receiver == address(this)) revert BadReceiver();
        s.nftReturnPending = false;
        delete liveOrderOfNft[_nftKey(s.terms.nft, s.terms.tokenId)];
        // Reverts (and so restores the pending entitlement) if the receiver rejects.
        nftContract.safeTransferFrom(address(this), receiver, s.terms.tokenId);
        emit NFTRecovered(id, receiver);
    }

    // --------------------------------------------------------------- withdraw

    function withdraw(address asset) external nonReentrant {
        uint256 amount = balances[msg.sender][asset];
        if (amount == 0) revert NoBalance();
        balances[msg.sender][asset] = 0;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, asset, amount);
    }

    // ------------------------------------------------------------------- views

    function getOrder(bytes32 id) external view returns (OrderState memory) {
        return _orders[id];
    }

    function isFullyFunded(bytes32 id) external view returns (bool) {
        return _fullyFunded(_orders[id]);
    }

    function nftKey(address nft, uint256 tokenId) external pure returns (bytes32) {
        return _nftKey(nft, tokenId);
    }

    // ----------------------------------------------------------------- helpers

    function _fullyFunded(OrderState storage s) private view returns (bool) {
        return s.buyerFunded && s.sellerFunded;
    }

    function _requireFundable(OrderState storage s) private view {
        if (s.stage != Stage.AwaitingFunding) revert WrongStage();
        if (!(block.timestamp < s.terms.fundingDeadline)) revert TooLate();
    }

    function _pull(address from, uint256 amount) private {
        uint256 before = paymentAsset.balanceOf(address(this));
        paymentAsset.safeTransferFrom(from, address(this), amount);
        if (paymentAsset.balanceOf(address(this)) - before != amount) revert InexactDeposit();
    }

    function _nftKey(address nft, uint256 tokenId) private pure returns (bytes32) {
        return keccak256(abi.encode(nft, tokenId));
    }
}
