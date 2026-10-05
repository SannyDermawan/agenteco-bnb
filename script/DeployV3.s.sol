// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentEco} from "../contracts/AgentEco.sol";
import {ArbiterCouncil} from "../contracts/ArbiterCouncil.sol";

/**
 * AgentEco v3 (the platform fee) next to v1 and v2, settling in the same MockUSDT:
 *
 * 1. deployer: AgentEco v3, numbering escrows from FIRST_ESCROW_ID (after v2's),
 *    with the platform fee (FEE_BPS, 250 = 2.5%) paid to TREASURY_ADDRESS; then a
 *    new ArbiterCouncil for it. A council is bound to one AgentEco, so v3 gets its
 *    own, with the same members and thresholds as v2's.
 * 2. arbiter wallet: transferArbiter(council), and proposes acceptArbiter() (vote 1 of 2).
 * 3. deployer: votes for it (2 of 2): the council holds the arbiter role, and from
 *    now on the fee and the treasury change only by a council admin vote.
 *
 * Env (root .env, never committed):
 *   DEPLOYER_PRIVATE_KEY, ARBITER_PRIVATE_KEY
 *   USDT_ADDRESS             default: the BSC Testnet MockUSDT
 *   FIRST_ESCROW_ID          default 2001
 *   FEE_BPS                  default 250 (2.5%)
 *   TREASURY_ADDRESS         default: the deployer (it must be able to spend what it receives;
 *                            the council cannot move tokens, so it must not be the treasury)
 *   COUNCIL_EXTRA_MEMBERS    optional, comma-separated addresses (e.g. a human arbiter's MetaMask)
 *   COUNCIL_RULING_THRESHOLD default 1
 *   COUNCIL_ADMIN_THRESHOLD  default 2
 *   MIN_WINDOW_SECONDS / ACCEPT_TIMEOUT_SECONDS / DISPUTE_TIMEOUT_SECONDS  default 120 / 120 / 900
 *
 * forge script script/DeployV3.s.sol --rpc-url bsc_testnet --broadcast
 */
contract DeployV3 is Script {
    address internal constant BSC_TESTNET_MUSDT = 0xae0BbCf2Ec6cbE83C39927e9A087c9486E51Cea7;

    function run() external returns (AgentEco eco, ArbiterCouncil council) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 arbiterKey = vm.envUint("ARBITER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address arbiter = vm.addr(arbiterKey);
        require(arbiter != deployer, "Arbiter must not be the deployer");

        address usdt = vm.envOr("USDT_ADDRESS", BSC_TESTNET_MUSDT);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(250));
        uint256 firstEscrowId = vm.envOr("FIRST_ESCROW_ID", uint256(2001));

        address[] memory extras = vm.envOr("COUNCIL_EXTRA_MEMBERS", ",", new address[](0));
        address[] memory members = new address[](2 + extras.length);
        members[0] = arbiter;
        members[1] = deployer;
        for (uint256 i = 0; i < extras.length; i++) members[2 + i] = extras[i];

        // 1. Contracts
        vm.startBroadcast(deployerKey);
        eco = new AgentEco(
            usdt,
            arbiter,
            vm.envOr("MIN_WINDOW_SECONDS", uint256(120)),
            vm.envOr("ACCEPT_TIMEOUT_SECONDS", uint256(120)),
            vm.envOr("DISPUTE_TIMEOUT_SECONDS", uint256(900)),
            firstEscrowId,
            feeBps,
            treasury
        );
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

        console.log("AgentEco v3     ", address(eco));
        console.log("ArbiterCouncil  ", address(council));
        console.log("arbiter (now)   ", eco.arbiter());
        console.log("first escrow id ", firstEscrowId);
        console.log("fee (bps)       ", eco.feeBps());
        console.log("treasury        ", eco.treasury());
        console.log("members         ", members.length);
        console.log("thresholds ruling / admin", council.rulingThreshold(), council.adminThreshold());
    }
}
