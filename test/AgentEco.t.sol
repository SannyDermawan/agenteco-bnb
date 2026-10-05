// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentEco} from "../contracts/AgentEco.sol";
import {TestToken} from "./mocks/TestToken.sol";

/// Shared fixture: demo-length durations, a funded buyer, and step helpers.
abstract contract AgentEcoBase is Test {
    uint256 internal constant MIN_WINDOW = 120;
    uint256 internal constant ACCEPT_TIMEOUT = 120;
    uint256 internal constant DISPUTE_TIMEOUT = 900;
    uint256 internal constant EXEC_WINDOW = 300;
    uint256 internal constant REVIEW_WINDOW = 600;

    AgentEco internal eco;
    TestToken internal token;

    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant TASK = keccak256("task");
    bytes32 internal constant RESULT = keccak256("result");
    bytes32 internal constant REASON = keccak256("reason");
    bytes32 internal constant RESPONSE = keccak256("response");
    bytes32 internal constant RATIONALE = keccak256("rationale");

    uint256 internal amount;

    // AgentEco.OrderStatus
    uint8 internal constant CREATED = 0;
    uint8 internal constant FUNDED = 1;
    uint8 internal constant EXECUTING = 2;
    uint8 internal constant DELIVERED = 3;
    uint8 internal constant DISPUTED = 4;
    uint8 internal constant SETTLED = 5;
    uint8 internal constant REFUNDED = 6;

    function _deploy(uint8 decimals) internal {
        vm.warp(1_700_000_000);
        token = new TestToken(decimals);
        eco = new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 1, 0, address(0xFEE));
        amount = 25 * 10 ** (decimals - 2); // 0.25 USDT
        token.mint(buyer, 1_000 * 10 ** decimals);
        vm.prank(buyer);
        token.approve(address(eco), type(uint256).max);
    }

    function _create() internal returns (uint256 id) {
        vm.prank(buyer);
        id = eco.createEscrow(seller, amount, EXEC_WINDOW, REVIEW_WINDOW, TASK);
    }

    function _funded() internal returns (uint256 id) {
        id = _create();
        vm.prank(buyer);
        eco.fundEscrow(id);
    }

    function _executing() internal returns (uint256 id) {
        id = _funded();
        vm.prank(seller);
        eco.startExecution(id);
    }

    function _delivered() internal returns (uint256 id) {
        id = _executing();
        vm.prank(seller);
        eco.markDelivered(id, RESULT);
    }

    function _disputed() internal returns (uint256 id) {
        id = _delivered();
        vm.prank(buyer);
        eco.raiseDispute(id, REASON);
    }

    function _status(uint256 id) internal view returns (uint8) {
        (,,, AgentEco.OrderStatus s) = eco.getEscrowBasic(id);
        return uint8(s);
    }

    function _rep(address who)
        internal
        view
        returns (uint256 completed, uint256 failed, uint256 volume, uint256 ratingSum, uint256 ratingCount)
    {
        return eco.getReputation(who);
    }
}

contract AgentEcoTest is AgentEcoBase {
    event EscrowCreated(uint256 indexed escrowId, address indexed buyer, address indexed seller, uint256 amount, bytes32 taskHash);
    event EscrowRefunded(uint256 indexed escrowId, address indexed buyer, uint256 amount);
    event AcceptTimedOut(uint256 indexed escrowId, address indexed buyer, uint256 amount);
    event DisputeRaised(uint256 indexed escrowId, address indexed buyer, bytes32 reasonHash);
    event DisputeResponseSubmitted(uint256 indexed escrowId, address indexed seller, bytes32 responseHash);
    event DisputeResolved(uint256 indexed escrowId, address indexed arbiter, bool releasedToSeller, bytes32 rationaleHash);
    event DisputeTimedOut(uint256 indexed escrowId, address indexed buyer, uint256 amount);
    event SellerRated(uint256 indexed escrowId, address indexed seller, address indexed buyer, uint8 score);

    function setUp() public {
        _deploy(18);
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    function test_constructor_setsConfig() public view {
        assertEq(eco.USDT(), address(token));
        assertEq(eco.arbiter(), arbiter);
        assertEq(eco.minWindow(), MIN_WINDOW);
        assertEq(eco.acceptTimeout(), ACCEPT_TIMEOUT);
        assertEq(eco.disputeTimeout(), DISPUTE_TIMEOUT);
        assertEq(eco.MAX_WINDOW(), 90 days);
    }

    function test_constructor_rejectsZeroToken() public {
        vm.expectRevert("Invalid USDT address");
        new AgentEco(address(0), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 1, 0, address(0xFEE));
    }

    function test_constructor_rejectsZeroArbiter() public {
        vm.expectRevert("Invalid arbiter");
        new AgentEco(address(token), address(0), MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 1, 0, address(0xFEE));
    }

    function test_constructor_rejectsZeroMinWindow() public {
        vm.expectRevert("Invalid min window");
        new AgentEco(address(token), arbiter, 0, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 1, 0, address(0xFEE));
    }

    function test_constructor_rejectsAcceptTimeoutBelowMinWindow() public {
        vm.expectRevert("Invalid accept timeout");
        new AgentEco(address(token), arbiter, MIN_WINDOW, MIN_WINDOW - 1, DISPUTE_TIMEOUT, 1, 0, address(0xFEE));
    }

    function test_constructor_rejectsDisputeTimeoutBelowMinWindow() public {
        vm.expectRevert("Invalid dispute timeout");
        new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, MIN_WINDOW - 1, 1, 0, address(0xFEE));
    }

    function test_constructor_rejectsTimeoutsAboveMaxWindow() public {
        vm.expectRevert("Invalid accept timeout");
        new AgentEco(address(token), arbiter, MIN_WINDOW, 90 days + 1, DISPUTE_TIMEOUT, 1, 0, address(0xFEE));
        vm.expectRevert("Invalid dispute timeout");
        new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, 90 days + 1, 1, 0, address(0xFEE));
    }

    // ------------------------------------------------------------------
    // createEscrow
    // ------------------------------------------------------------------

    function test_createEscrow_storesTaskHashAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit EscrowCreated(1, buyer, seller, amount, TASK);
        uint256 id = _create();

        assertEq(id, 1);
        assertEq(eco.nextEscrowId(), 2);
        assertEq(_status(id), CREATED);
        (bytes32 taskHash,,,,) = eco.getEscrowHashes(id);
        assertEq(taskHash, TASK);
        (uint256 execWindow, uint256 reviewWindow,,) = eco.getEscrowWindows(id);
        assertEq(execWindow, EXEC_WINDOW);
        assertEq(reviewWindow, REVIEW_WINDOW);
    }

    function test_createEscrow_rejectsSellerIsBuyer() public {
        vm.prank(buyer);
        vm.expectRevert("Buyer cannot be seller");
        eco.createEscrow(buyer, amount, EXEC_WINDOW, REVIEW_WINDOW, TASK);
    }

    function test_createEscrow_rejectsZeroSeller() public {
        vm.prank(buyer);
        vm.expectRevert("Invalid seller");
        eco.createEscrow(address(0), amount, EXEC_WINDOW, REVIEW_WINDOW, TASK);
    }

    function test_createEscrow_rejectsZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert("Amount must be greater than zero");
        eco.createEscrow(seller, 0, EXEC_WINDOW, REVIEW_WINDOW, TASK);
    }

    function test_createEscrow_rejectsWindowsOutsideBounds() public {
        vm.startPrank(buyer);
        vm.expectRevert("Invalid execution window");
        eco.createEscrow(seller, amount, MIN_WINDOW - 1, REVIEW_WINDOW, TASK);
        vm.expectRevert("Invalid execution window");
        eco.createEscrow(seller, amount, 90 days + 1, REVIEW_WINDOW, TASK);
        vm.expectRevert("Invalid review window");
        eco.createEscrow(seller, amount, EXEC_WINDOW, MIN_WINDOW - 1, TASK);
        vm.expectRevert("Invalid review window");
        eco.createEscrow(seller, amount, EXEC_WINDOW, 90 days + 1, TASK);
        vm.stopPrank();
    }

    function test_createEscrow_rejectsZeroTaskHash() public {
        vm.prank(buyer);
        vm.expectRevert("Task hash required");
        eco.createEscrow(seller, amount, EXEC_WINDOW, REVIEW_WINDOW, bytes32(0));
    }

    // ------------------------------------------------------------------
    // fundEscrow
    // ------------------------------------------------------------------

    function test_fundEscrow_pullsTokensAndSetsAcceptDeadline() public {
        uint256 id = _create();
        uint256 before = token.balanceOf(buyer);

        vm.prank(buyer);
        eco.fundEscrow(id);

        assertEq(_status(id), FUNDED);
        assertEq(token.balanceOf(address(eco)), amount);
        assertEq(token.balanceOf(buyer), before - amount);
        (,, uint256 acceptDeadline,) = eco.getEscrowDisputeInfo(id);
        assertEq(acceptDeadline, block.timestamp + ACCEPT_TIMEOUT);
    }

    function test_fundEscrow_onlyBuyer() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert("Only buyer");
        eco.fundEscrow(id);
    }

    function test_fundEscrow_cannotFundTwice() public {
        uint256 id = _funded();
        vm.prank(buyer);
        vm.expectRevert("Invalid escrow status");
        eco.fundEscrow(id);
    }

    function test_fundEscrow_revertsWithoutBalance() public {
        address poor = makeAddr("poor");
        vm.startPrank(poor);
        token.approve(address(eco), type(uint256).max);
        uint256 id = eco.createEscrow(seller, amount, EXEC_WINDOW, REVIEW_WINDOW, TASK);
        vm.expectRevert("ERC20 transferFrom failed");
        eco.fundEscrow(id);
        vm.stopPrank();
        assertEq(_status(id), CREATED);
    }

    // ------------------------------------------------------------------
    // Accept timeout
    // ------------------------------------------------------------------

    function test_startExecution_allowedUpToAcceptDeadline() public {
        uint256 id = _funded();
        vm.warp(block.timestamp + ACCEPT_TIMEOUT);
        vm.prank(seller);
        eco.startExecution(id);
        assertEq(_status(id), EXECUTING);
    }

    function test_startExecution_failsAfterAcceptDeadline() public {
        uint256 id = _funded();
        vm.warp(block.timestamp + ACCEPT_TIMEOUT + 1);
        vm.prank(seller);
        vm.expectRevert("Accept window has passed");
        eco.startExecution(id);
    }

    function test_claimAcceptTimeout_revertsBeforeDeadline() public {
        uint256 id = _funded();
        vm.warp(block.timestamp + ACCEPT_TIMEOUT);
        vm.expectRevert("Accept window not over");
        eco.claimAcceptTimeout(id);
    }

    function test_claimAcceptTimeout_refundsBuyerWithoutReputationChange() public {
        uint256 id = _funded();
        uint256 before = token.balanceOf(buyer);
        vm.warp(block.timestamp + ACCEPT_TIMEOUT + 1);

        vm.expectEmit(true, true, false, true);
        emit AcceptTimedOut(id, buyer, amount);
        vm.expectEmit(true, true, false, true);
        emit EscrowRefunded(id, buyer, amount);
        vm.prank(stranger);
        eco.claimAcceptTimeout(id);

        assertEq(_status(id), REFUNDED);
        assertEq(token.balanceOf(buyer), before + amount);
        assertEq(token.balanceOf(address(eco)), 0);
        (uint256 completed, uint256 failed,,,) = _rep(seller);
        assertEq(completed, 0);
        assertEq(failed, 0);
    }

    function test_claimAcceptTimeout_onlyForFundedEscrows() public {
        uint256 id = _executing();
        vm.warp(block.timestamp + ACCEPT_TIMEOUT + 1);
        vm.expectRevert("Escrow not funded");
        eco.claimAcceptTimeout(id);
    }

    // ------------------------------------------------------------------
    // Existing paths
    // ------------------------------------------------------------------

    function test_refundEscrow_whileFunded() public {
        uint256 id = _funded();
        uint256 before = token.balanceOf(buyer);
        vm.prank(buyer);
        eco.refundEscrow(id);
        assertEq(_status(id), REFUNDED);
        assertEq(token.balanceOf(buyer), before + amount);
    }

    function test_refundEscrow_notAfterExecutionStarts() public {
        uint256 id = _executing();
        vm.prank(buyer);
        vm.expectRevert("Refund unavailable");
        eco.refundEscrow(id);
    }

    function test_claimExecutionTimeout_refundsAndCountsFailure() public {
        uint256 id = _executing();
        uint256 before = token.balanceOf(buyer);

        vm.expectRevert("Execution window not over");
        eco.claimExecutionTimeout(id);

        vm.warp(block.timestamp + EXEC_WINDOW + 1);
        eco.claimExecutionTimeout(id);

        assertEq(_status(id), REFUNDED);
        assertEq(token.balanceOf(buyer), before + amount);
        (, uint256 failed,,,) = _rep(seller);
        assertEq(failed, 1);
    }

    function test_markDelivered_onlySeller() public {
        uint256 id = _executing();
        vm.prank(buyer);
        vm.expectRevert("Only seller");
        eco.markDelivered(id, RESULT);
    }

    function test_acceptAndSettle_paysSellerAndRecordsSuccess() public {
        uint256 id = _delivered();
        vm.prank(buyer);
        eco.acceptAndSettle(id);

        assertEq(_status(id), SETTLED);
        assertEq(token.balanceOf(seller), amount);
        (uint256 completed, uint256 failed, uint256 volume,,) = _rep(seller);
        assertEq(completed, 1);
        assertEq(failed, 0);
        assertEq(volume, amount);
    }

    function test_acceptAndSettle_onlyBuyer() public {
        uint256 id = _delivered();
        vm.prank(seller);
        vm.expectRevert("Only buyer");
        eco.acceptAndSettle(id);
    }

    function test_finalizeAfterReviewWindow() public {
        uint256 id = _delivered();

        vm.expectRevert("Review window still open");
        eco.finalizeAfterReviewWindow(id);

        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.prank(stranger);
        eco.finalizeAfterReviewWindow(id);

        assertEq(_status(id), SETTLED);
        assertEq(token.balanceOf(seller), amount);
        (uint256 completed,,,,) = _rep(seller);
        assertEq(completed, 1);
    }

    // ------------------------------------------------------------------
    // Disputes
    // ------------------------------------------------------------------

    function test_raiseDispute_rejectsZeroReasonHash() public {
        uint256 id = _delivered();
        vm.prank(buyer);
        vm.expectRevert("Reason hash required");
        eco.raiseDispute(id, bytes32(0));
    }

    function test_raiseDispute_storesReasonAndDeadline() public {
        uint256 id = _delivered();

        vm.expectEmit(true, true, false, true);
        emit DisputeRaised(id, buyer, REASON);
        vm.prank(buyer);
        eco.raiseDispute(id, REASON);

        assertEq(_status(id), DISPUTED);
        (,, bytes32 reasonHash,,) = eco.getEscrowHashes(id);
        assertEq(reasonHash, REASON);
        (uint256 disputedAt, uint256 disputeDeadline,,) = eco.getEscrowDisputeInfo(id);
        assertEq(disputedAt, block.timestamp);
        assertEq(disputeDeadline, block.timestamp + DISPUTE_TIMEOUT);
    }

    function test_raiseDispute_notAfterReviewWindow() public {
        uint256 id = _delivered();
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.prank(buyer);
        vm.expectRevert("Review window has passed");
        eco.raiseDispute(id, REASON);
    }

    function test_submitDisputeResponse_onlySeller() public {
        uint256 id = _disputed();
        vm.prank(buyer);
        vm.expectRevert("Only seller");
        eco.submitDisputeResponse(id, RESPONSE);
    }

    function test_submitDisputeResponse_storedOnce() public {
        uint256 id = _disputed();

        vm.expectEmit(true, true, false, true);
        emit DisputeResponseSubmitted(id, seller, RESPONSE);
        vm.prank(seller);
        eco.submitDisputeResponse(id, RESPONSE);

        (,,, bytes32 responseHash,) = eco.getEscrowHashes(id);
        assertEq(responseHash, RESPONSE);

        vm.prank(seller);
        vm.expectRevert("Response already submitted");
        eco.submitDisputeResponse(id, keccak256("second"));
    }

    function test_submitDisputeResponse_rejectsZeroHashAndLateResponse() public {
        uint256 id = _disputed();

        vm.prank(seller);
        vm.expectRevert("Response hash required");
        eco.submitDisputeResponse(id, bytes32(0));

        vm.warp(block.timestamp + DISPUTE_TIMEOUT + 1);
        vm.prank(seller);
        vm.expectRevert("Dispute window has passed");
        eco.submitDisputeResponse(id, RESPONSE);
    }

    function test_resolve_onlyArbiter() public {
        uint256 id = _disputed();
        vm.prank(buyer);
        vm.expectRevert("Only arbiter");
        eco.resolveDisputeForBuyer(id, RATIONALE);
        vm.prank(seller);
        vm.expectRevert("Only arbiter");
        eco.resolveDisputeForSeller(id, RATIONALE);
    }

    function test_resolveDisputeForSeller_settlesAndStoresRationale() public {
        uint256 id = _disputed();

        vm.expectEmit(true, true, false, true);
        emit DisputeResolved(id, arbiter, true, RATIONALE);
        vm.prank(arbiter);
        eco.resolveDisputeForSeller(id, RATIONALE);

        assertEq(_status(id), SETTLED);
        assertEq(token.balanceOf(seller), amount);
        (,,,, bytes32 resolutionHash) = eco.getEscrowHashes(id);
        assertEq(resolutionHash, RATIONALE);
        (uint256 completed, uint256 failed,,,) = _rep(seller);
        assertEq(completed, 1);
        assertEq(failed, 0);
    }

    function test_resolveDisputeForBuyer_refundsAndCountsFailure() public {
        uint256 id = _disputed();
        uint256 before = token.balanceOf(buyer);

        vm.expectEmit(true, true, false, true);
        emit DisputeResolved(id, arbiter, false, RATIONALE);
        vm.prank(arbiter);
        eco.resolveDisputeForBuyer(id, RATIONALE);

        assertEq(_status(id), REFUNDED);
        assertEq(token.balanceOf(buyer), before + amount);
        (,,,, bytes32 resolutionHash) = eco.getEscrowHashes(id);
        assertEq(resolutionHash, RATIONALE);
        (uint256 completed, uint256 failed,,,) = _rep(seller);
        assertEq(completed, 0);
        assertEq(failed, 1);
    }

    function test_resolve_rejectsZeroRationale() public {
        uint256 id = _disputed();
        vm.prank(arbiter);
        vm.expectRevert("Rationale hash required");
        eco.resolveDisputeForSeller(id, bytes32(0));
    }

    function test_resolve_notAfterDisputeDeadline() public {
        uint256 id = _disputed();
        vm.warp(block.timestamp + DISPUTE_TIMEOUT + 1);
        vm.startPrank(arbiter);
        vm.expectRevert("Dispute window has passed");
        eco.resolveDisputeForSeller(id, RATIONALE);
        vm.expectRevert("Dispute window has passed");
        eco.resolveDisputeForBuyer(id, RATIONALE);
        vm.stopPrank();
    }

    function test_claimDisputeTimeout_revertsBeforeDeadline() public {
        uint256 id = _disputed();
        vm.warp(block.timestamp + DISPUTE_TIMEOUT);
        vm.expectRevert("Dispute window not over");
        eco.claimDisputeTimeout(id);
    }

    function test_claimDisputeTimeout_refundsWithoutReputationChange() public {
        uint256 id = _disputed();
        uint256 before = token.balanceOf(buyer);
        vm.warp(block.timestamp + DISPUTE_TIMEOUT + 1);

        vm.expectEmit(true, true, false, true);
        emit DisputeTimedOut(id, buyer, amount);
        vm.expectEmit(true, true, false, true);
        emit EscrowRefunded(id, buyer, amount);
        vm.prank(stranger);
        eco.claimDisputeTimeout(id);

        assertEq(_status(id), REFUNDED);
        assertEq(token.balanceOf(buyer), before + amount);
        (uint256 completed, uint256 failed,,,) = _rep(seller);
        assertEq(completed, 0);
        assertEq(failed, 0);
    }

    // ------------------------------------------------------------------
    // Rating
    // ------------------------------------------------------------------

    function test_rateSeller_onlyBuyer() public {
        uint256 id = _delivered();
        vm.prank(buyer);
        eco.acceptAndSettle(id);
        vm.prank(seller);
        vm.expectRevert("Only buyer");
        eco.rateSeller(id, 80);
    }

    function test_rateSeller_rejectsOutOfRangeScores() public {
        uint256 id = _delivered();
        vm.startPrank(buyer);
        eco.acceptAndSettle(id);
        vm.expectRevert("Score must be 1-100");
        eco.rateSeller(id, 0);
        vm.expectRevert("Score must be 1-100");
        eco.rateSeller(id, 101);
        vm.stopPrank();
    }

    function test_rateSeller_onlyAfterFinal() public {
        uint256 id = _delivered();
        vm.prank(buyer);
        vm.expectRevert("Escrow not final");
        eco.rateSeller(id, 80);
    }

    function test_rateSeller_rejectedWhenNothingDelivered() public {
        uint256 id = _funded();
        vm.prank(buyer);
        eco.refundEscrow(id);
        vm.prank(buyer);
        vm.expectRevert("Nothing was delivered");
        eco.rateSeller(id, 80);
    }

    function test_rateSeller_onceAndSums() public {
        uint256 first = _delivered();
        vm.prank(buyer);
        eco.acceptAndSettle(first);

        vm.expectEmit(true, true, true, true);
        emit SellerRated(first, seller, buyer, 80);
        vm.prank(buyer);
        eco.rateSeller(first, 80);

        (,,, bool rated) = eco.getEscrowDisputeInfo(first);
        assertTrue(rated);

        vm.prank(buyer);
        vm.expectRevert("Already rated");
        eco.rateSeller(first, 90);

        // A dispute lost by the seller can still be rated: a result was delivered.
        uint256 second = _disputed();
        vm.prank(arbiter);
        eco.resolveDisputeForBuyer(second, RATIONALE);
        vm.prank(buyer);
        eco.rateSeller(second, 20);

        (,,, uint256 ratingSum, uint256 ratingCount) = _rep(seller);
        assertEq(ratingSum, 100);
        assertEq(ratingCount, 2);
    }

    // ------------------------------------------------------------------
    // Finality, roles, views
    // ------------------------------------------------------------------

    function test_cannotSettleOrRefundTwice() public {
        uint256 id = _delivered();
        vm.prank(buyer);
        eco.acceptAndSettle(id);

        vm.prank(buyer);
        vm.expectRevert("Result not delivered");
        eco.acceptAndSettle(id);
        vm.expectRevert("Result not delivered");
        eco.finalizeAfterReviewWindow(id);
        vm.prank(buyer);
        vm.expectRevert("Refund unavailable");
        eco.refundEscrow(id);
        vm.expectRevert("No active dispute");
        eco.claimDisputeTimeout(id);

        uint256 refunded = _funded();
        vm.prank(buyer);
        eco.refundEscrow(refunded);
        vm.prank(buyer);
        vm.expectRevert("Refund unavailable");
        eco.refundEscrow(refunded);
        vm.warp(block.timestamp + ACCEPT_TIMEOUT + 1);
        vm.expectRevert("Escrow not funded");
        eco.claimAcceptTimeout(refunded);
    }

    function test_wrongRolesRevert() public {
        uint256 id = _funded();
        vm.prank(buyer);
        vm.expectRevert("Only seller");
        eco.startExecution(id);
        vm.prank(stranger);
        vm.expectRevert("Only buyer");
        eco.refundEscrow(id);
        vm.prank(stranger);
        vm.expectRevert("Only arbiter");
        eco.transferArbiter(stranger);
    }

    function test_unknownEscrowReverts() public {
        vm.expectRevert("Escrow does not exist");
        eco.getEscrowBasic(99);
        vm.expectRevert("Escrow does not exist");
        eco.claimAcceptTimeout(99);
    }

    function test_timeoutViews() public {
        uint256 funded = _funded();
        assertFalse(eco.isAcceptTimedOut(funded));

        uint256 disputed = _disputed();
        assertFalse(eco.isDisputeTimedOut(disputed));

        vm.warp(block.timestamp + DISPUTE_TIMEOUT + 1);
        assertTrue(eco.isAcceptTimedOut(funded));
        assertTrue(eco.isDisputeTimedOut(disputed));
    }

    // ------------------------------------------------------------------
    // Two-step arbiter handover
    // ------------------------------------------------------------------

    event ArbiterTransferStarted(address indexed currentArbiter, address indexed pendingArbiter);
    event ArbiterUpdated(address indexed previousArbiter, address indexed newArbiter);

    function test_arbiterHandover_twoSteps() public {
        address next = makeAddr("next");
        vm.expectEmit(true, true, false, false);
        emit ArbiterTransferStarted(arbiter, next);
        vm.prank(arbiter);
        eco.transferArbiter(next);
        // Nothing changes until the new arbiter accepts.
        assertEq(eco.arbiter(), arbiter);
        assertEq(eco.pendingArbiter(), next);

        vm.expectEmit(true, true, false, false);
        emit ArbiterUpdated(arbiter, next);
        vm.prank(next);
        eco.acceptArbiter();
        assertEq(eco.arbiter(), next);
        assertEq(eco.pendingArbiter(), address(0));

        // The old arbiter has lost the role.
        uint256 id = _disputed();
        vm.prank(arbiter);
        vm.expectRevert("Only arbiter");
        eco.resolveDisputeForSeller(id, RATIONALE);
        vm.prank(next);
        eco.resolveDisputeForSeller(id, RATIONALE);
        assertEq(_status(id), SETTLED);
    }

    function test_arbiterHandover_onlyPendingCanAccept() public {
        vm.prank(stranger);
        vm.expectRevert("Only pending arbiter");
        eco.acceptArbiter(); // nobody pending

        address next = makeAddr("next");
        vm.prank(arbiter);
        eco.transferArbiter(next);
        vm.prank(stranger);
        vm.expectRevert("Only pending arbiter");
        eco.acceptArbiter();
    }

    function test_arbiterHandover_canBeCancelledOrRedirected() public {
        address typo = makeAddr("typo");
        address next = makeAddr("next");
        vm.startPrank(arbiter);
        eco.transferArbiter(typo);
        eco.transferArbiter(next); // corrected before anyone accepted
        vm.stopPrank();
        vm.prank(typo);
        vm.expectRevert("Only pending arbiter");
        eco.acceptArbiter();

        vm.prank(arbiter);
        eco.transferArbiter(address(0)); // cancel
        vm.prank(next);
        vm.expectRevert("Only pending arbiter");
        eco.acceptArbiter();
        assertEq(eco.arbiter(), arbiter);
    }

    // ------------------------------------------------------------------
    // firstEscrowId: continuing an older deployment's numbering
    // ------------------------------------------------------------------

    function test_firstEscrowId_continuesNumbering() public {
        AgentEco v2 = new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 1000, 0, address(0xFEE));
        assertEq(v2.firstEscrowId(), 1000);
        assertEq(v2.nextEscrowId(), 1000);
        vm.prank(buyer);
        uint256 id = v2.createEscrow(seller, amount, EXEC_WINDOW, REVIEW_WINDOW, TASK);
        assertEq(id, 1000);
        assertEq(v2.nextEscrowId(), 1001);
        vm.expectRevert("Escrow does not exist");
        v2.getEscrowBasic(999);
    }

    function test_constructor_rejectsZeroFirstEscrowId() public {
        vm.expectRevert("Invalid first escrow id");
        new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 0, 0, address(0xFEE));
    }

    function test_version() public view {
        assertEq(eco.VERSION(), "3");
        assertEq(eco.firstEscrowId(), 1);
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    function testFuzz_fullSettleConservesTokens(uint256 amt, uint256 execWindow, uint256 reviewWindow) public {
        amt = bound(amt, 1, 1_000e18);
        execWindow = bound(execWindow, MIN_WINDOW, 90 days);
        reviewWindow = bound(reviewWindow, MIN_WINDOW, 90 days);
        uint256 buyerBefore = token.balanceOf(buyer);

        vm.prank(buyer);
        uint256 id = eco.createEscrow(seller, amt, execWindow, reviewWindow, TASK);
        vm.prank(buyer);
        eco.fundEscrow(id);
        vm.prank(seller);
        eco.startExecution(id);
        vm.prank(seller);
        eco.markDelivered(id, RESULT);
        vm.warp(block.timestamp + reviewWindow + 1);
        eco.finalizeAfterReviewWindow(id);

        assertEq(token.balanceOf(buyer), buyerBefore - amt);
        assertEq(token.balanceOf(seller), amt);
        assertEq(token.balanceOf(address(eco)), 0);
    }

    function testFuzz_windowsOutsideBoundsRevert(uint256 execWindow) public {
        vm.assume(execWindow < MIN_WINDOW || execWindow > 90 days);
        vm.prank(buyer);
        vm.expectRevert("Invalid execution window");
        eco.createEscrow(seller, amount, execWindow, REVIEW_WINDOW, TASK);
    }
}

/// The same lifecycle against a 6-decimal token (the original BOT Chain USDT).
contract AgentEcoSixDecimalsTest is AgentEcoBase {
    function setUp() public {
        _deploy(6);
    }

    function test_settleWithSixDecimals() public {
        assertEq(amount, 250_000);
        uint256 id = _delivered();
        vm.prank(buyer);
        eco.acceptAndSettle(id);
        assertEq(token.balanceOf(seller), 250_000);
        (,, uint256 volume,,) = _rep(seller);
        assertEq(volume, 250_000);
    }

    function test_disputeTimeoutWithSixDecimals() public {
        uint256 id = _disputed();
        uint256 before = token.balanceOf(buyer);
        vm.warp(block.timestamp + DISPUTE_TIMEOUT + 1);
        eco.claimDisputeTimeout(id);
        assertEq(token.balanceOf(buyer), before + 250_000);
    }
}
