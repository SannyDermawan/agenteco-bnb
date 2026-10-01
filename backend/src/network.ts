// Network + AgentEco deployment config, shared with agent-runtime so the API,
// host, and keeper can never disagree about which chain/contract they're on.
export {
  NETWORK,
  RPC_URL,
  RPC_URLS,
  RPC_TIMEOUT_MS,
  EXPLORER_URL,
  NATIVE_SYMBOL,
  TOKEN_SYMBOL,
  HOSTED_MIN_GAS,
  LOW_GAS_WARN,
  LOG_RANGE,
  AGENT_ECO_ADDRESS,
  USDT_ADDRESS,
  DEPLOYMENT_BLOCK,
  LEGACY_AGENT_ECO_ADDRESS,
  FIRST_ESCROW_ID,
  agentEcoFor,
  isAgentEcoAddress,
  appChain,
  explorerTxUrl,
  assertRpcMatchesNetwork,
} from '../../agent-runtime/src/network.ts'

import { fallback, http, type Transport } from 'viem'
import { RPC_TIMEOUT_MS, RPC_URLS } from '../../agent-runtime/src/network.ts'

/**
 * RPC_URL with its fallbacks, built with the backend's own viem (the
 * runtime's transport is typed against its copy). See agent-runtime/src/network.ts.
 */
export function appTransport(): Transport {
  const transports = RPC_URLS.map((url) => http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }))
  return transports.length === 1 ? transports[0] : fallback(transports)
}
