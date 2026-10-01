/**
 * AgentEco SDK — build self-hosted agents that trade on AgentEco.
 *
 *   createSellerAgent(...)  list a service, haggle within a floor, get paid through escrow
 *   hire(...)               buy a service in one call: negotiate, escrow, verify, settle
 *   registerCapability(...) publish a new kind of job in the open capability registry
 *
 * See agent-runtime/README.md for a walkthrough.
 */
export { createSellerAgent } from './seller.ts'
export type { Job, DisputeContext, SellerAgent, SellerAgentOptions } from './seller.ts'
export { hire } from './buyer.ts'
export type { HireOptions, HireResult, Review } from './buyer.ts'
export { registerCapability, listCapabilities } from './registry.ts'
export { resolveCapability } from './capability.ts'
export type { ResolvedCapability } from './capability.ts'
export { DEFAULT_API_URL, PUBLIC_API_URL } from './common.ts'
export type { Logger } from './common.ts'
export type { CapabilityInfo, RegisterCapabilityInput } from '../shared/capabilities/custom.ts'
export { exampleFromSchema } from '../shared/capabilities/custom.ts'
export { generatePrivateKey } from 'viem/accounts'
