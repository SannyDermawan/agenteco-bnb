// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentEco
 * @notice Escrow + settlement + reputation infrastructure for AgentEco MVP.
 *
 * Core flow:
 *
 * CREATED                                    (createEscrow commits taskHash)
 *    ↓ fundEscrow (buyer)                    [starts acceptTimeout]
 * FUNDED
 *    ↓ startExecution (seller, before acceptDeadline) [starts executionWindow]
 *    ↓ or refundEscrow (buyer)               → REFUNDED
 *    ↓ or claimAcceptTimeout (anyone, after acceptDeadline) → REFUNDED
 * EXECUTING
 *    ↓ markDelivered (seller)                [starts reviewWindow]
 *    ↓ or claimExecutionTimeout (anyone, after executionDeadline) → REFUNDED
 * DELIVERED
 *    ↓ acceptAndSettle (buyer)               → SETTLED
 *    ↓ or raiseDispute (buyer, within reviewWindow) → DISPUTED [starts disputeTimeout]
 *    ↓ or finalizeAfterReviewWindow (anyone, after reviewDeadline) → SETTLED
 * DISPUTED
 *    ↓ submitDisputeResponse (seller, once, before disputeDeadline)
 *    ↓ resolveDisputeForSeller (arbiter, before disputeDeadline) → SETTLED
 *    ↓ resolveDisputeForBuyer (arbiter, before disputeDeadline)  → REFUNDED
 *    ↓ or claimDisputeTimeout (anyone, after disputeDeadline)     → REFUNDED
 * SETTLED / REFUNDED (final)
 *    ↓ rateSeller (buyer, once, only if a result was ever delivered)
 *
 * Every non-final status has an exit that needs nobody's cooperation, so
 * no escrow can get stuck.
 *
 * Discovery, negotiation, agent metadata, and task execution remain
 * off-chain. Long texts (task brief, dispute reason, seller response,
 * arbiter rationale) live off-chain too; only their keccak256 hashes are
 * committed here, so anyone can check the API's text against the chain.
 *
 * This contract handles the economic state:
 * - escrow funding, delivery confirmation, settlement
 * - refund before execution, accept timeout, execution timeout
 * - post-delivery review window + dispute resolution with a deadline
 * - on-chain reputation (completed / failed jobs, volume, ratings)
 *
 * Compiled with the optimizer (runs = 200) and viaIR off. The escrow
 * struct is read through several small getters to stay clear of the
 * legacy pipeline's "stack too deep" limit.
 */
contract AgentEco {

    // =============================================================
    // CONFIGURATION
    // =============================================================

    /**
     * USDT token address for this deployment. Set once at deploy time
     * so the same contract source can be used across testnet/mainnet
     * without editing code.
     */
    address public immutable USDT;

    /**
     * Address allowed to resolve disputes. A single trusted arbiter is
     * a deliberate MVP simplification — swap for a multisig or a
     * decentralized arbitration system before relying on this in
     * production with real value at stake.
     */
    address public arbiter;

    uint256 public constant MAX_WINDOW = 90 days;

    /**
     * Shortest execution / review window createEscrow accepts. Set at
     * deploy time: short for a demo deployment (minutes), an hour or more
     * in production.
     */
    uint256 public immutable minWindow;

    /// Seconds the seller has, after funding, to call startExecution.
    uint256 public immutable acceptTimeout;

    /// Seconds the arbiter has, after a dispute is raised, to resolve it.
    uint256 public immutable disputeTimeout;

    // =============================================================
    // ENUMS
    // =============================================================

    enum OrderStatus {
        CREATED,
        FUNDED,
        EXECUTING,
        DELIVERED,
        DISPUTED,
        SETTLED,
        REFUNDED
    }

    // =============================================================
    // STRUCTS
    // =============================================================

    struct Escrow {
        uint256 id;

        address buyer;
        address seller;

        uint256 amount;

        OrderStatus status;

        uint256 createdAt;
        uint256 fundedAt;
        uint256 executingAt;
        uint256 deliveredAt;
        uint256 settledAt;

        /**
         * Seconds the seller has to deliver after startExecution().
         * Negotiated off-chain, supplied by the buyer at creation.
         */
        uint256 executionWindow;

        /**
         * Seconds the buyer has to accept or dispute after markDelivered().
         */
        uint256 reviewWindow;

        /// executingAt + executionWindow (0 until execution starts)
        uint256 executionDeadline;

        /// deliveredAt + reviewWindow (0 until delivered)
        uint256 reviewDeadline;

        /**
         * Optional hash of the off-chain result.
         *
         * Example:
         * keccak256(result JSON)
         *
         * The actual result can remain off-chain.
         */
        bytes32 resultHash;

        /// keccak256 of the task preimage (brief + criteria + price + parties + nonce).
        bytes32 taskHash;

        /// fundedAt + acceptTimeout (0 until funded)
        uint256 acceptDeadline;

        /// When the buyer raised a dispute (0 if never disputed)
        uint256 disputedAt;

        /// disputedAt + disputeTimeout (0 if never disputed)
        uint256 disputeDeadline;

        /// keccak256 of the buyer's dispute reason text
        bytes32 disputeReasonHash;

        /// keccak256 of the seller's response text (0 = no response yet)
        bytes32 disputeResponseHash;

        /// keccak256 of the arbiter's rationale object
        bytes32 resolutionHash;

        /// Whether the buyer has already rated the seller for this escrow
        bool rated;
    }

    struct Reputation {
        uint256 completedJobs;
        uint256 failedJobs;
        uint256 totalVolumeSettled;
        /// Sum of buyer rating scores, each 1..100
        uint256 ratingSum;
        uint256 ratingCount;
    }

    // =============================================================
    // STATE
    // =============================================================

    uint256 public nextEscrowId = 1;

    /**
     * Private: no auto-generated single-struct getter (that was the
     * "stack too deep" source). Read escrow data through the
     * getEscrowBasic / getEscrowTimestamps / getEscrowWindows /
     * getResultHash / getEscrowStatus view functions below instead.
     */
    mapping(uint256 => Escrow) private escrows;

    mapping(address => Reputation) public reputations;

    // =============================================================
    // EVENTS
    // =============================================================

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        bytes32 taskHash
    );

    event EscrowFunded(
        uint256 indexed escrowId,
        address indexed buyer,
        uint256 amount
    );

    event ExecutionStarted(
        uint256 indexed escrowId,
        address indexed seller
    );

    event ResultDelivered(
        uint256 indexed escrowId,
        address indexed seller,
        bytes32 resultHash
    );

    event EscrowSettled(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );

    event EscrowRefunded(
        uint256 indexed escrowId,
        address indexed buyer,
        uint256 amount
    );

    event ExecutionTimedOut(
        uint256 indexed escrowId,
        address indexed buyer,
        uint256 amount
    );

    event DisputeRaised(
        uint256 indexed escrowId,
        address indexed buyer,
        bytes32 reasonHash
    );

    event DisputeResolved(
        uint256 indexed escrowId,
        address indexed arbiter,
        bool releasedToSeller,
        bytes32 rationaleHash
    );

    event DisputeResponseSubmitted(
        uint256 indexed escrowId,
        address indexed seller,
        bytes32 responseHash
    );

    event AcceptTimedOut(
        uint256 indexed escrowId,
        address indexed buyer,
        uint256 amount
    );

    event DisputeTimedOut(
        uint256 indexed escrowId,
        address indexed buyer,
        uint256 amount
    );

    event SellerRated(
        uint256 indexed escrowId,
        address indexed seller,
        address indexed buyer,
        uint8 score
    );

    event ReviewFinalized(
        uint256 indexed escrowId
    );

    event ArbiterUpdated(
        address indexed previousArbiter,
        address indexed newArbiter
    );

    // =============================================================
    // MODIFIERS
    // =============================================================

    modifier escrowExists(uint256 escrowId) {
        require(
            escrows[escrowId].buyer != address(0),
            "Escrow does not exist"
        );
        _;
    }

    modifier onlyBuyer(uint256 escrowId) {
        require(
            msg.sender == escrows[escrowId].buyer,
            "Only buyer"
        );
        _;
    }

    modifier onlySeller(uint256 escrowId) {
        require(
            msg.sender == escrows[escrowId].seller,
            "Only seller"
        );
        _;
    }

    modifier onlyArbiter() {
        require(
            msg.sender == arbiter,
            "Only arbiter"
        );
        _;
    }

    // =============================================================
    // CONSTRUCTOR
    // =============================================================

    constructor(
        address usdtToken,
        address arbiter_,
        uint256 minWindow_,
        uint256 acceptTimeout_,
        uint256 disputeTimeout_
    ) {
        require(usdtToken != address(0), "Invalid USDT address");
        require(arbiter_ != address(0), "Invalid arbiter");
        require(minWindow_ > 0 && minWindow_ <= MAX_WINDOW, "Invalid min window");
        require(
            acceptTimeout_ >= minWindow_ && acceptTimeout_ <= MAX_WINDOW,
            "Invalid accept timeout"
        );
        require(
            disputeTimeout_ >= minWindow_ && disputeTimeout_ <= MAX_WINDOW,
            "Invalid dispute timeout"
        );

        USDT = usdtToken;
        arbiter = arbiter_;
        minWindow = minWindow_;
        acceptTimeout = acceptTimeout_;
        disputeTimeout = disputeTimeout_;
    }

    // =============================================================
    // ARBITER MANAGEMENT
    // =============================================================

    /**
     * @notice Transfer the arbiter role to a new address.
     */
    function setArbiter(address newArbiter) external onlyArbiter {
        require(newArbiter != address(0), "Invalid arbiter");

        address previous = arbiter;
        arbiter = newArbiter;

        emit ArbiterUpdated(previous, newArbiter);
    }

    // =============================================================
    // CREATE ESCROW
    // =============================================================

    /**
     * @notice Create a new service escrow.
     *
     * This does NOT move USDT yet.
     *
     * Buyer:
     * Agent D
     *
     * Seller:
     * Agent C
     *
     * Amount:
     * agreed price in USDT base units.
     *
     * Example:
     * 0.18 USDT with 18 decimals = 180000000000000000
     *
     * executionWindow / reviewWindow:
     * negotiated off-chain "delivery conditions", in seconds.
     * Bounded to [minWindow, MAX_WINDOW] to avoid degenerate values.
     *
     * taskHash:
     * keccak256 of the task preimage stored off-chain (brief, criteria,
     * price, parties, nonce). Required, so every job's terms are pinned.
     */
    function createEscrow(
        address seller,
        uint256 amount,
        uint256 executionWindow,
        uint256 reviewWindow,
        bytes32 taskHash
    )
        external
        returns (uint256)
    {
        require(
            seller != address(0),
            "Invalid seller"
        );

        require(
            seller != msg.sender,
            "Buyer cannot be seller"
        );

        require(
            amount > 0,
            "Amount must be greater than zero"
        );

        require(
            executionWindow >= minWindow && executionWindow <= MAX_WINDOW,
            "Invalid execution window"
        );

        require(
            reviewWindow >= minWindow && reviewWindow <= MAX_WINDOW,
            "Invalid review window"
        );

        require(
            taskHash != bytes32(0),
            "Task hash required"
        );

        uint256 escrowId = nextEscrowId;

        nextEscrowId++;

        Escrow storage escrow = escrows[escrowId];
        escrow.id = escrowId;
        escrow.buyer = msg.sender;
        escrow.seller = seller;
        escrow.amount = amount;
        escrow.status = OrderStatus.CREATED;
        escrow.createdAt = block.timestamp;
        escrow.executionWindow = executionWindow;
        escrow.reviewWindow = reviewWindow;
        escrow.taskHash = taskHash;

        emit EscrowCreated(
            escrowId,
            msg.sender,
            seller,
            amount,
            taskHash
        );

        return escrowId;
    }

    // =============================================================
    // FUND ESCROW
    // =============================================================

    /**
     * @notice Lock buyer's USDT inside the AgentEco contract.
     *
     * Before calling this function, the buyer must approve
     * this contract to spend the required USDT amount.
     *
     * USDT.approve(
     *     AgentEcoAddress,
     *     amount
     * )
     */
    function fundEscrow(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
        onlyBuyer(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.CREATED,
            "Invalid escrow status"
        );

        escrow.status = OrderStatus.FUNDED;
        escrow.fundedAt = block.timestamp;
        escrow.acceptDeadline = block.timestamp + acceptTimeout;

        _safeTransferFrom(
            USDT,
            msg.sender,
            address(this),
            escrow.amount
        );

        emit EscrowFunded(
            escrowId,
            msg.sender,
            escrow.amount
        );
    }

    // =============================================================
    // START EXECUTION
    // =============================================================

    /**
     * @notice Seller starts executing the task.
     *
     * FUNDED → EXECUTING, and starts the execution timeout clock.
     * Must happen before acceptDeadline; after that the buyer is owed a
     * refund through claimAcceptTimeout.
     */
    function startExecution(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
        onlySeller(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.FUNDED,
            "Escrow not funded"
        );

        require(
            block.timestamp <= escrow.acceptDeadline,
            "Accept window has passed"
        );

        escrow.status = OrderStatus.EXECUTING;
        escrow.executingAt = block.timestamp;
        escrow.executionDeadline = block.timestamp + escrow.executionWindow;

        emit ExecutionStarted(
            escrowId,
            msg.sender
        );
    }

    // =============================================================
    // ACCEPT TIMEOUT
    // =============================================================

    /**
     * @notice Refund the buyer if the seller never started a funded job
     * before acceptDeadline.
     *
     * Callable by anyone (a keeper). The seller never accepted the job,
     * so this does not count against its reputation.
     */
    function claimAcceptTimeout(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.FUNDED,
            "Escrow not funded"
        );

        require(
            block.timestamp > escrow.acceptDeadline,
            "Accept window not over"
        );

        escrow.status = OrderStatus.REFUNDED;

        _safeTransfer(
            USDT,
            escrow.buyer,
            escrow.amount
        );

        emit AcceptTimedOut(
            escrowId,
            escrow.buyer,
            escrow.amount
        );

        emit EscrowRefunded(
            escrowId,
            escrow.buyer,
            escrow.amount
        );
    }

    // =============================================================
    // DELIVER RESULT
    // =============================================================

    /**
     * @notice Seller marks the task as delivered.
     *
     * resultHash is optional. For the MVP, the actual result can
     * remain off-chain.
     *
     * Example:
     * resultHash = keccak256(abi.encodePacked(resultJson))
     *
     * A late delivery (past executionDeadline) is still accepted as
     * long as the buyer has not already claimed the timeout refund —
     * whichever action happens first wins.
     */
    function markDelivered(
        uint256 escrowId,
        bytes32 resultHash
    )
        external
        escrowExists(escrowId)
        onlySeller(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.EXECUTING,
            "Not executing"
        );

        escrow.status = OrderStatus.DELIVERED;
        escrow.deliveredAt = block.timestamp;
        escrow.reviewDeadline = block.timestamp + escrow.reviewWindow;
        escrow.resultHash = resultHash;

        emit ResultDelivered(
            escrowId,
            msg.sender,
            resultHash
        );
    }

    // =============================================================
    // EXECUTION TIMEOUT
    // =============================================================

    /**
     * @notice Refund the buyer if the seller never delivered within
     * the agreed executionWindow.
     *
     * Callable by anyone once the deadline has passed, so it can be
     * triggered automatically (a keeper) instead of relying on the
     * buyer to remember to claim it. Counts as a failed job against
     * the seller's reputation.
     */
    function claimExecutionTimeout(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.EXECUTING,
            "Not executing"
        );

        require(
            block.timestamp > escrow.executionDeadline,
            "Execution window not over"
        );

        escrow.status = OrderStatus.REFUNDED;

        _recordFailure(escrow.seller);

        _safeTransfer(
            USDT,
            escrow.buyer,
            escrow.amount
        );

        emit ExecutionTimedOut(
            escrowId,
            escrow.buyer,
            escrow.amount
        );

        emit EscrowRefunded(
            escrowId,
            escrow.buyer,
            escrow.amount
        );
    }

    // =============================================================
    // ACCEPT + SETTLE
    // =============================================================

    /**
     * @notice Buyer accepts the delivered result.
     *
     * This releases the escrowed USDT to the seller.
     *
     * DELIVERED → SETTLED
     */
    function acceptAndSettle(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
        onlyBuyer(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.DELIVERED,
            "Result not delivered"
        );

        _settle(escrow, escrowId);
    }

    // =============================================================
    // REVIEW WINDOW AUTO-FINALIZE
    // =============================================================

    /**
     * @notice If the buyer neither accepts nor disputes within the
     * reviewWindow, anyone can finalize the escrow and release funds
     * to the seller. Prevents a buyer from withholding payment for
     * delivered work indefinitely.
     */
    function finalizeAfterReviewWindow(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.DELIVERED,
            "Result not delivered"
        );

        require(
            block.timestamp > escrow.reviewDeadline,
            "Review window still open"
        );

        emit ReviewFinalized(escrowId);

        _settle(escrow, escrowId);
    }

    // =============================================================
    // DISPUTES
    // =============================================================

    /**
     * @notice Buyer flags the delivered result as unsatisfactory,
     * within the reviewWindow. Moves the escrow into arbitration and
     * starts the dispute clock. reasonHash = keccak256 of the reason text
     * the buyer submits to the API.
     */
    function raiseDispute(
        uint256 escrowId,
        bytes32 reasonHash
    )
        external
        escrowExists(escrowId)
        onlyBuyer(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.DELIVERED,
            "Result not delivered"
        );

        require(
            block.timestamp <= escrow.reviewDeadline,
            "Review window has passed"
        );

        require(
            reasonHash != bytes32(0),
            "Reason hash required"
        );

        escrow.status = OrderStatus.DISPUTED;
        escrow.disputeReasonHash = reasonHash;
        escrow.disputedAt = block.timestamp;
        escrow.disputeDeadline = block.timestamp + disputeTimeout;

        emit DisputeRaised(escrowId, msg.sender, reasonHash);
    }

    /**
     * @notice Seller answers a dispute, once, before the dispute deadline.
     * responseHash = keccak256 of the response text sent to the API.
     */
    function submitDisputeResponse(
        uint256 escrowId,
        bytes32 responseHash
    )
        external
        escrowExists(escrowId)
        onlySeller(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.DISPUTED,
            "No active dispute"
        );

        require(
            block.timestamp <= escrow.disputeDeadline,
            "Dispute window has passed"
        );

        require(
            escrow.disputeResponseHash == bytes32(0),
            "Response already submitted"
        );

        require(
            responseHash != bytes32(0),
            "Response hash required"
        );

        escrow.disputeResponseHash = responseHash;

        emit DisputeResponseSubmitted(escrowId, msg.sender, responseHash);
    }

    /**
     * @notice Arbiter resolves the dispute in the seller's favor, before
     * the dispute deadline. rationaleHash = keccak256 of the verdict object.
     */
    function resolveDisputeForSeller(
        uint256 escrowId,
        bytes32 rationaleHash
    )
        external
        escrowExists(escrowId)
        onlyArbiter
    {
        Escrow storage escrow = _openDisputeForResolution(escrowId, rationaleHash);

        escrow.resolutionHash = rationaleHash;

        emit DisputeResolved(escrowId, msg.sender, true, rationaleHash);

        _settle(escrow, escrowId);
    }

    /**
     * @notice Arbiter resolves the dispute in the buyer's favor, before
     * the dispute deadline. Counts as a failed job for the seller.
     */
    function resolveDisputeForBuyer(
        uint256 escrowId,
        bytes32 rationaleHash
    )
        external
        escrowExists(escrowId)
        onlyArbiter
    {
        Escrow storage escrow = _openDisputeForResolution(escrowId, rationaleHash);

        escrow.resolutionHash = rationaleHash;
        escrow.status = OrderStatus.REFUNDED;

        _recordFailure(escrow.seller);

        _safeTransfer(
            USDT,
            escrow.buyer,
            escrow.amount
        );

        emit DisputeResolved(escrowId, msg.sender, false, rationaleHash);

        emit EscrowRefunded(
            escrowId,
            escrow.buyer,
            escrow.amount
        );
    }

    /**
     * @notice Refund the buyer when the arbiter did not resolve a dispute
     * before disputeDeadline. Callable by anyone (a keeper). Nobody was
     * found at fault, so reputation does not change.
     */
    function claimDisputeTimeout(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.DISPUTED,
            "No active dispute"
        );

        require(
            block.timestamp > escrow.disputeDeadline,
            "Dispute window not over"
        );

        escrow.status = OrderStatus.REFUNDED;

        _safeTransfer(
            USDT,
            escrow.buyer,
            escrow.amount
        );

        emit DisputeTimedOut(
            escrowId,
            escrow.buyer,
            escrow.amount
        );

        emit EscrowRefunded(
            escrowId,
            escrow.buyer,
            escrow.amount
        );
    }

    /// Shared checks for both resolve functions.
    function _openDisputeForResolution(
        uint256 escrowId,
        bytes32 rationaleHash
    )
        internal
        view
        returns (Escrow storage escrow)
    {
        escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.DISPUTED,
            "No active dispute"
        );

        require(
            block.timestamp <= escrow.disputeDeadline,
            "Dispute window has passed"
        );

        require(
            rationaleHash != bytes32(0),
            "Rationale hash required"
        );
    }

    // =============================================================
    // RATING
    // =============================================================

    /**
     * @notice Buyer rates the seller once per escrow, 1..100, after the
     * escrow is final — but only if a result was ever delivered. Escrows
     * refunded before delivery (manual refund, accept or execution
     * timeout) cannot be rated.
     */
    function rateSeller(
        uint256 escrowId,
        uint8 score
    )
        external
        escrowExists(escrowId)
        onlyBuyer(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            score >= 1 && score <= 100,
            "Score must be 1-100"
        );

        require(
            escrow.status == OrderStatus.SETTLED || escrow.status == OrderStatus.REFUNDED,
            "Escrow not final"
        );

        require(
            escrow.deliveredAt != 0,
            "Nothing was delivered"
        );

        require(
            !escrow.rated,
            "Already rated"
        );

        escrow.rated = true;

        Reputation storage rep = reputations[escrow.seller];
        rep.ratingSum += score;
        rep.ratingCount += 1;

        emit SellerRated(escrowId, escrow.seller, msg.sender, score);
    }

    // =============================================================
    // REFUND (pre-execution)
    // =============================================================

    /**
     * @notice Refund buyer before seller starts execution.
     *
     * IMPORTANT:
     *
     * This unilateral refund is intentionally NOT allowed once
     * execution starts. From EXECUTING onward, the buyer's recourse
     * is claimExecutionTimeout (if the seller stalls) or raiseDispute
     * (if the delivered result is unsatisfactory) — both routed
     * through a deterministic deadline or the arbiter, instead of a
     * unilateral buyer decision.
     */
    function refundEscrow(
        uint256 escrowId
    )
        external
        escrowExists(escrowId)
        onlyBuyer(escrowId)
    {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.status == OrderStatus.FUNDED,
            "Refund unavailable"
        );

        escrow.status = OrderStatus.REFUNDED;

        _safeTransfer(
            USDT,
            escrow.buyer,
            escrow.amount
        );

        emit EscrowRefunded(
            escrowId,
            escrow.buyer,
            escrow.amount
        );
    }

    // =============================================================
    // INTERNAL SETTLEMENT + REPUTATION HELPERS
    // =============================================================

    function _settle(Escrow storage escrow, uint256 escrowId) internal {
        escrow.status = OrderStatus.SETTLED;
        escrow.settledAt = block.timestamp;

        _recordSuccess(escrow.seller, escrow.amount);

        _safeTransfer(
            USDT,
            escrow.seller,
            escrow.amount
        );

        emit EscrowSettled(
            escrowId,
            escrow.buyer,
            escrow.seller,
            escrow.amount
        );
    }

    function _recordSuccess(address seller, uint256 amount) internal {
        Reputation storage rep = reputations[seller];
        rep.completedJobs += 1;
        rep.totalVolumeSettled += amount;
    }

    function _recordFailure(address seller) internal {
        reputations[seller].failedJobs += 1;
    }

    // =============================================================
    // VIEW FUNCTIONS — ESCROW
    // =============================================================

    /**
     * @notice Buyer, seller, amount, and current status of an escrow.
     */
    function getEscrowBasic(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (
            address buyer,
            address seller,
            uint256 amount,
            OrderStatus status
        )
    {
        Escrow storage escrow = escrows[escrowId];
        return (
            escrow.buyer,
            escrow.seller,
            escrow.amount,
            escrow.status
        );
    }

    /**
     * @notice Lifecycle timestamps of an escrow. A field is 0 until
     * that stage has actually happened.
     */
    function getEscrowTimestamps(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (
            uint256 createdAt,
            uint256 fundedAt,
            uint256 executingAt,
            uint256 deliveredAt,
            uint256 settledAt
        )
    {
        Escrow storage escrow = escrows[escrowId];
        return (
            escrow.createdAt,
            escrow.fundedAt,
            escrow.executingAt,
            escrow.deliveredAt,
            escrow.settledAt
        );
    }

    /**
     * @notice Negotiated windows and their computed deadlines.
     * executionDeadline / reviewDeadline are 0 until execution /
     * delivery has actually started.
     */
    function getEscrowWindows(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (
            uint256 executionWindow,
            uint256 reviewWindow,
            uint256 executionDeadline,
            uint256 reviewDeadline
        )
    {
        Escrow storage escrow = escrows[escrowId];
        return (
            escrow.executionWindow,
            escrow.reviewWindow,
            escrow.executionDeadline,
            escrow.reviewDeadline
        );
    }

    /**
     * @notice Hash of the off-chain delivered result, if any.
     */
    function getResultHash(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (bytes32)
    {
        return escrows[escrowId].resultHash;
    }

    /**
     * @notice Get current escrow status.
     */
    function getEscrowStatus(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (OrderStatus)
    {
        return escrows[escrowId].status;
    }

    /**
     * @notice Every hash committed for an escrow. A field is 0 until that
     * stage has happened.
     */
    function getEscrowHashes(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (
            bytes32 taskHash,
            bytes32 resultHash,
            bytes32 disputeReasonHash,
            bytes32 disputeResponseHash,
            bytes32 resolutionHash
        )
    {
        Escrow storage escrow = escrows[escrowId];
        return (
            escrow.taskHash,
            escrow.resultHash,
            escrow.disputeReasonHash,
            escrow.disputeResponseHash,
            escrow.resolutionHash
        );
    }

    /**
     * @notice Accept deadline, dispute timing, and whether the buyer has
     * rated the seller.
     */
    function getEscrowDisputeInfo(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (
            uint256 disputedAt,
            uint256 disputeDeadline,
            uint256 acceptDeadline,
            bool rated
        )
    {
        Escrow storage escrow = escrows[escrowId];
        return (
            escrow.disputedAt,
            escrow.disputeDeadline,
            escrow.acceptDeadline,
            escrow.rated
        );
    }

    /**
     * @notice Whether a FUNDED escrow has passed its accept deadline and
     * is eligible for claimAcceptTimeout.
     */
    function isAcceptTimedOut(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (bool)
    {
        Escrow storage escrow = escrows[escrowId];
        return escrow.status == OrderStatus.FUNDED
            && block.timestamp > escrow.acceptDeadline;
    }

    /**
     * @notice Whether a DISPUTED escrow has passed its dispute deadline
     * and is eligible for claimDisputeTimeout.
     */
    function isDisputeTimedOut(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (bool)
    {
        Escrow storage escrow = escrows[escrowId];
        return escrow.status == OrderStatus.DISPUTED
            && block.timestamp > escrow.disputeDeadline;
    }

    /**
     * @notice Whether an EXECUTING escrow has passed its execution
     * deadline and is eligible for claimExecutionTimeout.
     */
    function isExecutionTimedOut(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (bool)
    {
        Escrow storage escrow = escrows[escrowId];
        return escrow.status == OrderStatus.EXECUTING
            && block.timestamp > escrow.executionDeadline;
    }

    /**
     * @notice Whether a DELIVERED escrow has passed its review
     * deadline and is eligible for finalizeAfterReviewWindow.
     */
    function isReviewExpired(
        uint256 escrowId
    )
        external
        view
        escrowExists(escrowId)
        returns (bool)
    {
        Escrow storage escrow = escrows[escrowId];
        return escrow.status == OrderStatus.DELIVERED
            && block.timestamp > escrow.reviewDeadline;
    }

    // =============================================================
    // VIEW FUNCTIONS — REPUTATION / TOKEN
    // =============================================================

    /**
     * @notice Get an agent's on-chain reputation.
     * @return completedJobs Total settled jobs (as seller).
     * @return failedJobs Total jobs lost to execution timeout or a lost dispute (as seller).
     * @return totalVolumeSettled Cumulative USDT settled (as seller), base units.
     * @return ratingSum Sum of buyer ratings, each 1..100.
     * @return ratingCount Number of ratings. Average = ratingSum / ratingCount.
     *
     * Success rate = completedJobs / (completedJobs + failedJobs), computed
     * off-chain.
     */
    function getReputation(
        address agent
    )
        external
        view
        returns (
            uint256 completedJobs,
            uint256 failedJobs,
            uint256 totalVolumeSettled,
            uint256 ratingSum,
            uint256 ratingCount
        )
    {
        Reputation storage rep = reputations[agent];
        return (
            rep.completedJobs,
            rep.failedJobs,
            rep.totalVolumeSettled,
            rep.ratingSum,
            rep.ratingCount
        );
    }

    /**
     * @notice Get USDT balance held by AgentEco.
     */
    function getUSDTBalance()
        external
        view
        returns (uint256)
    {
        return IERC20(USDT).balanceOf(
            address(this)
        );
    }

    // =============================================================
    // INTERNAL ERC20 HELPERS
    // =============================================================

    /**
     * @dev Safe ERC20 transfer.
     *
     * Supports tokens that:
     * - return true
     * - return no data
     */
    function _safeTransfer(
        address token,
        address to,
        uint256 amount
    )
        internal
    {
        (bool success, bytes memory data) =
            token.call(
                abi.encodeWithSelector(
                    IERC20.transfer.selector,
                    to,
                    amount
                )
            );

        require(
            success &&
            (
                data.length == 0 ||
                abi.decode(data, (bool))
            ),
            "ERC20 transfer failed"
        );
    }

    /**
     * @dev Safe ERC20 transferFrom.
     */
    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    )
        internal
    {
        (bool success, bytes memory data) =
            token.call(
                abi.encodeWithSelector(
                    IERC20.transferFrom.selector,
                    from,
                    to,
                    amount
                )
            );

        require(
            success &&
            (
                data.length == 0 ||
                abi.decode(data, (bool))
            ),
            "ERC20 transferFrom failed"
        );
    }
}

// =============================================================
// MINIMAL ERC20 INTERFACE
// =============================================================

interface IERC20 {

    function transfer(
        address to,
        uint256 amount
    )
        external
        returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    )
        external
        returns (bool);

    function balanceOf(
        address account
    )
        external
        view
        returns (uint256);

    function approve(
        address spender,
        uint256 amount
    )
        external
        returns (bool);

    function allowance(
        address owner,
        address spender
    )
        external
        view
        returns (uint256);
}
