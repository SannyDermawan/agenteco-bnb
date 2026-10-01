// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDT} from "../contracts/MockUSDT.sol";
import {AgentEco} from "../contracts/AgentEco.sol";

/**
 * Deploys MockUSDT, then AgentEco settling in that token. For AgentEco v2
 * next to an existing MockUSDT, with an ArbiterCouncil, see DeployV2.s.sol.
 *
 * Env (root .env, never committed):
 *   DEPLOYER_PRIVATE_KEY     deployer; becomes MockUSDT owner
 *   ARBITER_ADDRESS          dedicated arbiter wallet (not the deployer, not the keeper)
 *   MIN_WINDOW_SECONDS       default 120   (production: 3600)
 *   ACCEPT_TIMEOUT_SECONDS   default 120   (production: 43200)
 *   DISPUTE_TIMEOUT_SECONDS  default 900   (production: 172800)
 *   FIRST_ESCROW_ID          default 1
 *
 * forge script script/Deploy.s.sol --rpc-url bsc_testnet --broadcast
 */
contract Deploy is Script {
    function run() external returns (MockUSDT usdt, AgentEco eco) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        uint256 minWindow = vm.envOr("MIN_WINDOW_SECONDS", uint256(120));
        uint256 acceptTimeout = vm.envOr("ACCEPT_TIMEOUT_SECONDS", uint256(120));
        uint256 disputeTimeout = vm.envOr("DISPUTE_TIMEOUT_SECONDS", uint256(900));
        uint256 firstEscrowId = vm.envOr("FIRST_ESCROW_ID", uint256(1));

        address deployer = vm.addr(deployerKey);
        require(arbiter != deployer, "Arbiter must not be the deployer");

        vm.startBroadcast(deployerKey);
        usdt = new MockUSDT();
        eco = new AgentEco(address(usdt), arbiter, minWindow, acceptTimeout, disputeTimeout, firstEscrowId);
        vm.stopBroadcast();

        console.log("MockUSDT  ", address(usdt));
        console.log("AgentEco  ", address(eco));
        console.log("deployer  ", deployer);
        console.log("arbiter   ", arbiter);
        console.log("minWindow / acceptTimeout / disputeTimeout", minWindow, acceptTimeout, disputeTimeout);
    }
}
