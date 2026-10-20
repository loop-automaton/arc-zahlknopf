// SPDX-License-Identifier: MIT
// USDC address on Arc Testnet: 0x3600000000000000000000000000000000000000
// Source: Arc Studio onchain-facts registry (generated from Circle's canonical testnet USDC deployment)
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ZahlknopfSplit — immutable USDC payment splitter
/// @notice Forwards a single payment to fixed recipients in one atomic transaction.
///         Recipients and shares are set at deployment and cannot be changed.
/// @dev OPERATIONAL RISK: USDC (Circle) can blocklist any address. If any fixed recipient
///      is blocklisted after deployment, every call to `pay()` will revert permanently,
///      because all transfers are atomic and the contract is immutable (no admin, no upgrade).
///      Deployers MUST pre-verify that all recipients are not USDC-blocklisted and accept
///      that this splitter becomes permanently inoperable if any recipient is blocked later.
contract ZahlknopfSplit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error EmptyRecipients();
    error LengthMismatch();
    error TooManyRecipients();
    error DuplicateRecipient(address recipient);
    error ZeroShare();
    error InvalidShareSum(uint256 actual);
    error ZeroAmount();

    event Paid(address indexed payer, bytes32 indexed orderId, uint256 amount);

    IERC20 private immutable _usdc;
    address[] private _recipients;
    uint16[] private _shares;

    constructor(IERC20 usdc_, address[] memory recipients_, uint16[] memory sharesBps_) {
        if (address(usdc_) == address(0)) revert ZeroAddress();

        uint256 len = recipients_.length;
        if (len == 0) revert EmptyRecipients();
        if (len != sharesBps_.length) revert LengthMismatch();
        if (len > 10) revert TooManyRecipients();

        uint256 totalShares = 0;
        for (uint256 i = 0; i < len; ++i) {
            address recipient = recipients_[i];
            if (recipient == address(0)) revert ZeroAddress();

            for (uint256 j = 0; j < i; ++j) {
                if (recipients_[j] == recipient) revert DuplicateRecipient(recipient);
            }

            uint16 share = sharesBps_[i];
            if (share == 0) revert ZeroShare();

            totalShares += share;
            _recipients.push(recipient);
            _shares.push(share);
        }

        if (totalShares != 10_000) revert InvalidShareSum(totalShares);

        _usdc = usdc_;
    }

    function pay(uint256 amount, bytes32 orderId) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 len = _recipients.length;
        uint256 distributed = 0;

        for (uint256 i = 0; i + 1 < len; ++i) {
            uint256 part = (amount * _shares[i]) / 10_000;
            distributed += part;
            _usdc.safeTransferFrom(msg.sender, _recipients[i], part);
        }

        uint256 remainder = amount - distributed;
        _usdc.safeTransferFrom(msg.sender, _recipients[len - 1], remainder);

        emit Paid(msg.sender, orderId, amount);
    }

    function usdc() external view returns (address) {
        return address(_usdc);
    }

    function recipients() external view returns (address[] memory) {
        return _recipients;
    }

    function shares() external view returns (uint16[] memory) {
        return _shares;
    }
}
