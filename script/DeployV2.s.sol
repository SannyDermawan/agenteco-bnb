// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentEco} from "../contracts/AgentEco.sol";
import {ArbiterCouncil} from "../contracts/ArbiterCouncil.sol";

/**
 * AgentEco v2 next to v1, settling in the same MockUSDT, with the arbiter role
 * held by an ArbiterCouncil instead of a single wallet:
 *
 * 1. deployer: AgentEco v2 (arbiter = the AI arbiter wallet for now), numbering
 *    escrows from FIRST_ESCROW_ID so ids never collide with v1's in the API's
 *    records; then ArbiterCouncil(members = AI arbiter, deployer, extras).
 * 2. arbiter wallet: transferArbiter(council) — step one of the handover —
 *    and proposes the council's acceptArbiter() (its vote 1 of 2).
 * 3. deployer: votes for it (2 of 2) — the council accepts the role.
 *
 * Rulings need 1 vote (the AI arbiter, or a human, can rule on its own as
 * before); admin actions — handing the role on, changing members — need 2.
 *
 * Env (root .env, never committed):
 *   DEPLOYER_PRIVATE_KEY, ARBITER_PRIVATE_KEY
 *   USDT_ADDRESS             default: the BSC Testnet MockUSDT
 *   FIRST_ESCROW_ID          default 1001
 *   COUNCIL_EXTRA_MEMBERS    optional, comma-separated addresses (e.g. a human arbiter's MetaMask)
 *   COUNCIL_RULING_THRESHOLD default 1
 *   COUNCIL_ADMIN_THRESHOLD  default 2
 *   MIN_WINDOW_SECONDS / ACCEPT_TIMEOUT_SECONDS / DISPUTE_TIMEOUT_SECONDS  default 120 / 120 / 900
 *
 * forge script script/DeployV2.s.sol --rpc-url bsc_testnet --broadcast
 */
contract DeployV2 is Script {
    address internal constant BSC_TESTNET_MUSDT = 0xae0BbCf2Ec6cbE83C39927e9A087c9486E51Cea7;

    function run() external returns (AgentEco eco, ArbiterCouncil council) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 arbiterKey = vm.envUint("ARBITER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address arbiter = vm.addr(arbiterKey);
        require(arbiter != deployer, "Arbiter must not be the deployer");

        address usdt = vm.envOr("USDT_ADDRESS", BSC_TESTNET_MUSDT);
        uint256 firstEscrowId = vm.envOr("FIRST_ESCROW_ID", uint256(1001));
        uint256 minWindow = vm.envOr("MIN_WINDOW_SECONDS", uint256(120));
        uint256 acceptTimeout = vm.envOr("ACCEPT_TIMEOUT_SECONDS", uint256(120));
        uint256 disputeTimeout = vm.envOr("DISPUTE_TIMEOUT_SECONDS", uint256(900));

        address[] memory extras = vm.envOr("COUNCIL_EXTRA_MEMBERS", ",", new address[](0));
        address[] memory members = new address[](2 + extras.length);
        members[0] = arbiter;
        members[1] = deployer;
        for (uint256 i = 0; i < extras.length; i++) members[2 + i] = extras[i];

        // 1. Contracts
        vm.startBroadcast(deployerKey);
        eco = new AgentEco(usdt, arbiter, minWindow, acceptTimeout, disputeTimeout, firstEscrowId, 0, deployer);
        council = new ArbiterCouncil(
            address(eco),
            members,
            vm.envOr("COUNCIL_RULING_THRESHOLD", uint256(1)),
            vm.envOr("COUNCIL_ADMIN_THRESHOLD", uint256(2))
        );
        vm.stopBroadcast();

        // 2. The arbiter wallet names the council and proposes that it accept.
        bytes memory accept = abi.encodeCall(AgentEco.acceptArbiter, ());
        vm.startBroadcast(arbiterKey);
        eco.transferArbiter(address(council));
        council.proposeAdmin(address(eco), accept);
        vm.stopBroadcast();

        // 3. The deployer's vote completes it, if two votes are enough.
        if (council.adminThreshold() == 2) {
            vm.startBroadcast(deployerKey);
            council.voteAdmin(address(eco), accept, 0);
            vm.stopBroadcast();
            require(eco.arbiter() == address(council), "Council did not take the arbiter role");
        }

        console.log("AgentEco v2     ", address(eco));
        console.log("ArbiterCouncil  ", address(council));
        console.log("arbiter (now)   ", eco.arbiter());
        console.log("first escrow id ", firstEscrowId);
        console.log("members         ", members.length);
        console.log("thresholds ruling / admin", council.rulingThreshold(), council.adminThreshold());
    }
}
