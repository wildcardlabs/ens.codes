// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClaimCodeVault} from "../src/ClaimCodeVault.sol";
import {Merkle} from "./utils/Merkle.sol";

interface IRenewerView {
    function isRenewable(string calldata label) external view returns (bool);
    function getRenewPrice(string calldata label, uint64 duration, address token) external view returns (uint256);
}

/// Real renewals against ENS v2 on a fork of mainnet or Sepolia.
/// Run with: MAINNET_RPC_URL=... forge test --match-contract Fork
///       or: FORK_RPC_URL=<sepolia rpc> forge test --match-contract Fork
/// FORK_LABELS is a comma-separated list of names to renew with one code (default: namepass).
contract ForkTest is Test {
    // Mainnet by default; switched to Sepolia's contracts when the fork is Sepolia.
    IERC20 USDC = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    address ETH_REGISTRAR = 0xD6D8369e55c94Ae8AFA714E6cF7AB5bE54D5CC81;
    address ETH_RENEWER_V1 = 0x56c447F308F463A01121C41E72b0E7e7557fCb68;

    ClaimCodeVault vault;
    address buyer = makeAddr("buyer");
    /// One purchase of three codes; the middle one is redeemed, so its proof has real siblings.
    uint256 constant CODE_PK = 0xC0DE;
    uint256 constant INDEX = 1;
    address[] codes;
    bytes32 root;
    bytes32 id;
    string[] labels;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", vm.envOr("MAINNET_RPC_URL", string("")));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        if (block.chainid == 11155111) {
            USDC = IERC20(0x240b0316Df57887DBBE58b586508b19e633a14aa);
            ETH_REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
            ETH_RENEWER_V1 = 0xf2ece44980778966b8a0FccB3A9E339440f6e045;
        }
        string[] memory fallbackLabels = new string[](1);
        fallbackLabels[0] = "namepass";
        labels = vm.envOr("FORK_LABELS", ",", fallbackLabels);

        address[] memory renewers = new address[](2);
        renewers[0] = ETH_REGISTRAR;
        renewers[1] = ETH_RENEWER_V1;
        vault = new ClaimCodeVault(USDC, renewers, bytes32("namepass"), 500e6, address(this), makeAddr("fees"));

        deal(address(USDC), buyer, 2000e6);
        for (uint256 i; i < 3; ++i) {
            codes.push(vm.addr(CODE_PK + i));
        }
        root = Merkle.root(codes);
        vm.startPrank(buyer);
        USDC.approve(address(vault), type(uint256).max);
        id = vault.create(codes, 500e6);
        vm.stopPrank();
    }

    function test_fork_redeemRealRenewals() public {
        uint64 duration = 365 days;
        uint256 n = labels.length;
        // Names on the registrar first, then names on the v1 renewer, so each renewer is one run.
        ClaimCodeVault.Renewal[] memory list = new ClaimCodeVault.Renewal[](n);
        uint256 total;
        uint256 at;
        for (uint256 pass; pass < 2; ++pass) {
            address renewer = pass == 0 ? ETH_REGISTRAR : ETH_RENEWER_V1;
            for (uint256 i; i < n; ++i) {
                bool onRegistrar = IRenewerView(ETH_REGISTRAR).isRenewable(labels[i]);
                if (onRegistrar != (pass == 0)) continue;
                assertTrue(IRenewerView(renewer).isRenewable(labels[i]), "label not renewable");
                list[at++] = ClaimCodeVault.Renewal(renewer, labels[i], duration);
                total += IRenewerView(renewer).getRenewPrice(labels[i], duration, address(USDC));
            }
        }
        assertEq(at, n);
        assertLe(total, 500e6);

        ClaimCodeVault.Redeem memory r = ClaimCodeVault.Redeem({
            buyer: buyer,
            root: root,
            index: INDEX,
            renewals: list,
            maxAmount: total,
            relayer: address(0),
            deadline: block.timestamp + 1 hours
        });
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(CODE_PK + INDEX, this.digestOf(r));

        uint256 buyerBefore = USDC.balanceOf(buyer);
        vm.prank(makeAddr("recipient"));
        vault.redeem(r, abi.encodePacked(rr, s, v), Merkle.proof(codes, INDEX));

        (,, uint200 used) = vault.batches(id);
        assertEq(used, 1 << INDEX);
        // Exactly the quoted total went to ENS; the rest returned to the buyer; fees stay.
        assertEq(USDC.balanceOf(buyer) - buyerBefore, 500e6 - total);
        // The other two codes and the three fees stay in the vault.
        assertEq(USDC.balanceOf(address(vault)), 1000e6 + 3 * vault.PROTOCOL_FEE());
        assertEq(USDC.allowance(address(vault), ETH_REGISTRAR), 0);
        assertEq(USDC.allowance(address(vault), ETH_RENEWER_V1), 0);
        emit log_named_uint("names", n);
        emit log_named_uint("1 year total (USDC units)", total);
    }

    function digestOf(ClaimCodeVault.Redeem calldata r) external view returns (bytes32) {
        return vault.hashRedeem(r);
    }
}
