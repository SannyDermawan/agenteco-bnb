// Network + AgentEco deployment config, shared with agent-runtime so the API,
// host, and keeper can never disagree about which chain/contract they're on.
export {
  NETWORK,
  RPC_URL,
  EXPLORER_URL,
  NATIVE_SYMBOL,
  TOKEN_SYMBOL,
  HOSTED_MIN_GAS,
  LOW_GAS_WARN,
  LOG_RANGE,
  AGENT_ECO_ADDRESS,
  USDT_ADDRESS,
  DEPLOYMENT_BLOCK,
  appChain,
  explorerTxUrl,
  assertRpcMatchesNetwork,
} from '../../agent-runtime/src/network.ts'
