export {
  NETWORK,
  RPC_URL,
  EXPLORER_URL,
  AGENT_ECO_ADDRESS,
  USDT_ADDRESS,
  DEPLOYMENT_BLOCK,
  LEGACY_AGENT_ECO_ADDRESS,
  LEGACY_DEPLOYMENTS,
  ALL_AGENT_ECO_ADDRESSES,
  FIRST_ESCROW_ID,
  agentEcoFor,
  hasPlatformFee,
  isAgentEcoAddress,
  appChain,
  assertRpcMatchesNetwork,
} from './network.ts'
export { DemoAgentRuntime } from './runtime.ts'
export type { AgentConfig, AgentRole, NegotiationDecision } from './types.ts'
export { findOwnAgent, registerOrSyncSelf, discoverAgents } from './registryClient.ts'
export type { RegistryAgent, RegisterOptions, DiscoveredAgent } from './registryClient.ts'
export {
  openNegotiation,
  respondToNegotiation,
  listNegotiationsForAgent,
  countOffersBySide,
  isMyTurn,
} from './negotiationClient.ts'
export type { Negotiation, NegotiationMessage, NegotiationSide, NegotiationAction, NegotiationStatus } from './negotiationClient.ts'
export { listOrdersForAgent, attachEscrowToOrder } from './ordersClient.ts'
export type { RegistryOrder, OrderDbStatus } from './ordersClient.ts'
export { createOnchainClients } from './onchain/clients.ts'
export type { OnchainClients } from './onchain/clients.ts'
export {
  createAndFundEscrow,
  startExecution as startOnchainExecution,
  markDelivered as markOnchainDelivered,
  acceptAndSettle as acceptAndSettleOnchain,
  getEscrowStatus,
  raiseDispute as raiseDisputeOnchain,
  submitDisputeResponse as submitDisputeResponseOnchain,
  rateSeller as rateSellerOnchain,
  resolveDispute as resolveDisputeOnchain,
  getEscrowDisputeInfo,
  getEscrowHashes,
  getEscrowTimestamps,
  getEscrowWindows,
} from './onchain/escrow.ts'
export { readArbiterSetup, canRule, ruleDispute } from './onchain/arbiter.ts'
export type { ArbiterSetup, RulingOutcome } from './onchain/arbiter.ts'
export { onChainStatusLabel, ON_CHAIN_STATUS } from './onchain/abi.ts'
export type { OnChainStatus } from './onchain/abi.ts'
export { allEscrowIds, currentEscrowIds, readAllEscrows, readCurrentEscrows, readEscrowBasics } from './onchain/escrowIndex.ts'
export type { EscrowBasic } from './onchain/escrowIndex.ts'
export { publishEscrowResult } from './resultsClient.ts'
export type { EscrowResult } from './resultsClient.ts'
export { getDispute, submitDisputeReason, submitDisputeResponseText } from './disputesClient.ts'
export type { RegistryDispute } from './disputesClient.ts'
