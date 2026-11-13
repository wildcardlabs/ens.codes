// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClaimCodeVault} from "../src/ClaimCodeVault.sol";

/// Deploys the vault with the ENS v2 renewers and USDC for the current chain.
///
///   forge script script/Deploy.s.sol --rpc-url <url> --broadcast [--account <keystore>]
///
/// Required env: FEE_RECIPIENT, the address collected protocol fees are swept to (fixed for this deployment).
/// Optional env: OWNER (default: deployer), MAX_CODE_AMOUNT (default 500 USDC), REFERRER (bytes32).
/// The protocol fee itself is fixed in the contract: 0.05 USDC per code.
contract Deploy is Script {
    function run() external returns (ClaimCodeVault vault) {
        (address usdc, address registrar, address renewerV1) = _addresses(block.chainid);
        address[] memory renewers = new address[](2);
        renewers[0] = registrar;
        renewers[1] = renewerV1;

        vm.startBroadcast();
        address owner = vm.envOr("OWNER", msg.sender);
        uint96 maxCode = uint96(vm.envOr("MAX_CODE_AMOUNT", uint256(500e6)));
        bytes32 referrer = vm.envOr("REFERRER", bytes32("namepass"));
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        vault = new ClaimCodeVault(IERC20(usdc), renewers, referrer, maxCode, owner, feeRecipient);
        vm.stopBroadcast();

        console.log("ClaimCodeVault", address(vault));
        console.log("deploy block", block.number);
        console.log("fee recipient", feeRecipient);
    }

    /// Same addresses as ens-budget's `addresses` export.
    function _addresses(uint256 chainId) internal pure returns (address, address, address) {
        // 31337: local anvil fork of mainnet (see scripts/local-fork.sh).
        if (chainId == 1 || chainId == 31337) {
            return (
                0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,
                0xD6D8369e55c94Ae8AFA714E6cF7AB5bE54D5CC81,
                0x56c447F308F463A01121C41E72b0E7e7557fCb68
            );
        }
        if (chainId == 11155111) {
            return (
                0x240b0316Df57887DBBE58b586508b19e633a14aa,
                0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3,
                0xf2ece44980778966b8a0FccB3A9E339440f6e045
            );
        }
        revert("unsupported chain");
    }
}
