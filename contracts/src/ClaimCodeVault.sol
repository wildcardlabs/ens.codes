// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @notice ENS v2 renewer interface, shared by `ETHRegistrar` and `ETHRenewerV1`.
interface IETHRenewer {
    struct RenewData {
        string label;
        uint64 duration;
        bytes32 referrer;
    }

    function renewBatch(RenewData[] calldata rds, address paymentToken) external;
}

/// @title ClaimCodeVault
/// @notice Single-use USDC claim codes that can only pay for ENS renewals.
///
/// A code is identified by the address of a one-time key derived from it. A purchase of 1 to
/// `MAX_BATCH` codes of the same amount is one record: the codes are committed as a Merkle root, and
/// the record holds the amount, the count and one used bit per code. Whoever holds a code spends it
/// once, on up to `MAX_NAMES` names in one transaction, by signing a `Redeem` message with its key
/// and showing that the key is in the purchase. Signatures, never the code, go onchain.
///
/// Storing one record per purchase instead of one per code matters because creating state is the
/// expensive part of a purchase (EIP-8037): a purchase fills one storage slot whatever its size.
///
/// A code has two states. Unused: the money is still the buyer's, who may cancel it at any time.
/// Used: it holds nothing. There is no expiry and no partial balance: whatever a redemption does not
/// spend goes back to the buyer in the same transaction.
contract ClaimCodeVault is EIP712, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @dev One storage slot per purchase. `count` is never zero for a purchase that exists, and it
    /// stays set after every code is used, so the same purchase can never be recreated.
    struct Batch {
        /// Value of each code.
        uint48 amount;
        uint8 count;
        /// Bit `i` is set once code `i` has been redeemed or cancelled.
        uint200 used;
    }

    /// @dev One slot, read and written once per purchase.
    struct Config {
        uint96 maxCodeAmount;
        uint128 fees;
        bool paused;
    }

    struct Renewal {
        address renewer;
        string label;
        uint64 duration;
    }

    struct Redeem {
        /// The purchase the code is in: its buyer and the root of its codes.
        address buyer;
        bytes32 root;
        /// The code's position in the purchase.
        uint256 index;
        /// Renewals on the same renewer must be next to each other; each run is one `renewBatch`.
        Renewal[] renewals;
        /// The most the whole redemption may spend. At most the code's amount.
        uint256 maxAmount;
        address relayer; // address(0): anyone may submit
        uint256 deadline;
    }

    struct Cancel {
        bytes32 root;
        /// Bit `i` set: cancel code `i`. Bits for codes already used, or past the count, are ignored.
        uint256 mask;
    }

    bytes32 public constant RENEWAL_TYPEHASH = keccak256("Renewal(address renewer,string label,uint64 duration)");
    bytes32 public constant REDEEM_TYPEHASH = keccak256(
        "Redeem(address buyer,bytes32 root,uint256 index,Renewal[] renewals,uint256 maxAmount,address relayer,uint256 deadline)Renewal(address renewer,string label,uint64 duration)"
    );

    /// @notice Wait between proposing a renewer and it becoming usable.
    uint256 public constant RENEWER_DELAY = 2 days;
    /// @notice Most codes in one purchase. A purchase's used bits share its storage slot.
    uint256 public constant MAX_BATCH = 200;
    /// @notice Most names one code can renew.
    uint256 public constant MAX_NAMES = 10;
    /// @notice Smallest code: 1 USDC.
    uint96 public constant MIN_CODE_AMOUNT = 1e6;
    /// @notice Protocol fee per code: 0.05 USDC, paid at purchase on top of the code's value.
    uint256 public constant PROTOCOL_FEE = 0.05e6;

    IERC20 public immutable usdc;
    bytes32 public immutable referrer;
    /// @notice Where collected protocol fees go when swept. Fixed at deploy.
    address public immutable feeRecipient;

    Config internal _config;

    /// @notice Purchases, by `batchId(buyer, root)`.
    mapping(bytes32 id => Batch) public batches;
    mapping(address renewer => bool) public isRenewer;
    mapping(address renewer => uint256 activatesAt) public pendingRenewers;

    event Created(bytes32 indexed id, address indexed buyer, uint256 amount, uint256 count, bytes32 root);
    /// @notice One per code in a purchase, so a code can be found by its address alone.
    event Issued(address indexed code, bytes32 id, uint256 index);
    /// @param spent USDC paid to ENS. @param refunded The rest of the code, returned to the buyer.
    event Redeemed(
        bytes32 indexed id, address indexed code, uint256 index, Renewal[] renewals, uint256 spent, uint256 refunded
    );
    /// @param mask The codes cancelled by this call, one bit each.
    event Cancelled(bytes32 indexed id, address indexed buyer, uint256 mask, uint256 refunded);
    event FeesSwept(address indexed to, uint256 amount);
    event RenewerProposed(address indexed renewer, uint256 activatesAt);
    event RenewerAdded(address indexed renewer);
    event MaxCodeAmountSet(uint96 amount);
    event Paused();
    event Unpaused();

    error BatchExists();
    error UnknownCode();
    error CodeUsed();
    error BadAmount();
    error BadCode();
    error BadCodeSignature();
    error SignatureExpired();
    error NotRenewer();
    error WrongRelayer();
    error BadRenewals();
    error InsufficientBalance();
    error Overspent();
    error NothingToCancel();
    error RenewerNotReady();
    error BadBatch();
    error BadFee();
    error IsPaused();
    error NothingToSweep();

    constructor(
        IERC20 usdc_,
        address[] memory renewers,
        bytes32 referrer_,
        uint96 maxCodeAmount_,
        address owner_,
        address feeRecipient_
    ) EIP712("ENS Claim Code", "1") Ownable(owner_) {
        if (feeRecipient_ == address(0)) revert BadFee();
        usdc = usdc_;
        referrer = referrer_;
        feeRecipient = feeRecipient_;
        _config.maxCodeAmount = maxCodeAmount_;
        emit MaxCodeAmountSet(maxCodeAmount_);
        for (uint256 i; i < renewers.length; ++i) {
            isRenewer[renewers[i]] = true;
            emit RenewerAdded(renewers[i]);
        }
    }

    // ---------------------------------------------------------------- buy

    /// @notice Fund 1 to `MAX_BATCH` new codes of the same amount with one USDC transfer. Needs an
    /// allowance of `(amount + PROTOCOL_FEE) * codes.length`.
    /// @param codes The address of each code's key, in the order the codes are numbered.
    /// @return id The purchase, `batchId(msg.sender, rootOf(codes))`.
    function create(address[] calldata codes, uint96 amount) external nonReentrant returns (bytes32 id) {
        return _create(codes, amount);
    }

    /// @notice Same as `create`, with an EIP-2612 permit for the USDC instead of a prior approval.
    /// A permit that was already submitted by someone else is ignored; the transfer still needs
    /// the allowance it granted.
    function createWithPermit(
        address[] calldata codes,
        uint96 amount,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (bytes32 id) {
        uint256 total = (uint256(amount) + PROTOCOL_FEE) * codes.length;
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), total, permitDeadline, v, r, s) {} catch {}
        return _create(codes, amount);
    }

    function _create(address[] calldata codes, uint96 amount) internal returns (bytes32 id) {
        uint256 n = codes.length;
        if (n == 0 || n > MAX_BATCH) revert BadBatch();
        Config memory cfg = _config;
        if (cfg.paused) revert IsPaused();
        if (amount < MIN_CODE_AMOUNT || amount > cfg.maxCodeAmount || amount > type(uint48).max) revert BadAmount();

        // The purchase is keyed by its buyer, so nobody else can register these codes first.
        bytes32 root = rootOf(codes);
        id = batchId(msg.sender, root);
        Batch storage b = batches[id];
        if (b.count != 0) revert BatchExists();
        b.amount = uint48(amount);
        b.count = uint8(n);
        emit Created(id, msg.sender, amount, n, root);
        for (uint256 i; i < n; ++i) {
            emit Issued(codes[i], id, i);
        }

        // Book the fees and pull value plus fees in one transfer.
        uint256 fees = PROTOCOL_FEE * n;
        _config.fees = cfg.fees + uint128(fees);
        usdc.safeTransferFrom(msg.sender, address(this), uint256(amount) * n + fees);
    }

    /// @notice The key of a purchase.
    function batchId(address buyer, bytes32 root) public pure returns (bytes32) {
        return keccak256(abi.encode(buyer, root));
    }

    /// @notice A code's leaf: its position and its key's address. 52 bytes, so it can never be
    /// mistaken for an inner node, which hashes 64.
    function leafOf(uint256 index, address code) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(index, code));
    }

    /// @notice The Merkle root of a purchase's codes. Leaves are paired left to right, a node
    /// without a partner moves up unchanged, and a pair is hashed in sorted order.
    function rootOf(address[] calldata codes) public pure returns (bytes32) {
        uint256 n = codes.length;
        if (n == 0) revert BadBatch();
        bytes32[] memory layer = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            if (codes[i] == address(0)) revert BadCode();
            layer[i] = leafOf(i, codes[i]);
        }
        while (n > 1) {
            uint256 half = n / 2;
            for (uint256 i; i < half; ++i) {
                layer[i] = Hashes.commutativeKeccak256(layer[2 * i], layer[2 * i + 1]);
            }
            if (n % 2 == 1) {
                layer[half] = layer[n - 1];
                n = half + 1;
            } else {
                n = half;
            }
        }
        return layer[0];
    }

    /// @notice Whether code `index` of a purchase has been redeemed or cancelled.
    function isUsed(bytes32 id, uint256 index) external view returns (bool) {
        return index < 200 && batches[id].used & (1 << index) != 0;
    }

    // ------------------------------------------------------------- redeem

    /// @notice Spend a code, once, on up to `MAX_NAMES` ENS renewals, authorized by the code key's
    /// signature. Either every renewal succeeds or the code stays unused. Whatever is not spent
    /// goes back to the buyer.
    /// @param proof The Merkle proof that the signing key is code `r.index` of the purchase. Empty
    ///        for a purchase of one code.
    function redeem(Redeem calldata r, bytes calldata sig, bytes32[] calldata proof) external nonReentrant {
        (bytes32 id, address code, uint256 amount) = _use(r, sig, proof);
        uint256 spent = _renew(r);
        // Every unit leaving a code goes to a renewer or back to the buyer, never to the caller.
        uint256 refund = amount - spent;
        if (refund > 0) usdc.safeTransfer(r.buyer, refund);
        emit Redeemed(id, code, r.index, r.renewals, spent, refund);
    }

    /// @dev Checks the redemption and marks the code used. Returns the purchase, the code's key
    /// address and the code's value.
    function _use(Redeem calldata r, bytes calldata sig, bytes32[] calldata proof)
        internal
        returns (bytes32 id, address code, uint256 amount)
    {
        id = batchId(r.buyer, r.root);
        Batch storage b = batches[id];
        if (r.index >= b.count) revert UnknownCode();
        uint256 used = b.used;
        uint256 bit = 1 << r.index;
        if (used & bit != 0) revert CodeUsed();
        if (block.timestamp > r.deadline) revert SignatureExpired();
        if (r.relayer != address(0) && r.relayer != msg.sender) revert WrongRelayer();
        if (r.renewals.length == 0 || r.renewals.length > MAX_NAMES) revert BadRenewals();
        amount = b.amount;
        if (r.maxAmount > amount) revert InsufficientBalance();
        // The signer must be the key committed at this position.
        code = ECDSA.recover(hashRedeem(r), sig);
        if (!MerkleProof.verifyCalldata(proof, r.root, leafOf(r.index, code))) revert BadCodeSignature();
        b.used = uint200(used | bit);
    }

    /// @dev Pays for the renewals, one `renewBatch` per run of the same renewer. Returns what ENS
    /// actually charged, which can never exceed `r.maxAmount`.
    function _renew(Redeem calldata r) internal returns (uint256 spent) {
        uint256 n = r.renewals.length;
        uint256 balance = usdc.balanceOf(address(this));
        uint256 budget = r.maxAmount;
        for (uint256 i; i < n;) {
            address renewer = r.renewals[i].renewer;
            if (!isRenewer[renewer]) revert NotRenewer();
            uint256 end = i + 1;
            while (end < n && r.renewals[end].renewer == renewer) ++end;

            IETHRenewer.RenewData[] memory rds = new IETHRenewer.RenewData[](end - i);
            for (uint256 k = i; k < end; ++k) {
                rds[k - i] = IETHRenewer.RenewData(r.renewals[k].label, r.renewals[k].duration, referrer);
            }

            // The renewer can take no more than what is left of the signed maximum.
            usdc.forceApprove(renewer, budget);
            IETHRenewer(renewer).renewBatch(rds, address(usdc));
            uint256 left = usdc.balanceOf(address(this));
            uint256 spentHere = balance - left;
            if (spentHere > budget) revert Overspent();
            // An exact spend used the whole allowance; otherwise clear what is left of it.
            if (spentHere < budget) usdc.forceApprove(renewer, 0);
            budget -= spentHere;
            balance = left;
            i = end;
        }
        spent = r.maxAmount - budget;
    }

    /// @notice EIP-712 digest the code key signs for `r`.
    function hashRedeem(Redeem calldata r) public view returns (bytes32) {
        uint256 n = r.renewals.length;
        bytes32[] memory hashes = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            Renewal calldata x = r.renewals[i];
            hashes[i] = keccak256(abi.encode(RENEWAL_TYPEHASH, x.renewer, keccak256(bytes(x.label)), x.duration));
        }
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REDEEM_TYPEHASH,
                    r.buyer,
                    r.root,
                    r.index,
                    keccak256(abi.encodePacked(hashes)),
                    r.maxAmount,
                    r.relayer,
                    r.deadline
                )
            )
        );
    }

    // ------------------------------------------------------------- cancel

    /// @notice The buyer takes back unused codes, at any time, from one or more of their purchases,
    /// refunded in one transfer. The codes stop working. Codes used in the meantime (for example a
    /// recipient redeemed one while this was pending) are skipped rather than failing the call.
    /// @return cancelled How many codes were cancelled.
    function cancel(Cancel[] calldata items) external nonReentrant returns (uint256 cancelled) {
        if (items.length == 0 || items.length > MAX_BATCH) revert BadBatch();
        uint256 total;
        for (uint256 i; i < items.length; ++i) {
            // Keyed by the caller: someone else's purchase is simply not found.
            bytes32 id = batchId(msg.sender, items[i].root);
            Batch storage b = batches[id];
            uint256 count = b.count;
            if (count == 0) revert UnknownCode();
            uint256 used = b.used;
            uint256 fresh = items[i].mask & ((1 << count) - 1) & ~used;
            if (fresh == 0) continue;
            b.used = uint200(used | fresh);
            uint256 n = _popcount(fresh);
            uint256 refund = n * b.amount;
            cancelled += n;
            total += refund;
            emit Cancelled(id, msg.sender, fresh, refund);
        }
        if (total == 0) revert NothingToCancel();
        usdc.safeTransfer(msg.sender, total);
    }

    function _popcount(uint256 x) internal pure returns (uint256 n) {
        while (x != 0) {
            x &= x - 1;
            ++n;
        }
    }

    // --------------------------------------------------------------- fees

    /// @notice Protocol fees collected and not yet swept.
    function feesAccrued() external view returns (uint256) {
        return _config.fees;
    }

    /// @notice Send the collected protocol fees to `feeRecipient`. Anyone may call it.
    function sweepFees() external nonReentrant {
        uint256 amount = _config.fees;
        if (amount == 0) revert NothingToSweep();
        _config.fees = 0;
        usdc.safeTransfer(feeRecipient, amount);
        emit FeesSwept(feeRecipient, amount);
    }

    // -------------------------------------------------------------- admin

    /// @notice Largest amount a single code may be created with. Owner-set beta cap.
    function maxCodeAmount() external view returns (uint96) {
        return _config.maxCodeAmount;
    }

    function paused() external view returns (bool) {
        return _config.paused;
    }

    /// @notice Start the timelock for a new renewer. Renewers can be added, never removed.
    function proposeRenewer(address renewer) external onlyOwner {
        uint256 activatesAt = block.timestamp + RENEWER_DELAY;
        pendingRenewers[renewer] = activatesAt;
        emit RenewerProposed(renewer, activatesAt);
    }

    /// @notice Anyone may activate a proposed renewer once its delay has passed.
    function activateRenewer(address renewer) external {
        uint256 activatesAt = pendingRenewers[renewer];
        if (activatesAt == 0 || block.timestamp < activatesAt) revert RenewerNotReady();
        delete pendingRenewers[renewer];
        isRenewer[renewer] = true;
        emit RenewerAdded(renewer);
    }

    function setMaxCodeAmount(uint96 amount) external onlyOwner {
        _config.maxCodeAmount = amount;
        emit MaxCodeAmountSet(amount);
    }

    /// @notice Pausing stops new codes only. Redeem and cancel always work.
    function pause() external onlyOwner {
        _config.paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        _config.paused = false;
        emit Unpaused();
    }
}
