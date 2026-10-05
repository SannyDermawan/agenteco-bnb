// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentEco} from "../contracts/AgentEco.sol";
import {ArbiterCouncil} from "../contracts/ArbiterCouncil.sol";
import {AgentEcoBase} from "./AgentEco.t.sol";

/// AgentEco v3: the platform fee on settled payments.
contract AgentEcoFeeTest is AgentEcoBase {
    address internal treasury = makeAddr("treasury");
    uint256 internal constant FEE_BPS = 250; // 2.5%

    event FeeUpdated(uint256 feeBps, address indexed treasury);
    event FeeCharged(uint256 indexed escrowId, address indexed treasury, uint256 fee);

    function setUp() public {
        _deploy(18);
        vm.prank(arbiter);
        eco.setFee(FEE_BPS, treasury);
    }

    function _fee(uint256 value) internal pure returns (uint256) {
        return (value * FEE_BPS) / 10_000;
    }

    function _assertPaidWithFee(uint256 sellerBefore) internal view {
        assertEq(token.balanceOf(seller) - sellerBefore, amount - _fee(amount), "seller gets the price minus the fee");
        assertEq(token.balanceOf(treasury), _fee(amount), "treasury gets the fee");
        assertEq(eco.totalFeesCollected(), _fee(amount));
        assertEq(token.balanceOf(address(eco)), 0, "nothing left in escrow");
    }

    function test_acceptAndSettle_paysTheFee() public {
        uint256 id = _delivered();
        uint256 before = token.balanceOf(seller);
        vm.expectEmit(true, true, false, true);
        emit FeeCharged(id, treasury, _fee(amount));
        vm.prank(buyer);
        eco.acceptAndSettle(id);
        _assertPaidWithFee(before);
        // Reputation counts the full price the buyer paid.
        (, , uint256 volume, , ) = _rep(seller);
        assertEq(volume, amount);
    }

    function test_finalizeAfterReviewWindow_paysTheFee() public {
        uint256 id = _delivered();
        uint256 before = token.balanceOf(seller);
        vm.warp(block.timestamp + REVIEW_WINDOW + 1);
        vm.prank(stranger);
        eco.finalizeAfterReviewWindow(id);
        _assertPaidWithFee(before);
    }

    function test_rulingForSeller_paysTheFee() public {
        uint256 id = _disputed();
        uint256 before = token.balanceOf(seller);
        vm.prank(arbiter);
        eco.resolveDisputeForSeller(id, RATIONALE);
        _assertPaidWithFee(before);
    }

    function test_refunds_carryNoFee() public {
        uint256 start = token.balanceOf(buyer);

        uint256 a = _funded();
        vm.prank(buyer);
        eco.refundEscrow(a);

        uint256 b = _funded();
        vm.warp(block.timestamp + ACCEPT_TIMEOUT + 1);
        eco.claimAcceptTimeout(b);

        uint256 c = _executing();
        vm.warp(block.timestamp + EXEC_WINDOW + 1);
        eco.claimExecutionTimeout(c);

        uint256 d = _disputed();
        vm.prank(arbiter);
        eco.resolveDisputeForBuyer(d, RATIONALE);

        uint256 e = _disputed();
        vm.warp(block.timestamp + DISPUTE_TIMEOUT + 1);
        eco.claimDisputeTimeout(e);

        assertEq(token.balanceOf(buyer), start, "every refund returns the full amount");
        assertEq(token.balanceOf(treasury), 0);
        assertEq(eco.totalFeesCollected(), 0);
    }

    function test_rateIsFixedWhenTheEscrowIsCreated() public {
        uint256 agreed = _delivered();
        // The rate changes after the deal was made...
        vm.prank(arbiter);
        eco.setFee(500, treasury);
        uint256 before = token.balanceOf(seller);
        vm.prank(buyer);
        eco.acceptAndSettle(agreed);
        // ...but this escrow keeps the 2.5% it was created with.
        assertEq(token.balanceOf(seller) - before, amount - _fee(amount));
        (uint256 rate, uint256 fee) = eco.getEscrowFee(agreed);
        assertEq(rate, FEE_BPS);
        assertEq(fee, _fee(amount));

        uint256 next = _create();
        (rate, fee) = eco.getEscrowFee(next);
        assertEq(rate, 500, "new escrows take the new rate");
        assertEq(fee, (amount * 500) / 10_000);
    }

    function test_quoteFee() public view {
        assertEq(eco.quoteFee(1e18), 25e15);
        assertEq(eco.quoteFee(0), 0);
    }

    function test_tinyPayment_roundsTheFeeDown() public {
        vm.startPrank(buyer);
        uint256 id = eco.createEscrow(seller, 39, EXEC_WINDOW, REVIEW_WINDOW, TASK); // 39 * 2.5% < 1
        eco.fundEscrow(id);
        vm.stopPrank();
        vm.startPrank(seller);
        eco.startExecution(id);
        eco.markDelivered(id, RESULT);
        vm.stopPrank();
        vm.prank(buyer);
        eco.acceptAndSettle(id);
        assertEq(token.balanceOf(seller), 39, "the seller is paid in full when the fee rounds to 0");
        assertEq(token.balanceOf(treasury), 0);
    }

    function test_setFee_onlyArbiter_capped_andNeedsATreasury() public {
        vm.prank(stranger);
        vm.expectRevert("Only arbiter");
        eco.setFee(100, treasury);

        vm.startPrank(arbiter);
        vm.expectRevert("Fee too high");
        eco.setFee(1001, treasury);
        vm.expectRevert("Invalid treasury");
        eco.setFee(100, address(0));

        vm.expectEmit(true, false, false, true);
        emit FeeUpdated(1000, stranger);
        eco.setFee(1000, stranger);
        vm.stopPrank();
        assertEq(eco.feeBps(), 1000);
        assertEq(eco.treasury(), stranger);
    }

    function test_constructor_validatesTheFee() public {
        vm.expectRevert("Fee too high");
        new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 1, 1001, treasury);
        vm.expectRevert("Invalid treasury");
        new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 1, 250, address(0));
        AgentEco fresh = new AgentEco(address(token), arbiter, MIN_WINDOW, ACCEPT_TIMEOUT, DISPUTE_TIMEOUT, 2001, 250, treasury);
        assertEq(fresh.feeBps(), 250);
        assertEq(fresh.treasury(), treasury);
        assertEq(fresh.MAX_FEE_BPS(), 1000);
        assertEq(fresh.VERSION(), "3");
        assertEq(fresh.firstEscrowId(), 2001);
    }

    /// The seller's share plus the fee is always exactly the escrowed amount.
    function testFuzz_feeSplitIsExact(uint96 value, uint16 rate) public {
        uint256 price = bound(uint256(value), 1, 500e18);
        uint256 bps = bound(uint256(rate), 0, 1000);
        vm.prank(arbiter);
        eco.setFee(bps, treasury);
        token.mint(buyer, price);
        vm.startPrank(buyer);
        uint256 id = eco.createEscrow(seller, price, EXEC_WINDOW, REVIEW_WINDOW, TASK);
        eco.fundEscrow(id);
        vm.stopPrank();
        vm.startPrank(seller);
        eco.startExecution(id);
        eco.markDelivered(id, RESULT);
        vm.stopPrank();
        uint256 before = token.balanceOf(seller);
        vm.prank(buyer);
        eco.acceptAndSettle(id);
        uint256 toSeller = token.balanceOf(seller) - before;
        assertEq(toSeller + token.balanceOf(treasury), price);
        assertEq(token.balanceOf(treasury), (price * bps) / 10_000);
    }
}

/// The council, as arbiter, changes the fee only by an admin vote (2 of 3).
contract AgentEcoFeeCouncilTest is AgentEcoBase {
    address internal ai = makeAddr("ai");
    address internal human1 = makeAddr("human1");
    address internal human2 = makeAddr("human2");
    address internal treasury = makeAddr("treasury");
    ArbiterCouncil internal council;

    function setUp() public {
        _deploy(18);
        address[] memory members = new address[](3);
        members[0] = ai;
        members[1] = human1;
        members[2] = human2;
        council = new ArbiterCouncil(address(eco), members, 1, 2);
        vm.prank(arbiter);
        eco.transferArbiter(address(council));
        bytes memory accept = abi.encodeCall(AgentEco.acceptArbiter, ());
        vm.prank(human1);
        council.proposeAdmin(address(eco), accept);
        uint256 nonce = council.adminNonce() - 1;
        vm.prank(human2);
        council.voteAdmin(address(eco), accept, nonce);
        assertEq(eco.arbiter(), address(council));
    }

    function test_feeChangesNeedTwoVotes() public {
        bytes memory setFee = abi.encodeCall(AgentEco.setFee, (250, treasury));
        // A leaked AI key alone cannot change the fee or redirect it.
        vm.prank(ai);
        council.proposeAdmin(address(eco), setFee);
        assertEq(eco.feeBps(), 0, "one vote is not enough");
        uint256 nonce = council.adminNonce() - 1;
        vm.prank(human1);
        council.voteAdmin(address(eco), setFee, nonce);
        assertEq(eco.feeBps(), 250);
        assertEq(eco.treasury(), treasury);
    }

    function test_aMemberCannotSetTheFeeDirectly() public {
        vm.prank(ai);
        vm.expectRevert("Only arbiter");
        eco.setFee(1000, ai);
    }
}
