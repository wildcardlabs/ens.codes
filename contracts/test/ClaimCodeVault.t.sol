// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ClaimCodeVault} from "../src/ClaimCodeVault.sol";
import {CheapRenewer, MockRenewer, MockUSDC, ReentrantRenewer} from "./mocks/Mocks.sol";
import {Merkle} from "./utils/Merkle.sol";

abstract contract VaultBase is Test {
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 constant REFERRER = bytes32("namepass");
    uint256 constant FEE = 0.05e6;
    /// Code keys are CODE_PK, CODE_PK + 1, ...
    uint256 constant CODE_PK = 0xC0DE;

    MockUSDC usdc;
    MockRenewer renewer; // 1 unit per second, ~$31.54/year
    MockRenewer renewer2;
    ClaimCodeVault vault;

    address owner = makeAddr("owner");
    uint256 buyerPk = 0xB0B;
    address buyer = vm.addr(buyerPk);
    address recipient = makeAddr("recipient");
    address fees = makeAddr("fees");

    function setUp() public virtual {
        usdc = new MockUSDC();
        renewer = new MockRenewer(IERC20(address(usdc)), 1);
        renewer2 = new MockRenewer(IERC20(address(usdc)), 1);
        address[] memory renewers = new address[](2);
        renewers[0] = address(renewer);
        renewers[1] = address(renewer2);
        vault = new ClaimCodeVault(IERC20(address(usdc)), renewers, REFERRER, 500e6, owner, fees);
        usdc.mint(buyer, 100_000e6);
        vm.prank(buyer);
        usdc.approve(address(vault), type(uint256).max);
    }

    /// `n` code addresses from keys `firstPk`, `firstPk + 1`, ...
    function codesFrom(uint256 firstPk, uint256 n) internal pure returns (address[] memory codes) {
        codes = new address[](n);
        for (uint256 i; i < n; ++i) {
            codes[i] = vm.addr(firstPk + i);
        }
    }

    /// The buyer buys `n` codes of `amount`. Returns their addresses, root and purchase id.
    function buy(uint256 n, uint96 amount) internal returns (address[] memory codes, bytes32 root, bytes32 id) {
        return buyFrom(CODE_PK, n, amount);
    }

    function buyFrom(uint256 firstPk, uint256 n, uint96 amount)
        internal
        returns (address[] memory codes, bytes32 root, bytes32 id)
    {
        codes = codesFrom(firstPk, n);
        root = Merkle.root(codes);
        vm.prank(buyer);
        id = vault.create(codes, amount);
    }

    function one(string memory label, uint64 duration) internal view returns (ClaimCodeVault.Renewal[] memory list) {
        list = new ClaimCodeVault.Renewal[](1);
        list[0] = ClaimCodeVault.Renewal(address(renewer), label, duration);
    }

    /// A redemption of code `index` whose maximum is exactly what the mock renewers charge.
    function redeemMsg(bytes32 root, uint256 index, ClaimCodeVault.Renewal[] memory list)
        internal
        view
        returns (ClaimCodeVault.Redeem memory r)
    {
        uint256 total;
        for (uint256 i; i < list.length; ++i) {
            total += list[i].duration;
        }
        r = ClaimCodeVault.Redeem({
            buyer: buyer,
            root: root,
            index: index,
            renewals: list,
            maxAmount: total,
            relayer: address(0),
            deadline: block.timestamp + 1 hours
        });
    }

    function signRedeem(uint256 pk, ClaimCodeVault.Redeem memory r) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, this.digestOf(r));
        return abi.encodePacked(rr, s, v);
    }

    /// External so memory structs can be passed to the vault's calldata view.
    function digestOf(ClaimCodeVault.Redeem calldata r) external view returns (bytes32) {
        return vault.hashRedeem(r);
    }

    function used(bytes32 id) internal view returns (uint256 u) {
        (,, u) = vault.batches(id);
    }

    function cancelOne(bytes32 root, uint256 mask) internal returns (uint256) {
        ClaimCodeVault.Cancel[] memory items = new ClaimCodeVault.Cancel[](1);
        items[0] = ClaimCodeVault.Cancel(root, mask);
        return vault.cancel(items);
    }

    function signPermit(uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, buyer, address(vault), value, usdc.nonces(buyer), deadline));
        return vm.sign(buyerPk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
    }

    function addRenewer(address r) internal {
        vm.prank(owner);
        vault.proposeRenewer(r);
        vm.warp(block.timestamp + vault.RENEWER_DELAY());
        vault.activateRenewer(r);
    }
}

contract CreateTest is VaultBase {
    function test_create_one() public {
        address[] memory codes = codesFrom(CODE_PK, 1);
        bytes32 root = Merkle.root(codes);
        bytes32 id = vault.batchId(buyer, root);
        uint256 before = usdc.balanceOf(buyer);

        vm.expectEmit(address(vault));
        emit ClaimCodeVault.Created(id, buyer, 50e6, 1, root);
        vm.expectEmit(address(vault));
        emit ClaimCodeVault.Issued(codes[0], id, 0);
        vm.prank(buyer);
        assertEq(vault.create(codes, 50e6), id);

        (uint48 amount, uint8 count, uint200 u) = vault.batches(id);
        assertEq(amount, 50e6);
        assertEq(count, 1);
        assertEq(u, 0);
        // A single code's root is its own leaf.
        assertEq(root, vault.leafOf(0, codes[0]));
        assertEq(before - usdc.balanceOf(buyer), 50e6 + FEE);
        assertEq(usdc.balanceOf(address(vault)), 50e6 + FEE);
        assertEq(vault.feesAccrued(), FEE);
    }

    function test_create_many() public {
        uint256 before = usdc.balanceOf(buyer);
        (address[] memory codes, bytes32 root, bytes32 id) = buy(10, 25e6);
        (uint48 amount, uint8 count, uint200 u) = vault.batches(id);
        assertEq(amount, 25e6);
        assertEq(count, 10);
        assertEq(u, 0);
        assertEq(vault.rootOf(codes), root);
        assertEq(before - usdc.balanceOf(buyer), (25e6 + FEE) * 10);
        assertEq(vault.feesAccrued(), FEE * 10);
        assertFalse(vault.isUsed(id, 9));
    }

    /// The onchain root matches the offchain construction for every size, and every code's proof
    /// verifies against it.
    function test_root_matchesForEverySize() public view {
        for (uint256 n = 1; n <= 33; ++n) {
            address[] memory codes = codesFrom(CODE_PK, n);
            assertEq(vault.rootOf(codes), Merkle.root(codes));
        }
        address[] memory full = codesFrom(CODE_PK, 200);
        assertEq(vault.rootOf(full), Merkle.root(full));
    }

    function test_create_minimumAmount() public {
        (,, bytes32 id) = buy(1, 1e6);
        (uint48 amount,,) = vault.batches(id);
        assertEq(amount, 1e6);
    }

    function test_create_badAmount() public {
        address[] memory codes = codesFrom(CODE_PK, 1);
        vm.startPrank(buyer);
        vm.expectRevert(ClaimCodeVault.BadAmount.selector);
        vault.create(codes, 1e6 - 1);
        vm.expectRevert(ClaimCodeVault.BadAmount.selector);
        vault.create(codes, 500e6 + 1);
        vm.stopPrank();
    }

    /// The amount is stored in 48 bits; a cap raised past that still can't overflow it.
    function test_create_amountPastStorageReverts() public {
        vm.prank(owner);
        vault.setMaxCodeAmount(type(uint96).max);
        address[] memory codes = codesFrom(CODE_PK, 1);
        vm.prank(buyer);
        vm.expectRevert(ClaimCodeVault.BadAmount.selector);
        vault.create(codes, uint96(type(uint48).max) + 1);
    }

    function test_create_feeNeedsAllowance() public {
        vm.prank(buyer);
        usdc.approve(address(vault), 50e6); // the value, but not the fee
        address[] memory codes = codesFrom(CODE_PK, 1);
        vm.prank(buyer);
        vm.expectRevert();
        vault.create(codes, 50e6);
    }

    function test_create_withPermit() public {
        vm.prank(buyer);
        usdc.approve(address(vault), 0);
        uint256 deadline = block.timestamp + 1 hours;
        address[] memory codes = codesFrom(CODE_PK, 3);
        (uint8 v, bytes32 r, bytes32 s) = signPermit((50e6 + FEE) * 3, deadline);
        vm.prank(buyer);
        bytes32 id = vault.createWithPermit(codes, 50e6, deadline, v, r, s);
        (, uint8 count,) = vault.batches(id);
        assertEq(count, 3);
        assertEq(usdc.balanceOf(address(vault)), (50e6 + FEE) * 3);
    }

    /// Someone submits the buyer's permit first; createWithPermit must still succeed.
    function test_create_permitFrontrun() public {
        vm.prank(buyer);
        usdc.approve(address(vault), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(50e6 + FEE, deadline);
        vm.prank(makeAddr("griefer"));
        usdc.permit(buyer, address(vault), 50e6 + FEE, deadline, v, r, s);

        address[] memory codes = codesFrom(CODE_PK, 1);
        vm.prank(buyer);
        vault.createWithPermit(codes, 50e6, deadline, v, r, s);
        assertEq(usdc.balanceOf(address(vault)), 50e6 + FEE);
    }

    function test_create_existsReverts() public {
        (address[] memory codes,,) = buy(2, 50e6);
        vm.prank(buyer);
        vm.expectRevert(ClaimCodeVault.BatchExists.selector);
        vault.create(codes, 10e6);
    }

    /// A purchase is keyed by its buyer: someone who registers the same codes first does not block
    /// the buyer, and gets their own separate purchase.
    function test_create_sameCodesOtherBuyerDoesNotBlock() public {
        address[] memory codes = codesFrom(CODE_PK, 2);
        address squatter = makeAddr("squatter");
        usdc.mint(squatter, 10e6);
        vm.startPrank(squatter);
        usdc.approve(address(vault), type(uint256).max);
        bytes32 theirs = vault.create(codes, 1e6);
        vm.stopPrank();

        vm.prank(buyer);
        bytes32 mine = vault.create(codes, 50e6);
        assertTrue(mine != theirs);
        (uint48 amount,,) = vault.batches(mine);
        assertEq(amount, 50e6);
    }

    /// A fully cancelled purchase can't be created again.
    function test_create_afterCancelReverts() public {
        (address[] memory codes, bytes32 root,) = buy(2, 50e6);
        vm.prank(buyer);
        cancelOne(root, type(uint256).max);
        vm.prank(buyer);
        vm.expectRevert(ClaimCodeVault.BatchExists.selector);
        vault.create(codes, 50e6);
    }

    function test_create_zeroCodeReverts() public {
        address[] memory codes = codesFrom(CODE_PK, 3);
        codes[1] = address(0);
        vm.prank(buyer);
        vm.expectRevert(ClaimCodeVault.BadCode.selector);
        vault.create(codes, 50e6);
    }

    function test_create_badSizes() public {
        vm.startPrank(buyer);
        vm.expectRevert(ClaimCodeVault.BadBatch.selector);
        vault.create(new address[](0), 50e6);
        address[] memory tooMany = codesFrom(CODE_PK, 201);
        vm.expectRevert(ClaimCodeVault.BadBatch.selector);
        vault.create(tooMany, 50e6);
        vm.stopPrank();
    }

    function test_pause_blocksCreateOnly() public {
        (, bytes32 root,) = buy(2, 50e6);
        vm.prank(owner);
        vault.pause();

        address[] memory more = codesFrom(CODE_PK + 50, 1);
        vm.prank(buyer);
        vm.expectRevert(ClaimCodeVault.IsPaused.selector);
        vault.create(more, 50e6);

        // Redeem and cancel still work.
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, one("namepass", 100 days));
        vault.redeem(r, signRedeem(CODE_PK, r), Merkle.proof(codesFrom(CODE_PK, 2), 0));
        vm.prank(buyer);
        assertEq(cancelOne(root, 2), 1);

        vm.prank(owner);
        vault.unpause();
        vm.prank(buyer);
        vault.create(more, 50e6);
    }

    function test_constructor_zeroFeeRecipientReverts() public {
        address[] memory renewers = new address[](0);
        vm.expectRevert(ClaimCodeVault.BadFee.selector);
        new ClaimCodeVault(IERC20(address(usdc)), renewers, REFERRER, 500e6, owner, address(0));
    }

    /// Gas for the largest purchase, for the record.
    function test_create_maxSizeGas() public {
        address[] memory codes = codesFrom(CODE_PK, 200);
        vm.prank(buyer);
        uint256 g = gasleft();
        vault.create(codes, 1e6);
        emit log_named_uint("gas for 200 codes", g - gasleft());
    }
}

contract RedeemTest is VaultBase {
    address[] codes;
    bytes32 root;
    bytes32 id;

    function setUp() public override {
        super.setUp();
        (codes, root, id) = buy(7, 50e6);
    }

    function proofOf(uint256 index) internal view returns (bytes32[] memory) {
        return Merkle.proof(codes, index);
    }

    function test_redeem_singleCodePurchase() public {
        (address[] memory solo, bytes32 soloRoot, bytes32 soloId) = buyFrom(CODE_PK + 100, 1, 50e6);
        ClaimCodeVault.Redeem memory r = redeemMsg(soloRoot, 0, one("namepass", 365 days));
        uint256 before = usdc.balanceOf(buyer);

        vm.expectEmit(address(vault));
        emit ClaimCodeVault.Redeemed(soloId, solo[0], 0, r.renewals, 365 days, 50e6 - 365 days);
        vm.prank(recipient);
        vault.redeem(r, signRedeem(CODE_PK + 100, r), new bytes32[](0));

        assertEq(renewer.renewed("namepass"), 365 days);
        assertEq(renewer.lastReferrer(), REFERRER);
        assertEq(usdc.balanceOf(address(renewer)), 365 days);
        assertEq(usdc.balanceOf(buyer) - before, 50e6 - 365 days);
        assertEq(usdc.balanceOf(recipient), 0);
        assertTrue(vault.isUsed(soloId, 0));
    }

    /// Every code of a purchase redeems with its own proof, and only its own bit changes.
    function test_redeem_everyCodeOfAPurchase() public {
        for (uint256 i; i < codes.length; ++i) {
            ClaimCodeVault.Redeem memory r = redeemMsg(root, i, one("namepass", 10 days));
            vault.redeem(r, signRedeem(CODE_PK + i, r), proofOf(i));
            assertEq(used(id), (1 << (i + 1)) - 1);
        }
        // All spent: only the fees are left.
        assertEq(usdc.balanceOf(address(vault)), FEE * codes.length);
    }

    function test_redeem_severalNames() public {
        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](3);
        list[0] = ClaimCodeVault.Renewal(address(renewer), "one", 100 days);
        list[1] = ClaimCodeVault.Renewal(address(renewer), "two", 50 days);
        list[2] = ClaimCodeVault.Renewal(address(renewer), "three", 25 days);
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 3, list);
        uint256 before = usdc.balanceOf(buyer);
        vault.redeem(r, signRedeem(CODE_PK + 3, r), proofOf(3));
        assertEq(renewer.renewed("one"), 100 days);
        assertEq(renewer.renewed("two"), 50 days);
        assertEq(renewer.renewed("three"), 25 days);
        assertEq(usdc.balanceOf(buyer) - before, 50e6 - 175 days);
    }

    function test_redeem_twoRenewers() public {
        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](3);
        list[0] = ClaimCodeVault.Renewal(address(renewer), "one", 100 days);
        list[1] = ClaimCodeVault.Renewal(address(renewer2), "two", 50 days);
        list[2] = ClaimCodeVault.Renewal(address(renewer2), "three", 25 days);
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, list);
        vault.redeem(r, signRedeem(CODE_PK, r), proofOf(0));
        assertEq(usdc.balanceOf(address(renewer)), 100 days);
        assertEq(usdc.balanceOf(address(renewer2)), 75 days);
        assertEq(usdc.allowance(address(vault), address(renewer)), 0);
        assertEq(usdc.allowance(address(vault), address(renewer2)), 0);
    }

    function test_redeem_replayReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK + 2, r);
        vault.redeem(r, sig, proofOf(2));
        vm.expectRevert(ClaimCodeVault.CodeUsed.selector);
        vault.redeem(r, sig, proofOf(2));
    }

    function test_redeem_wrongKeyReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        bytes memory sig = signRedeem(0xBAD, r);
        vm.expectRevert(ClaimCodeVault.BadCodeSignature.selector);
        vault.redeem(r, sig, proofOf(2));
    }

    /// A real code of the purchase can't claim another position.
    function test_redeem_wrongIndexReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 3, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK + 2, r); // code 2 signing as position 3
        vm.expectRevert(ClaimCodeVault.BadCodeSignature.selector);
        vault.redeem(r, sig, proofOf(3));
        vm.expectRevert(ClaimCodeVault.BadCodeSignature.selector);
        vault.redeem(r, sig, proofOf(2));
    }

    function test_redeem_wrongProofReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK + 2, r);
        vm.expectRevert(ClaimCodeVault.BadCodeSignature.selector);
        vault.redeem(r, sig, proofOf(5));
        vm.expectRevert(ClaimCodeVault.BadCodeSignature.selector);
        vault.redeem(r, sig, new bytes32[](0));
    }

    function test_redeem_tamperedReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK + 2, r);
        r.renewals[0].label = "attacker";
        vm.expectRevert(ClaimCodeVault.BadCodeSignature.selector);
        vault.redeem(r, sig, proofOf(2));
    }

    function test_redeem_deadline() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK + 2, r);
        vm.warp(r.deadline + 1);
        vm.expectRevert(ClaimCodeVault.SignatureExpired.selector);
        vault.redeem(r, sig, proofOf(2));
    }

    function test_redeem_unknownPurchase() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(bytes32(uint256(1)), 0, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK, r);
        vm.expectRevert(ClaimCodeVault.UnknownCode.selector);
        vault.redeem(r, sig, new bytes32[](0));
    }

    function test_redeem_indexPastCountReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 7, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK, r);
        vm.expectRevert(ClaimCodeVault.UnknownCode.selector);
        vault.redeem(r, sig, proofOf(0));
        r.index = type(uint256).max;
        vm.expectRevert(ClaimCodeVault.UnknownCode.selector);
        vault.redeem(r, sig, proofOf(0));
    }

    /// The refund address is part of the purchase's key: naming another buyer finds nothing.
    function test_redeem_otherBuyerReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        r.buyer = makeAddr("thief");
        bytes memory sig = signRedeem(CODE_PK + 2, r);
        vm.expectRevert(ClaimCodeVault.UnknownCode.selector);
        vault.redeem(r, sig, proofOf(2));
    }

    /// The same key in two purchases: a signature for one can't spend the other.
    function test_redeem_signatureIsPerPurchase() public {
        address other = makeAddr("other");
        usdc.mint(other, 1000e6);
        vm.startPrank(other);
        usdc.approve(address(vault), type(uint256).max);
        vault.create(codes, 50e6); // same codes, same root, different buyer
        vm.stopPrank();

        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK + 2, r);
        ClaimCodeVault.Redeem memory forged = redeemMsg(root, 2, one("namepass", 100 days));
        forged.buyer = other;
        vm.expectRevert(ClaimCodeVault.BadCodeSignature.selector);
        vault.redeem(forged, sig, proofOf(2));
    }

    function test_redeem_notRenewer() public {
        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](1);
        list[0] = ClaimCodeVault.Renewal(makeAddr("fake"), "namepass", 100 days);
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, list);
        bytes memory sig = signRedeem(CODE_PK, r);
        vm.expectRevert(ClaimCodeVault.NotRenewer.selector);
        vault.redeem(r, sig, proofOf(0));
    }

    function test_redeem_nameCount() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, new ClaimCodeVault.Renewal[](0));
        bytes memory sig = signRedeem(CODE_PK, r);
        vm.expectRevert(ClaimCodeVault.BadRenewals.selector);
        vault.redeem(r, sig, proofOf(0));

        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](11);
        for (uint256 i; i < 11; ++i) {
            list[i] = ClaimCodeVault.Renewal(address(renewer), "n", 1 days);
        }
        r = redeemMsg(root, 0, list);
        sig = signRedeem(CODE_PK, r);
        vm.expectRevert(ClaimCodeVault.BadRenewals.selector);
        vault.redeem(r, sig, proofOf(0));
    }

    function test_redeem_maxNames() public {
        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](10);
        for (uint256 i; i < 10; ++i) {
            list[i] = ClaimCodeVault.Renewal(address(renewer), "n", 1 days);
        }
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, list);
        vault.redeem(r, signRedeem(CODE_PK, r), proofOf(0));
        assertEq(renewer.renewals(), 10);
    }

    function test_redeem_maxAboveCodeReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, one("namepass", 100 days));
        r.maxAmount = 50e6 + 1;
        bytes memory sig = signRedeem(CODE_PK, r);
        vm.expectRevert(ClaimCodeVault.InsufficientBalance.selector);
        vault.redeem(r, sig, proofOf(0));
    }

    function test_redeem_priceRoseReverts() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, one("namepass", 365 days));
        bytes memory sig = signRedeem(CODE_PK, r);
        renewer.setRate(2);
        vm.expectRevert();
        vault.redeem(r, sig, proofOf(0));
        assertEq(used(id), 0);
    }

    /// One name that can't be renewed fails the whole redemption; the code stays unused.
    function test_redeem_allOrNothing() public {
        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](2);
        list[0] = ClaimCodeVault.Renewal(address(renewer), "good", 100 days);
        list[1] = ClaimCodeVault.Renewal(address(renewer), "bad", 100 days);
        renewer.setBlocked("bad", true);
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, list);
        bytes memory sig = signRedeem(CODE_PK, r);
        vm.expectRevert("not renewable");
        vault.redeem(r, sig, proofOf(0));
        assertEq(used(id), 0);
        assertEq(renewer.renewed("good"), 0);
    }

    function test_redeem_boundRelayer() public {
        address relayer = makeAddr("relayer");
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, one("namepass", 365 days));
        r.relayer = relayer;
        bytes memory sig = signRedeem(CODE_PK, r);

        vm.prank(makeAddr("bot"));
        vm.expectRevert(ClaimCodeVault.WrongRelayer.selector);
        vault.redeem(r, sig, proofOf(0));

        vm.prank(relayer);
        vault.redeem(r, sig, proofOf(0));
        assertEq(usdc.balanceOf(relayer), 0); // nothing on a code can be paid to the sender
    }

    /// The renewer charges less than the signed maximum: the difference returns to the buyer and
    /// the unused allowance is cleared.
    function test_redeem_cheaperRefundsAndClearsAllowance() public {
        CheapRenewer cheap = new CheapRenewer(IERC20(address(usdc)), 1);
        addRenewer(address(cheap));

        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](1);
        list[0] = ClaimCodeVault.Renewal(address(cheap), "namepass", 100 days);
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, list);
        uint256 before = usdc.balanceOf(buyer);
        vault.redeem(r, signRedeem(CODE_PK, r), proofOf(0));
        assertEq(usdc.balanceOf(address(cheap)), 50 days);
        assertEq(usdc.balanceOf(buyer) - before, 50e6 - 50 days);
        assertEq(usdc.allowance(address(vault), address(cheap)), 0);
    }

    function test_redeem_reentrancyReverts() public {
        ReentrantRenewer evil = new ReentrantRenewer(IERC20(address(usdc)), 1);
        addRenewer(address(evil));
        evil.arm(vault, root);

        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](1);
        list[0] = ClaimCodeVault.Renewal(address(evil), "namepass", 100 days);
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 0, list);
        bytes memory sig = signRedeem(CODE_PK, r);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        vault.redeem(r, sig, proofOf(0));
    }

    /// Any code of a purchase of any size redeems with its proof, and nothing else changes.
    function testFuzz_redeem_anyCodeOfAnySize(uint8 size, uint8 pick, uint32 duration) public {
        uint256 n = bound(size, 1, 200);
        uint256 index = bound(pick, 0, n - 1);
        duration = uint32(bound(duration, 1, 50e6));
        (address[] memory list, bytes32 fuzzRoot, bytes32 fuzzId) = buyFrom(CODE_PK + 1000, n, 50e6);

        ClaimCodeVault.Redeem memory r = redeemMsg(fuzzRoot, index, one("fuzz", duration));
        uint256 before = usdc.balanceOf(buyer);
        vault.redeem(r, signRedeem(CODE_PK + 1000 + index, r), Merkle.proof(list, index));
        assertEq(used(fuzzId), 1 << index);
        assertEq(usdc.balanceOf(buyer) - before, 50e6 - duration);
    }
}

contract CancelTest is VaultBase {
    address[] codes;
    bytes32 root;
    bytes32 id;

    function setUp() public override {
        super.setUp();
        (codes, root, id) = buy(5, 50e6);
    }

    function test_cancel_one() public {
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(address(vault));
        emit ClaimCodeVault.Cancelled(id, buyer, 1 << 3, 50e6);
        vm.prank(buyer);
        assertEq(cancelOne(root, 1 << 3), 1);
        assertEq(usdc.balanceOf(buyer) - before, 50e6);
        assertEq(used(id), 1 << 3);
    }

    function test_cancel_several() public {
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(buyer);
        assertEq(cancelOne(root, 21), 3);
        assertEq(usdc.balanceOf(buyer) - before, 150e6);
        assertEq(used(id), 21);
    }

    /// A full mask cancels everything unused; bits past the count are ignored.
    function test_cancel_all() public {
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(buyer);
        assertEq(cancelOne(root, type(uint256).max), 5);
        assertEq(usdc.balanceOf(buyer) - before, 250e6);
        assertEq(used(id), 31);
        assertEq(usdc.balanceOf(address(vault)), FEE * 5); // fees are not refunded
    }

    function test_cancel_skipsUsed() public {
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 1, one("namepass", 100 days));
        vault.redeem(r, signRedeem(CODE_PK + 1, r), Merkle.proof(codes, 1));
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(buyer);
        assertEq(cancelOne(root, type(uint256).max), 4);
        assertEq(usdc.balanceOf(buyer) - before, 200e6);
    }

    function test_cancel_nothingLeftReverts() public {
        vm.startPrank(buyer);
        cancelOne(root, type(uint256).max);
        vm.expectRevert(ClaimCodeVault.NothingToCancel.selector);
        cancelOne(root, type(uint256).max);
        vm.expectRevert(ClaimCodeVault.NothingToCancel.selector);
        cancelOne(root, 0);
        vm.stopPrank();
    }

    /// Someone else's purchase is not found under the caller's key.
    function test_cancel_notBuyerReverts() public {
        vm.prank(recipient);
        vm.expectRevert(ClaimCodeVault.UnknownCode.selector);
        cancelOne(root, type(uint256).max);
        assertEq(used(id), 0);
    }

    function test_cancel_thenRedeemReverts() public {
        vm.prank(buyer);
        cancelOne(root, 1 << 2);
        ClaimCodeVault.Redeem memory r = redeemMsg(root, 2, one("namepass", 100 days));
        bytes memory sig = signRedeem(CODE_PK + 2, r);
        vm.expectRevert(ClaimCodeVault.CodeUsed.selector);
        vault.redeem(r, sig, Merkle.proof(codes, 2));
        // The others still work.
        r = redeemMsg(root, 4, one("namepass", 100 days));
        vault.redeem(r, signRedeem(CODE_PK + 4, r), Merkle.proof(codes, 4));
    }

    function test_cancel_acrossPurchases() public {
        (, bytes32 root2, bytes32 id2) = buyFrom(CODE_PK + 100, 3, 10e6);
        ClaimCodeVault.Cancel[] memory items = new ClaimCodeVault.Cancel[](2);
        items[0] = ClaimCodeVault.Cancel(root, 3);
        items[1] = ClaimCodeVault.Cancel(root2, type(uint256).max);
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(buyer);
        assertEq(vault.cancel(items), 5);
        assertEq(usdc.balanceOf(buyer) - before, 100e6 + 30e6);
        assertEq(used(id), 3);
        assertEq(used(id2), 7);
    }

    function test_cancel_badSizes() public {
        vm.startPrank(buyer);
        vm.expectRevert(ClaimCodeVault.BadBatch.selector);
        vault.cancel(new ClaimCodeVault.Cancel[](0));
        vm.expectRevert(ClaimCodeVault.BadBatch.selector);
        vault.cancel(new ClaimCodeVault.Cancel[](201));
        vm.stopPrank();
    }

    /// Cancelling the last code of the largest purchase works: its bit fits the record.
    function test_cancel_lastOfLargest() public {
        (, bytes32 bigRoot, bytes32 bigId) = buyFrom(CODE_PK + 200, 200, 1e6);
        vm.prank(buyer);
        assertEq(cancelOne(bigRoot, uint256(1) << 199), 1);
        assertEq(used(bigId), uint256(1) << 199);
        vm.prank(buyer);
        assertEq(cancelOne(bigRoot, type(uint256).max), 199);
    }
}

contract FeesTest is VaultBase {
    function test_sweepFees() public {
        buy(4, 50e6);
        assertEq(vault.feesAccrued(), FEE * 4);
        vm.expectEmit(address(vault));
        emit ClaimCodeVault.FeesSwept(fees, FEE * 4);
        vm.prank(makeAddr("anyone"));
        vault.sweepFees();
        assertEq(usdc.balanceOf(fees), FEE * 4);
        assertEq(vault.feesAccrued(), 0);
        vm.expectRevert(ClaimCodeVault.NothingToSweep.selector);
        vault.sweepFees();
    }

    /// Sweeping never touches the value behind unused codes.
    function test_sweepFees_leavesCodeValue() public {
        (, bytes32 root,) = buy(2, 50e6);
        vault.sweepFees();
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        vm.prank(buyer);
        assertEq(cancelOne(root, type(uint256).max), 2);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}

contract AdminTest is VaultBase {
    function test_renewerTimelock() public {
        address r = address(new MockRenewer(IERC20(address(usdc)), 1));
        vm.prank(owner);
        vault.proposeRenewer(r);
        vm.expectRevert(ClaimCodeVault.RenewerNotReady.selector);
        vault.activateRenewer(r);
        vm.warp(block.timestamp + vault.RENEWER_DELAY());
        vault.activateRenewer(r);
        assertTrue(vault.isRenewer(r));
        vm.expectRevert(ClaimCodeVault.RenewerNotReady.selector);
        vault.activateRenewer(r);
    }

    function test_onlyOwner() public {
        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        vault.proposeRenewer(address(1));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        vault.setMaxCodeAmount(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        vault.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        vault.unpause();
        vm.stopPrank();
    }

    function test_setMaxCodeAmount() public {
        vm.prank(owner);
        vault.setMaxCodeAmount(1000e6);
        assertEq(vault.maxCodeAmount(), 1000e6);
        address[] memory codes = codesFrom(CODE_PK, 1);
        vm.prank(buyer);
        vault.create(codes, 1000e6);
    }

    function test_twoStepOwnership() public {
        address next = makeAddr("next");
        vm.prank(owner);
        vault.transferOwnership(next);
        assertEq(vault.owner(), owner);
        vm.prank(next);
        vault.acceptOwnership();
        assertEq(vault.owner(), next);
    }
}
