// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClaimCodeVault} from "../src/ClaimCodeVault.sol";
import {MockRenewer, MockUSDC} from "./mocks/Mocks.sol";
import {Merkle} from "./utils/Merkle.sol";

contract Handler is Test {
    ClaimCodeVault public vault;
    MockUSDC public usdc;
    MockRenewer public renewer;
    MockRenewer public renewer2;
    address public buyer = makeAddr("buyer");

    struct Purchase {
        bytes32 root;
        uint256 firstPk;
        uint256 count;
    }

    Purchase[] public purchases;
    uint256 nextPk = 1000;

    constructor(ClaimCodeVault vault_, MockUSDC usdc_, MockRenewer renewer_, MockRenewer renewer2_) {
        vault = vault_;
        usdc = usdc_;
        renewer = renewer_;
        renewer2 = renewer2_;
        usdc.mint(buyer, type(uint128).max);
        vm.prank(buyer);
        usdc.approve(address(vault), type(uint256).max);
    }

    function purchaseCount() external view returns (uint256) {
        return purchases.length;
    }

    function idAt(uint256 i) external view returns (bytes32) {
        return vault.batchId(buyer, purchases[i].root);
    }

    function _codes(Purchase memory p) internal pure returns (address[] memory codes) {
        codes = new address[](p.count);
        for (uint256 i; i < p.count; ++i) {
            codes[i] = vm.addr(p.firstPk + i);
        }
    }

    function create(uint96 amount, uint8 count) external {
        amount = uint96(bound(amount, vault.MIN_CODE_AMOUNT(), vault.maxCodeAmount()));
        Purchase memory p = Purchase(bytes32(0), nextPk, bound(count, 1, 9));
        nextPk += p.count;
        address[] memory codes = _codes(p);
        p.root = Merkle.root(codes);
        vm.prank(buyer);
        vault.create(codes, amount);
        purchases.push(p);
    }

    /// One to three names across both renewers, spending part or all of the code.
    function redeem(uint256 which, uint256 pick, uint64 d1, uint64 d2, uint64 d3, uint8 names, bool bindRelayer)
        external
    {
        if (purchases.length == 0) return;
        Purchase memory p = purchases[which % purchases.length];
        uint256 index = pick % p.count;
        bytes32 id = vault.batchId(buyer, p.root);
        if (vault.isUsed(id, index)) return;
        (uint48 amount,,) = vault.batches(id);
        (ClaimCodeVault.Renewal[] memory list, uint256 total) = _renewals(amount, [d1, d2, d3], names);
        address relayer = makeAddr("relayer");
        ClaimCodeVault.Redeem memory r = ClaimCodeVault.Redeem({
            buyer: buyer,
            root: p.root,
            index: index,
            renewals: list,
            maxAmount: total,
            relayer: bindRelayer ? relayer : address(0),
            deadline: block.timestamp + 1
        });
        _submit(p, r, relayer);
    }

    function _renewals(uint256 amount, uint64[3] memory d, uint8 names)
        internal
        view
        returns (ClaimCodeVault.Renewal[] memory list, uint256 total)
    {
        uint256 n = bound(names, 1, 3);
        uint64 per = uint64(amount / n);
        list = new ClaimCodeVault.Renewal[](n);
        for (uint256 i; i < n; ++i) {
            uint64 duration = uint64(bound(d[i], 1, per));
            list[i] = ClaimCodeVault.Renewal(i == 0 ? address(renewer) : address(renewer2), "fuzz", duration);
            total += duration;
        }
    }

    function _submit(Purchase memory p, ClaimCodeVault.Redeem memory r, address relayer) internal {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(p.firstPk + r.index, this.digestOf(r));
        bytes32[] memory proof = Merkle.proof(_codes(p), r.index);
        vm.prank(relayer);
        vault.redeem(r, abi.encodePacked(rr, s, v), proof);
    }

    /// Cancels an arbitrary set of codes in up to two purchases; already-used ones are skipped.
    function cancel(uint256 a, uint256 maskA, uint256 b, uint256 maskB) external {
        if (purchases.length == 0) return;
        Purchase memory pa = purchases[a % purchases.length];
        Purchase memory pb = purchases[b % purchases.length];
        ClaimCodeVault.Cancel[] memory items = new ClaimCodeVault.Cancel[](2);
        items[0] = ClaimCodeVault.Cancel(pa.root, maskA);
        items[1] = ClaimCodeVault.Cancel(pb.root, maskB);
        vm.prank(buyer);
        try vault.cancel(items) {}
        catch (bytes memory reason) {
            // The only acceptable failure: every chosen code was already used.
            assertEq(bytes4(reason), ClaimCodeVault.NothingToCancel.selector);
        }
    }

    function sweep() external {
        if (vault.feesAccrued() == 0) return;
        vault.sweepFees();
    }

    function digestOf(ClaimCodeVault.Redeem calldata r) external view returns (bytes32) {
        return vault.hashRedeem(r);
    }
}

contract InvariantTest is Test {
    ClaimCodeVault vault;
    MockUSDC usdc;
    Handler handler;

    function setUp() public {
        usdc = new MockUSDC();
        MockRenewer renewer = new MockRenewer(IERC20(address(usdc)), 1);
        MockRenewer renewer2 = new MockRenewer(IERC20(address(usdc)), 1);
        address[] memory renewers = new address[](2);
        renewers[0] = address(renewer);
        renewers[1] = address(renewer2);
        vault = new ClaimCodeVault(IERC20(address(usdc)), renewers, bytes32(0), 500e6, address(this), makeAddr("fees"));
        handler = new Handler(vault, usdc, renewer, renewer2);
        targetContract(address(handler));
    }

    /// The vault always holds exactly every unused code's value plus the unswept fees.
    function invariant_solvent() public view {
        uint256 sum = vault.feesAccrued();
        for (uint256 i; i < handler.purchaseCount(); ++i) {
            (uint48 amount, uint8 count, uint200 used) = vault.batches(handler.idAt(i));
            uint256 unused = count;
            for (uint256 x = used; x != 0; x &= x - 1) {
                --unused;
            }
            sum += unused * amount;
        }
        assertEq(usdc.balanceOf(address(vault)), sum);
    }

    /// No used bit is ever set past a purchase's count.
    function invariant_usedBitsWithinCount() public view {
        for (uint256 i; i < handler.purchaseCount(); ++i) {
            (, uint8 count, uint200 used) = vault.batches(handler.idAt(i));
            assertEq(uint256(used) >> count, 0);
        }
    }

    function invariant_noLeftoverAllowance() public view {
        assertEq(usdc.allowance(address(vault), address(handler.renewer())), 0);
        assertEq(usdc.allowance(address(vault), address(handler.renewer2())), 0);
    }
}
