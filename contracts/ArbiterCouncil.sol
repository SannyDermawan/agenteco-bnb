// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArbiterCouncil
 * @notice A small multisig that holds AgentEco's arbiter role, so no single
 * key controls it.
 *
 * Members are the AI arbiter's key (run by the host) and human operators.
 * Two thresholds:
 *
 * - rulingThreshold: votes needed to resolve a dispute. Rulings are urgent
 *   and bounded — they can only release an escrow to its seller or refund
 *   its buyer — so this can be low (1 = any member may rule alone).
 * - adminThreshold: votes needed for everything else: handing the arbiter
 *   role on, adding or removing members, changing thresholds. This should
 *   be higher, so one leaked key can never take over the role.
 *
 * Every vote names exactly what it approves. A ruling is identified by
 * (escrowId, forSeller, rationaleHash); an admin action by (target, data,
 * nonce). The vote that reaches the threshold executes it.
 */
contract ArbiterCouncil {

    // =============================================================
    // STATE
    // =============================================================

    /// The AgentEco deployment this council arbitrates for.
    address public immutable agentEco;

    address[] private members;
    mapping(address => bool) public isMember;

    uint256 public rulingThreshold;
    uint256 public adminThreshold;

    struct Proposal {
        uint256 votes;
        bool executed;
    }

    /// Ruling and admin proposals, by id (see rulingId / adminId).
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    /// Raised by every admin proposal, so the same call can be proposed again later.
    uint256 public adminNonce;

    // =============================================================
    // EVENTS
    // =============================================================

    event RulingVoted(bytes32 indexed id, uint256 indexed escrowId, address indexed member, bool forSeller, bytes32 rationaleHash, uint256 votes);
    event RulingExecuted(bytes32 indexed id, uint256 indexed escrowId, bool forSeller, bytes32 rationaleHash);
    event AdminProposed(bytes32 indexed id, uint256 indexed nonce, address indexed target, bytes data);
    event AdminVoted(bytes32 indexed id, address indexed member, uint256 votes);
    event AdminExecuted(bytes32 indexed id);
    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event ThresholdsChanged(uint256 rulingThreshold, uint256 adminThreshold);

    // =============================================================
    // MODIFIERS
    // =============================================================

    modifier onlyMember() {
        require(isMember[msg.sender], "Only council member");
        _;
    }

    /// Member and threshold changes go through an admin vote, which calls back into this contract.
    modifier onlySelf() {
        require(msg.sender == address(this), "Only by council vote");
        _;
    }

    // =============================================================
    // CONSTRUCTOR
    // =============================================================

    constructor(
        address agentEco_,
        address[] memory members_,
        uint256 rulingThreshold_,
        uint256 adminThreshold_
    ) {
        require(agentEco_ != address(0), "Invalid AgentEco");
        agentEco = agentEco_;
        for (uint256 i = 0; i < members_.length; i++) {
            _addMember(members_[i]);
        }
        _setThresholds(rulingThreshold_, adminThreshold_);
    }

    // =============================================================
    // RULINGS
    // =============================================================

    function rulingId(uint256 escrowId, bool forSeller, bytes32 rationaleHash) public pure returns (bytes32) {
        return keccak256(abi.encode("ruling", escrowId, forSeller, rationaleHash));
    }

    /**
     * @notice Vote for a ruling on a disputed escrow. The vote that reaches
     * rulingThreshold executes it on AgentEco. Returns whether it executed.
     */
    function voteRuling(
        uint256 escrowId,
        bool forSeller,
        bytes32 rationaleHash
    )
        external
        onlyMember
        returns (bool executed)
    {
        bytes32 id = rulingId(escrowId, forSeller, rationaleHash);
        uint256 votes = _vote(id);

        emit RulingVoted(id, escrowId, msg.sender, forSeller, rationaleHash, votes);

        if (votes < rulingThreshold) return false;

        proposals[id].executed = true;
        if (forSeller) {
            IAgentEcoArbiter(agentEco).resolveDisputeForSeller(escrowId, rationaleHash);
        } else {
            IAgentEcoArbiter(agentEco).resolveDisputeForBuyer(escrowId, rationaleHash);
        }

        emit RulingExecuted(id, escrowId, forSeller, rationaleHash);
        return true;
    }

    // =============================================================
    // ADMIN
    // =============================================================

    function adminId(address target, bytes memory data, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode("admin", target, data, nonce));
    }

    /**
     * @notice Propose an admin call — on AgentEco (transferArbiter,
     * acceptArbiter) or on this council (addMember, removeMember,
     * setThresholds). Counts as the proposer's vote.
     */
    function proposeAdmin(
        address target,
        bytes calldata data
    )
        external
        onlyMember
        returns (bytes32 id)
    {
        require(target == agentEco || target == address(this), "Target not allowed");

        uint256 nonce = adminNonce++;
        id = adminId(target, data, nonce);

        emit AdminProposed(id, nonce, target, data);

        _voteAdmin(id, target, data);
    }

    /// Vote for an open admin proposal (target, data and nonce from its AdminProposed event).
    function voteAdmin(
        address target,
        bytes calldata data,
        uint256 nonce
    )
        external
        onlyMember
    {
        require(nonce < adminNonce, "Unknown proposal");

        _voteAdmin(adminId(target, data, nonce), target, data);
    }

    function _voteAdmin(bytes32 id, address target, bytes calldata data) internal {
        uint256 votes = _vote(id);

        emit AdminVoted(id, msg.sender, votes);

        if (votes < adminThreshold) return;

        proposals[id].executed = true;
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            // Bubble up the callee's revert reason.
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        emit AdminExecuted(id);
    }

    function _vote(bytes32 id) internal returns (uint256 votes) {
        Proposal storage p = proposals[id];
        require(!p.executed, "Already executed");
        require(!hasVoted[id][msg.sender], "Already voted");

        hasVoted[id][msg.sender] = true;
        votes = ++p.votes;
    }

    // =============================================================
    // MEMBERS + THRESHOLDS (only through an admin vote)
    // =============================================================

    function addMember(address member) external onlySelf {
        _addMember(member);
        _checkThresholds();
    }

    function removeMember(address member) external onlySelf {
        require(isMember[member], "Not a member");

        isMember[member] = false;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == member) {
                members[i] = members[members.length - 1];
                members.pop();
                break;
            }
        }
        _checkThresholds();

        emit MemberRemoved(member);
    }

    function setThresholds(uint256 rulingThreshold_, uint256 adminThreshold_) external onlySelf {
        _setThresholds(rulingThreshold_, adminThreshold_);
    }

    function _addMember(address member) internal {
        require(member != address(0), "Invalid member");
        require(!isMember[member], "Already a member");

        isMember[member] = true;
        members.push(member);

        emit MemberAdded(member);
    }

    function _setThresholds(uint256 rulingThreshold_, uint256 adminThreshold_) internal {
        rulingThreshold = rulingThreshold_;
        adminThreshold = adminThreshold_;
        _checkThresholds();

        emit ThresholdsChanged(rulingThreshold_, adminThreshold_);
    }

    /// Both thresholds must stay reachable by the current members.
    function _checkThresholds() internal view {
        require(rulingThreshold >= 1 && rulingThreshold <= members.length, "Invalid ruling threshold");
        require(adminThreshold >= 1 && adminThreshold <= members.length, "Invalid admin threshold");
    }

    // =============================================================
    // VIEWS
    // =============================================================

    function getMembers() external view returns (address[] memory) {
        return members;
    }
}

/// The two AgentEco functions the council calls for rulings.
interface IAgentEcoArbiter {
    function resolveDisputeForSeller(uint256 escrowId, bytes32 rationaleHash) external;

    function resolveDisputeForBuyer(uint256 escrowId, bytes32 rationaleHash) external;
}
