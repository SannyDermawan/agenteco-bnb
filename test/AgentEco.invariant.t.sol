// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AgentEco} from "../contracts/AgentEco.sol";
import {TestToken} from "./mocks/TestToken.sol";

/// Drives AgentEco through random sequences of every lifecycle action,
/// including timeouts, with the right caller for each.
contract AgentEcoHandler is Test {
    AgentEco internal eco;
    TestToken internal token;
    address internal buyer;
    address internal seller;
    address internal arbiter;

    uint256[] public ids;

    constructor(AgentEco eco_, TestToken token_, address buyer_, address seller_, address arbiter_) {
        eco = eco_;
        token = token_;
        buyer = buyer_;
        seller = seller_;
        arbiter = arbiter_;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function _pick(uint256 seed) internal view returns (uint256 id, bool ok) {
        if (ids.length == 0) return (0, false);
        return (ids[seed % ids.length], true);
    }

    function create(uint256 amount, uint256 execWindow, uint256 reviewWindow) external {
        amount = bound(amount, 1, 1_000e18);
        execWindow = bound(execWindow, eco.minWindow(), 2 days);
        reviewWindow = bound(reviewWindow, eco.minWindow(), 2 days);
        vm.prank(buyer);
        ids.push(eco.createEscrow(seller, amount, execWindow, reviewWindow, keccak256(abi.encode(ids.length))));
    }

    function fund(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(buyer);
        try eco.fundEscrow(id) {} catch {}
    }

    function start(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(seller);
        try eco.startExecution(id) {} catch {}
    }

    function deliver(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(seller);
        try eco.markDelivered(id, keccak256("result")) {} catch {}
    }

    function accept(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(buyer);
        try eco.acceptAndSettle(id) {} catch {}
    }

    function refund(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(buyer);
        try eco.refundEscrow(id) {} catch {}
    }

    function dispute(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(buyer);
        try eco.raiseDispute(id, keccak256("reason")) {} catch {}
    }

    function respond(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(seller);
        try eco.submitDisputeResponse(id, keccak256("response")) {} catch {}
    }

    function resolve(uint256 seed, bool forSeller) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(arbiter);
        if (forSeller) {
            try eco.resolveDisputeForSeller(id, keccak256("rationale")) {} catch {}
        } else {
            try eco.resolveDisputeForBuyer(id, keccak256("rationale")) {} catch {}
        }
    }

    function rate(uint256 seed, uint8 score) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(buyer);
        try eco.rateSeller(id, uint8(bound(score, 1, 100))) {} catch {}
    }

    function timeouts(uint256 seed) external {
        (uint256 id, bool ok) = _pick(seed);
        if (!ok) return;
        try eco.claimAcceptTimeout(id) {} catch {}
        try eco.claimExecutionTimeout(id) {} catch {}
        try eco.finalizeAfterReviewWindow(id) {} catch {}
        try eco.claimDisputeTimeout(id) {} catch {}
    }

    function wait(uint256 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 3 days));
    }
}

contract AgentEcoInvariantTest is StdInvariant, Test {
    AgentEco internal eco;
    TestToken internal token;
    AgentEcoHandler internal handler;

    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal arbiter = makeAddr("arbiter");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestToken(18);
        eco = new AgentEco(address(token), arbiter, 120, 120, 900, 1);
        token.mint(buyer, type(uint128).max);
        vm.prank(buyer);
        token.approve(address(eco), type(uint256).max);

        handler = new AgentEcoHandler(eco, token, buyer, seller, arbiter);
        targetContract(address(handler));
    }

    /// The contract holds exactly the money of escrows that are still live
    /// (FUNDED, EXECUTING, DELIVERED, DISPUTED) — never more, never less.
    function invariant_balanceMatchesLiveEscrows() public view {
        uint256 live;
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) {
            (,, uint256 amount, AgentEco.OrderStatus status) = eco.getEscrowBasic(handler.ids(i));
            if (
                status == AgentEco.OrderStatus.FUNDED || status == AgentEco.OrderStatus.EXECUTING
                    || status == AgentEco.OrderStatus.DELIVERED || status == AgentEco.OrderStatus.DISPUTED
            ) live += amount;
        }
        assertEq(token.balanceOf(address(eco)), live);
    }

    /// Nobody can mint money through the escrow: what the seller earned plus
    /// what is locked plus what the buyer holds is always the buyer's start balance.
    function invariant_noValueCreated() public view {
        assertEq(
            token.balanceOf(buyer) + token.balanceOf(seller) + token.balanceOf(address(eco)),
            type(uint128).max
        );
    }

    /// Ratings only ever come from escrows that received a result, one each.
    function invariant_ratingCountNeverExceedsDeliveredEscrows() public view {
        (,,,, uint256 ratingCount) = eco.getReputation(seller);
        uint256 delivered;
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) {
            (,,, uint256 deliveredAt,) = eco.getEscrowTimestamps(handler.ids(i));
            if (deliveredAt != 0) delivered++;
        }
        assertLe(ratingCount, delivered);
    }
}
