// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClaimCodeVault, IETHRenewer} from "../../src/ClaimCodeVault.sol";

contract MockUSDC is ERC20, ERC20Permit {
    constructor() ERC20("USD Coin", "USDC") ERC20Permit("USD Coin") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Prices every second at `rate` token units and pulls exactly the total price of a batch.
contract MockRenewer is IETHRenewer {
    IERC20 public immutable token;
    uint256 public rate;
    bytes32 public lastReferrer;
    uint256 public renewals;
    mapping(string label => uint64) public renewed;
    mapping(string label => bool) public blocked;

    constructor(IERC20 token_, uint256 rate_) {
        token = token_;
        rate = rate_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function setBlocked(string calldata label, bool on) external {
        blocked[label] = on;
    }

    function priceOf(RenewData[] calldata rds) public view returns (uint256 total) {
        for (uint256 i; i < rds.length; ++i) {
            total += uint256(rds[i].duration) * rate;
        }
    }

    function renewBatch(RenewData[] calldata rds, address paymentToken) external virtual {
        IERC20(paymentToken).transferFrom(msg.sender, address(this), priceOf(rds));
        for (uint256 i; i < rds.length; ++i) {
            require(!blocked[rds[i].label], "not renewable");
            renewed[rds[i].label] += rds[i].duration;
            lastReferrer = rds[i].referrer;
            renewals++;
        }
    }
}

/// Charges half of what the durations cost (e.g. a price drop between quote and send).
contract CheapRenewer is MockRenewer {
    constructor(IERC20 token_, uint256 rate_) MockRenewer(token_, rate_) {}

    function renewBatch(RenewData[] calldata rds, address paymentToken) external override {
        IERC20(paymentToken).transferFrom(msg.sender, address(this), priceOf(rds) / 2);
        renewals += rds.length;
    }
}

/// Tries to re-enter the vault during a renewal.
contract ReentrantRenewer is MockRenewer {
    ClaimCodeVault public vault;
    bytes32 public target;

    constructor(IERC20 token_, uint256 rate_) MockRenewer(token_, rate_) {}

    function arm(ClaimCodeVault vault_, bytes32 root_) external {
        vault = vault_;
        target = root_;
    }

    function renewBatch(RenewData[] calldata, address) external override {
        ClaimCodeVault.Cancel[] memory items = new ClaimCodeVault.Cancel[](1);
        items[0] = ClaimCodeVault.Cancel(target, type(uint256).max);
        vault.cancel(items);
    }
}
