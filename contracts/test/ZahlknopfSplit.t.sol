// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}        from "forge-std/Test.sol";
import {IERC20}      from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ZahlknopfSplit} from "../ZahlknopfSplit.sol";
import {MockERC20}      from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  Malicious ERC-20: re-enters ZahlknopfSplit.pay() on the FIRST transferFrom
// ─────────────────────────────────────────────────────────────────────────────
contract ReentrantERC20 is MockERC20 {
    ZahlknopfSplit public target;
    uint256        public reentrantAmount;
    bytes32        public reentrantOrderId;
    bool           private _reentryArmed;   // fires only once

    constructor() MockERC20("Reentrant USDC", "rUSDC", 6) {}

    function arm(ZahlknopfSplit target_, uint256 amount_, bytes32 orderId_) external {
        target          = target_;
        reentrantAmount = amount_;
        reentrantOrderId = orderId_;
        _reentryArmed   = true;
    }

    /// @dev Override transferFrom; on first call re-enter pay() before returning.
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        // Normal bookkeeping first (so allowance is consumed and balance moves)
        uint256 allowed = _allowances_ext(from, msg.sender);
        require(allowed >= amount, "ERC20: insufficient allowance");
        _setAllowance(from, msg.sender, allowed - amount);
        _transferInternal(from, to, amount);

        if (_reentryArmed) {
            _reentryArmed = false;              // disarm so we don't recurse forever
            target.pay(reentrantAmount, reentrantOrderId);   // <-- re-entry attempt
        }
        return true;
    }

    // ── helpers to access parent storage ─────────────────────────────────────
    function _allowances_ext(address owner_, address spender) internal view returns (uint256) {
        return this.allowance(owner_, spender);
    }
    function _setAllowance(address owner_, address spender, uint256 val) internal {
        // Write via a transient delegatecall isn't possible here; replicate the
        // mapping write directly by using the same slot layout as MockERC20.
        // MockERC20._allowances is slot 4 (name=0,symbol=1,decimals=2,
        //   _balances=3, _allowances=4, _totalSupply=5).
        bytes32 slot = keccak256(abi.encode(spender, keccak256(abi.encode(owner_, uint256(4)))));
        assembly { sstore(slot, val) }
    }
    function _transferInternal(address from, address to, uint256 amount) internal {
        // _balances slot 3
        bytes32 slotFrom = keccak256(abi.encode(from, uint256(3)));
        bytes32 slotTo   = keccak256(abi.encode(to,   uint256(3)));
        uint256 balFrom;
        assembly { balFrom := sload(slotFrom) }
        require(balFrom >= amount, "ERC20: transfer exceeds balance");
        assembly {
            sstore(slotFrom, sub(balFrom, amount))
            sstore(slotTo,   add(sload(slotTo), amount))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main test contract
// ─────────────────────────────────────────────────────────────────────────────
contract ZahlknopfSplitTest is Test {

    // ── actors ────────────────────────────────────────────────────────────────
    address internal payer   = makeAddr("payer");
    address internal recvA   = makeAddr("recvA");
    address internal recvB   = makeAddr("recvB");
    address internal recvC   = makeAddr("recvC");

    // ── tokens ────────────────────────────────────────────────────────────────
    MockERC20 internal usdc;

    // ── helper: fund payer and approve splitter ───────────────────────────────
    function _fund(ZahlknopfSplit split, uint256 amount) internal {
        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(split), amount);
    }

    // ── deploy a 2-recipient (95/5) splitter ─────────────────────────────────
    function _deploy95_5() internal returns (ZahlknopfSplit) {
        address[] memory recs  = new address[](2);
        uint16[]  memory bps   = new uint16[](2);
        recs[0] = recvA; recs[1] = recvB;
        bps[0]  = 9500;  bps[1]  = 500;
        return new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    // ── deploy a 3-recipient (50/30/20) splitter ──────────────────────────────
    function _deploy50_30_20() internal returns (ZahlknopfSplit) {
        address[] memory recs = new address[](3);
        uint16[]  memory bps  = new uint16[](3);
        recs[0] = recvA; recs[1] = recvB; recs[2] = recvC;
        bps[0]  = 5000;  bps[1]  = 3000;  bps[2]  = 2000;
        return new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  1. Deployment & view getters
    // ══════════════════════════════════════════════════════════════════════════

    function test_Constructor_SetsUsdc() public {
        ZahlknopfSplit split = _deploy95_5();
        assertEq(split.usdc(), address(usdc));
    }

    function test_Constructor_SetsRecipients() public {
        ZahlknopfSplit split = _deploy95_5();
        address[] memory r = split.recipients();
        assertEq(r.length, 2);
        assertEq(r[0], recvA);
        assertEq(r[1], recvB);
    }

    function test_Constructor_SetsShares() public {
        ZahlknopfSplit split = _deploy95_5();
        uint16[] memory s = split.shares();
        assertEq(s.length, 2);
        assertEq(s[0], 9500);
        assertEq(s[1], 500);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  2. Constructor reverts
    // ══════════════════════════════════════════════════════════════════════════

    function test_Constructor_Revert_ZeroTokenAddress() public {
        address[] memory recs = new address[](1);
        uint16[]  memory bps  = new uint16[](1);
        recs[0] = recvA; bps[0] = 10_000;
        vm.expectRevert(ZahlknopfSplit.ZeroAddress.selector);
        new ZahlknopfSplit(IERC20(address(0)), recs, bps);
    }

    function test_Constructor_Revert_EmptyRecipients() public {
        address[] memory recs = new address[](0);
        uint16[]  memory bps  = new uint16[](0);
        vm.expectRevert(ZahlknopfSplit.EmptyRecipients.selector);
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function test_Constructor_Revert_LengthMismatch() public {
        address[] memory recs = new address[](2);
        uint16[]  memory bps  = new uint16[](1);
        recs[0] = recvA; recs[1] = recvB;
        bps[0]  = 10_000;
        vm.expectRevert(ZahlknopfSplit.LengthMismatch.selector);
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function test_Constructor_Revert_TooManyRecipients() public {
        uint256 n = 11;
        address[] memory recs = new address[](n);
        uint16[]  memory bps  = new uint16[](n);
        for (uint256 i = 0; i < n; ++i) {
            recs[i] = address(uint160(i + 1));
            bps[i]  = 909; // sum won't matter; checked after length
        }
        vm.expectRevert(ZahlknopfSplit.TooManyRecipients.selector);
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function test_Constructor_Revert_ZeroRecipientAddress() public {
        address[] memory recs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        recs[0] = recvA; recs[1] = address(0);
        bps[0]  = 9000;  bps[1]  = 1000;
        vm.expectRevert(ZahlknopfSplit.ZeroAddress.selector);
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function test_Constructor_Revert_ZeroShare() public {
        address[] memory recs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        recs[0] = recvA; recs[1] = recvB;
        bps[0]  = 10_000; bps[1] = 0;
        vm.expectRevert(ZahlknopfSplit.ZeroShare.selector);
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function test_Constructor_Revert_InvalidShareSum_TooLow() public {
        address[] memory recs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        recs[0] = recvA; recs[1] = recvB;
        bps[0]  = 5000;  bps[1]  = 4000; // sum = 9000
        vm.expectRevert(
            abi.encodeWithSelector(ZahlknopfSplit.InvalidShareSum.selector, uint256(9000))
        );
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function test_Constructor_Revert_InvalidShareSum_TooHigh() public {
        address[] memory recs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        recs[0] = recvA; recs[1] = recvB;
        bps[0]  = 9000;  bps[1]  = 2000; // sum = 11000
        vm.expectRevert(
            abi.encodeWithSelector(ZahlknopfSplit.InvalidShareSum.selector, uint256(11000))
        );
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    function test_Constructor_Revert_DuplicateRecipient() public {
        address[] memory recs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        recs[0] = recvA; recs[1] = recvA; // duplicate
        bps[0]  = 5000;  bps[1]  = 5000;
        vm.expectRevert(
            abi.encodeWithSelector(ZahlknopfSplit.DuplicateRecipient.selector, recvA)
        );
        new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  3. pay() revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_Pay_Revert_ZeroAmount() public {
        ZahlknopfSplit split = _deploy95_5();
        vm.prank(payer);
        vm.expectRevert(ZahlknopfSplit.ZeroAmount.selector);
        split.pay(0, bytes32(0));
    }

    function test_Pay_Revert_InsufficientAllowance() public {
        ZahlknopfSplit split  = _deploy95_5();
        uint256        amount = 1_000e6;
        usdc.mint(payer, amount);
        // payer approves LESS than amount
        vm.prank(payer);
        usdc.approve(address(split), amount - 1);
        vm.prank(payer);
        vm.expectRevert();   // SafeERC20 wraps the revert — any revert is correct
        split.pay(amount, bytes32(0));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  4. Split correctness — 95 / 5 two-recipient
    // ══════════════════════════════════════════════════════════════════════════

    function test_Split_95_5_BalancesAndContractHoldsNothing() public {
        ZahlknopfSplit split  = _deploy95_5();
        uint256        amount = 1_000e6; // 1 000 USDC (6 decimals)
        _fund(split, amount);

        uint256 payerBefore = usdc.balanceOf(payer);

        vm.prank(payer);
        split.pay(amount, bytes32("order-1"));

        // Payer balance decreased by exactly amount
        assertEq(usdc.balanceOf(payer), payerBefore - amount, "payer balance mismatch");

        // Contract holds nothing
        assertEq(usdc.balanceOf(address(split)), 0, "contract should hold 0");

        // recvA gets 95 %
        uint256 expectedA = (amount * 9500) / 10_000;          // 950_000_000
        assertEq(usdc.balanceOf(recvA), expectedA, "recvA share");

        // recvB gets the remainder (5 % + any dust)
        uint256 expectedB = amount - expectedA;
        assertEq(usdc.balanceOf(recvB), expectedB, "recvB share");

        // Sum equals total
        assertEq(usdc.balanceOf(recvA) + usdc.balanceOf(recvB), amount, "sum != amount");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  5. Split correctness — 3-way 50 / 30 / 20
    // ══════════════════════════════════════════════════════════════════════════

    function test_Split_50_30_20_BalancesAndContractHoldsNothing() public {
        ZahlknopfSplit split  = _deploy50_30_20();
        uint256        amount = 1_000e6;
        _fund(split, amount);

        vm.prank(payer);
        split.pay(amount, bytes32("order-2"));

        assertEq(usdc.balanceOf(address(split)), 0, "contract should hold 0");

        uint256 partA = (amount * 5000) / 10_000; // 500_000_000
        uint256 partB = (amount * 3000) / 10_000; // 300_000_000
        uint256 partC = amount - partA - partB;    // 200_000_000 (remainder)

        assertEq(usdc.balanceOf(recvA), partA, "recvA 50%");
        assertEq(usdc.balanceOf(recvB), partB, "recvB 30%");
        assertEq(usdc.balanceOf(recvC), partC, "recvC 20% + remainder");
        assertEq(partA + partB + partC, amount, "sum != amount");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  6. Rounding with small / odd amounts — remainder goes to last recipient
    // ══════════════════════════════════════════════════════════════════════════

    // Helper: compute expected parts mirroring the contract's own algorithm
    function _expectedParts(uint256 amount, uint16[] memory bps)
        internal
        pure
        returns (uint256[] memory parts)
    {
        uint256 n = bps.length;
        parts = new uint256[](n);
        uint256 distributed;
        for (uint256 i = 0; i + 1 < n; ++i) {
            parts[i]    = (amount * bps[i]) / 10_000;
            distributed += parts[i];
        }
        parts[n - 1] = amount - distributed;
    }

    function _checkRounding(ZahlknopfSplit split, uint256 amount) internal {
        address[] memory recs = split.recipients();
        uint16[]  memory bps  = split.shares();

        _fund(split, amount);
        vm.prank(payer);
        split.pay(amount, bytes32("rounding-order"));

        uint256[] memory expected = _expectedParts(amount, bps);
        uint256 sumParts;
        for (uint256 i = 0; i < recs.length; ++i) {
            assertEq(usdc.balanceOf(recs[i]), expected[i],
                string(abi.encodePacked("recipient ", vm.toString(i), " balance mismatch")));
            sumParts += expected[i];
        }
        assertEq(sumParts, amount, "sum of parts != amount");
        assertEq(usdc.balanceOf(address(split)), 0, "contract holds dust");
    }

    function test_Rounding_Amount1() public {
        ZahlknopfSplit split = _deploy95_5();
        _checkRounding(split, 1);
    }

    function test_Rounding_Amount7() public {
        ZahlknopfSplit split = _deploy95_5();
        _checkRounding(split, 7);
    }

    function test_Rounding_Amount999999() public {
        ZahlknopfSplit split = _deploy95_5();
        _checkRounding(split, 999_999);
    }

    function test_Rounding_3Way_Amount1() public {
        ZahlknopfSplit split = _deploy50_30_20();
        _checkRounding(split, 1);
    }

    function test_Rounding_3Way_Amount7() public {
        ZahlknopfSplit split = _deploy50_30_20();
        _checkRounding(split, 7);
    }

    function test_Rounding_3Way_Amount999999() public {
        ZahlknopfSplit split = _deploy50_30_20();
        _checkRounding(split, 999_999);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  7. Fuzz — random amounts: sum of distributed parts always == amount
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_SumAlwaysEqualsAmount_95_5(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max); // avoid ridiculous supply inflation

        ZahlknopfSplit split = _deploy95_5();
        _fund(split, amount);

        vm.prank(payer);
        split.pay(amount, bytes32("fuzz-order"));

        uint256 sumOut = usdc.balanceOf(recvA) + usdc.balanceOf(recvB);
        assertEq(sumOut, amount, "fuzz 95/5: sum != amount");
        assertEq(usdc.balanceOf(address(split)), 0, "fuzz 95/5: contract holds tokens");
    }

    function testFuzz_SumAlwaysEqualsAmount_50_30_20(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);

        ZahlknopfSplit split = _deploy50_30_20();
        _fund(split, amount);

        vm.prank(payer);
        split.pay(amount, bytes32("fuzz-order-3way"));

        uint256 sumOut = usdc.balanceOf(recvA)
                       + usdc.balanceOf(recvB)
                       + usdc.balanceOf(recvC);
        assertEq(sumOut, amount, "fuzz 50/30/20: sum != amount");
        assertEq(usdc.balanceOf(address(split)), 0, "fuzz 50/30/20: contract holds tokens");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  8. Reentrancy guard
    // ══════════════════════════════════════════════════════════════════════════

    function test_Reentrancy_Reverts_With_ReentrancyGuardReentrantCall() public {
        // Deploy the malicious token
        ReentrantERC20 badToken = new ReentrantERC20();

        // Build a 2-recipient splitter that uses badToken
        address[] memory recs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        recs[0] = recvA; recs[1] = recvB;
        bps[0]  = 9500;  bps[1]  = 500;
        ZahlknopfSplit split = new ZahlknopfSplit(IERC20(address(badToken)), recs, bps);

        uint256 amount    = 100e6;
        bytes32 orderId   = bytes32("reentrant-order");

        // Mint and approve for payer
        badToken.mint(payer, amount * 2);    // extra for the reentrant call
        vm.prank(payer);
        badToken.approve(address(split), amount * 2);

        // Arm the reentrancy trap: during the first transferFrom, the mock will
        // call split.pay(amount, orderId) again — which must revert.
        badToken.arm(split, amount, orderId);

        // The outer call must revert with the OZ reentrancy guard error
        vm.prank(payer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        split.pay(amount, orderId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  9. Event Paid is emitted with correct indexed payer, orderId, amount
    // ══════════════════════════════════════════════════════════════════════════

    function test_Event_Paid_EmittedCorrectly() public {
        ZahlknopfSplit split   = _deploy95_5();
        uint256        amount  = 500e6;
        bytes32        orderId = bytes32("event-test-order");
        _fund(split, amount);

        vm.prank(payer);
        // checkTopic1=true (payer), checkTopic2=true (orderId),
        // checkTopic3=false (no 3rd indexed), checkData=true (amount)
        vm.expectEmit(true, true, false, true, address(split));
        emit ZahlknopfSplit.Paid(payer, orderId, amount);
        split.pay(amount, orderId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  10. Single-recipient edge case (100 % to one address)
    // ══════════════════════════════════════════════════════════════════════════

    function test_SingleRecipient_FullAmountDelivered() public {
        address[] memory recs = new address[](1);
        uint16[]  memory bps  = new uint16[](1);
        recs[0] = recvA; bps[0] = 10_000;
        ZahlknopfSplit split = new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);

        uint256 amount = 250e6;
        _fund(split, amount);

        vm.prank(payer);
        split.pay(amount, bytes32("single-recipient"));

        assertEq(usdc.balanceOf(recvA), amount, "single recipient should receive all");
        assertEq(usdc.balanceOf(address(split)), 0, "contract should hold 0");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  11. Max recipients (10) — constructor allows it; pay distributes correctly
    // ══════════════════════════════════════════════════════════════════════════

    function test_MaxRecipients_10_Deploys_And_Pays() public {
        uint256 n = 10;
        address[] memory recs = new address[](n);
        uint16[]  memory bps  = new uint16[](n);
        uint256 totalBps;
        for (uint256 i = 0; i < n - 1; ++i) {
            recs[i] = address(uint160(0xBEEF + i));
            bps[i]  = 1000; // 10 % each
            totalBps += 1000;
        }
        recs[n - 1] = address(uint160(0xBEEF + n - 1));
        bps[n - 1]  = uint16(10_000 - totalBps); // last gets the rest (1000)
        ZahlknopfSplit split = new ZahlknopfSplit(IERC20(address(usdc)), recs, bps);

        uint256 amount = 1_000e6;
        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(split), amount);

        vm.prank(payer);
        split.pay(amount, bytes32("max-recipients"));

        uint256 totalOut;
        for (uint256 i = 0; i < n; ++i) {
            totalOut += usdc.balanceOf(recs[i]);
        }
        assertEq(totalOut, amount, "max recipients: sum != amount");
        assertEq(usdc.balanceOf(address(split)), 0, "max recipients: contract holds tokens");
    }
}
