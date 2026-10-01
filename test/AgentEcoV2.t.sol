// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentEco} from "../contracts/AgentEco.sol";
import {ArbiterCouncil} from "../contracts/ArbiterCouncil.sol";
import {AgentEcoBase} from "./AgentEco.t.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// A token that calls back into AgentEco while it moves funds must hit the reentrancy guard.
contract AgentEcoReentrancyTest is Test {
    AgentEco internal eco;
    ReentrantToken internal token;
    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal arbiter = makeAddr("arbiter");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new ReentrantToken();
        eco = new AgentEco(address(token), arbiter, 120, 120, 900, 1);
        token.mint(buyer, 100e18);
        vm.prank(buyer);
        token.approve(address(eco), type(uint256).max);
    }

    function _funded() internal returns (uint256 id) {
        vm.startPrank(buyer);
        id = eco.createEscrow(seller, 1e18, 300, 600, keccak256("task"));
        eco.fundEscrow(id);
        vm.stopPrank();
    }

    function test_refund_cannotBeReentered() public {
        uint256 id = _funded();
        // While refunding, the token tries to refund the same escrow a second time.
        token.arm(address(eco), abi.encodeCall(AgentEco.refundEscrow, (id)));
        vm.prank(buyer);
        eco.refundEscrow(id);
        assertEq(bytes4(token.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "re-entry blocked");
        assertEq(token.balanceOf(buyer), 100e18, "refunded exactly once");
    }

    function test_fund_cannotBeReentered() public {
        uint256 first = _funded();
        vm.prank(buyer);
        uint256 id = eco.createEscrow(seller, 1e18, 300, 600, keccak256("task"));
        // While pulling the deposit, the token tries to claim another escrow's refund.
        vm.warp(block.timestamp + 121);
        token.arm(address(eco), abi.encodeCall(AgentEco.claimAcceptTimeout, (first)));
        vm.prank(buyer);
        eco.fundEscrow(id);
        assertEq(bytes4(token.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "re-entry blocked");
    }

    function test_settle_cannotBeReentered() public {
        uint256 id = _funded();
        vm.startPrank(seller);
        eco.startExecution(id);
        eco.markDelivered(id, keccak256("result"));
        vm.stopPrank();
        token.arm(address(eco), abi.encodeCall(AgentEco.finalizeAfterReviewWindow, (id)));
        vm.prank(buyer);
        eco.acceptAndSettle(id);
        assertEq(bytes4(token.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "re-entry blocked");
    }
}

/// ArbiterCouncil holding AgentEco's arbiter role.
contract ArbiterCouncilTest is AgentEcoBase {
    ArbiterCouncil internal council;
    address internal ai = makeAddr("ai");
    address internal human1 = makeAddr("human1");
    address internal human2 = makeAddr("human2");

    event RulingExecuted(bytes32 indexed id, uint256 indexed escrowId, bool forSeller, bytes32 rationaleHash);
    event DisputeResolved(uint256 indexed escrowId, address indexed arbiter, bool releasedToSeller, bytes32 rationaleHash);

    function setUp() public {
        _deploy(18);
        council = _council(1, 2);
        _handOverTo(council);
    }

    function _council(uint256 ruling, uint256 admin) internal returns (ArbiterCouncil c) {
        address[] memory members = new address[](3);
        members[0] = ai;
        members[1] = human1;
        members[2] = human2;
        c = new ArbiterCouncil(address(eco), members, ruling, admin);
    }

    /// Arbiter wallet names the council; two members vote to accept.
    function _handOverTo(ArbiterCouncil c) internal {
        vm.prank(arbiter);
        eco.transferArbiter(address(c));
        bytes memory accept = abi.encodeCall(AgentEco.acceptArbiter, ());
        vm.prank(human1);
        c.proposeAdmin(address(eco), accept);
        assertEq(eco.arbiter(), arbiter, "one vote is not enough");
        uint256 nonceAccept = c.adminNonce() - 1;
        vm.prank(human2);
        c.voteAdmin(address(eco), accept, nonceAccept);
        assertEq(eco.arbiter(), address(c));
    }

    function test_constructor_validates() public {
        address[] memory members = new address[](2);
        members[0] = ai;
        members[1] = human1;
        vm.expectRevert("Invalid admin threshold");
        new ArbiterCouncil(address(eco), members, 1, 3);
        vm.expectRevert("Invalid ruling threshold");
        new ArbiterCouncil(address(eco), members, 0, 2);
        members[1] = ai;
        vm.expectRevert("Already a member");
        new ArbiterCouncil(address(eco), members, 1, 1);
        assertEq(council.getMembers().length, 3);
        assertTrue(council.isMember(human2));
    }

    function test_singleMemberRules_whenRulingThresholdIsOne() public {
        uint256 id = _disputed();
        uint256 sellerBefore = token.balanceOf(seller);
        vm.expectEmit(true, true, false, true);
        emit DisputeResolved(id, address(council), true, RATIONALE);
        vm.prank(ai);
        assertTrue(council.voteRuling(id, true, RATIONALE));
        assertEq(_status(id), SETTLED);
        assertEq(token.balanceOf(seller) - sellerBefore, amount);
    }

    function test_rulingNeedsTwoVotes_forTheSameRuling() public {
        // Raise the ruling threshold to 2 (an admin vote).
        bytes memory set = abi.encodeCall(ArbiterCouncil.setThresholds, (2, 2));
        vm.prank(ai);
        council.proposeAdmin(address(council), set);
        uint256 nonceSet = council.adminNonce() - 1;
        vm.prank(human1);
        council.voteAdmin(address(council), set, nonceSet);
        assertEq(council.rulingThreshold(), 2);

        uint256 id = _disputed();
        vm.prank(ai);
        assertFalse(council.voteRuling(id, false, RATIONALE));
        assertEq(_status(id), DISPUTED, "one vote waits");

        // A vote for a different ruling does not count toward this one.
        vm.prank(human1);
        assertFalse(council.voteRuling(id, true, RATIONALE));
        vm.prank(ai);
        vm.expectRevert("Already voted");
        council.voteRuling(id, false, RATIONALE);

        vm.prank(human2);
        assertTrue(council.voteRuling(id, false, RATIONALE));
        assertEq(_status(id), REFUNDED);

        vm.prank(human1);
        vm.expectRevert("Already executed");
        council.voteRuling(id, false, RATIONALE);
    }

    function test_outsidersCannotVoteOrPropose() public {
        uint256 id = _disputed();
        vm.prank(stranger);
        vm.expectRevert("Only council member");
        council.voteRuling(id, true, RATIONALE);
        vm.prank(stranger);
        vm.expectRevert("Only council member");
        council.proposeAdmin(address(eco), "");
        // The council's own functions are only reachable through a vote.
        vm.prank(ai);
        vm.expectRevert("Only by council vote");
        council.addMember(stranger);
        // And the old arbiter wallet is out.
        vm.prank(arbiter);
        vm.expectRevert("Only arbiter");
        eco.resolveDisputeForSeller(id, RATIONALE);
    }

    function test_adminOnlyTargetsAgentEcoOrItself() public {
        vm.prank(ai);
        vm.expectRevert("Target not allowed");
        council.proposeAdmin(address(token), abi.encodeCall(token.transfer, (ai, 1)));
    }

    function test_membersChangeByVote() public {
        address human3 = makeAddr("human3");
        bytes memory add = abi.encodeCall(ArbiterCouncil.addMember, (human3));
        vm.prank(human1);
        council.proposeAdmin(address(council), add);
        uint256 nonceAdd = council.adminNonce() - 1;
        vm.prank(human2);
        council.voteAdmin(address(council), add, nonceAdd);
        assertTrue(council.isMember(human3));

        bytes memory remove = abi.encodeCall(ArbiterCouncil.removeMember, (ai));
        vm.prank(human1);
        council.proposeAdmin(address(council), remove);
        uint256 nonceRemove = council.adminNonce() - 1;
        vm.prank(human3);
        council.voteAdmin(address(council), remove, nonceRemove);
        assertFalse(council.isMember(ai));
        assertEq(council.getMembers().length, 3);

        vm.prank(ai);
        vm.expectRevert("Only council member");
        council.voteRuling(1, true, RATIONALE);
    }

    function test_cannotDropBelowThreshold() public {
        // 3 members, admin threshold 2: removing two would leave 1 < 2.
        bytes memory removeAi = abi.encodeCall(ArbiterCouncil.removeMember, (ai));
        vm.prank(human1);
        council.proposeAdmin(address(council), removeAi);
        uint256 nonceRemoveAi = council.adminNonce() - 1;
        vm.prank(human2);
        council.voteAdmin(address(council), removeAi, nonceRemoveAi);

        bytes memory removeH2 = abi.encodeCall(ArbiterCouncil.removeMember, (human2));
        vm.prank(human1);
        council.proposeAdmin(address(council), removeH2);
        uint256 nonceRemoveH2 = council.adminNonce() - 1;
        vm.prank(human2);
        vm.expectRevert("Invalid admin threshold");
        council.voteAdmin(address(council), removeH2, nonceRemoveH2);
    }

    function test_councilHandsTheRoleOn() public {
        address next = makeAddr("next");
        bytes memory transfer = abi.encodeCall(AgentEco.transferArbiter, (next));
        vm.prank(ai);
        council.proposeAdmin(address(eco), transfer);
        uint256 nonceTransfer = council.adminNonce() - 1;
        vm.prank(human2);
        council.voteAdmin(address(eco), transfer, nonceTransfer);
        assertEq(eco.pendingArbiter(), next);
        vm.prank(next);
        eco.acceptArbiter();
        assertEq(eco.arbiter(), next);
    }

    function test_failedAdminCallBubblesItsReason() public {
        // Accepting when the council is not the pending arbiter fails with AgentEco's own reason.
        bytes memory accept = abi.encodeCall(AgentEco.acceptArbiter, ());
        vm.prank(ai);
        council.proposeAdmin(address(eco), accept);
        uint256 nonceAccept = council.adminNonce() - 1;
        vm.prank(human1);
        vm.expectRevert("Only pending arbiter");
        council.voteAdmin(address(eco), accept, nonceAccept);
    }

    function test_unknownAdminProposalReverts() public {
        vm.prank(ai);
        vm.expectRevert("Unknown proposal");
        council.voteAdmin(address(eco), "", 99);
    }
}
