import { defineChain, isAddress, type Address } from 'viem'

/**
 * The one place the Node side (backend API, host, keeper, and the standalone
 * buyer/seller agents) learns which network it's on and which AgentEco
 * deployment to talk to. Mirrors frontend/lib/web3/network.ts.
 *
 * Pick the network with NETWORK=bsc-testnet|bot-testnet|bot-mainnet (default
 * bsc-testnet; "testnet"/"mainnet" still mean the BOT Chain presets). Chain
 * params come from the presets below; the deployment — contract, token, deploy
 * block — comes from env, with working defaults where this repo has deployed.
 * A network without a default deployment refuses to start until
 * AGENT_ECO_ADDRESS is set, instead of quietly pointing at another chain.
 */

export type NetworkName = 'bsc-testnet' | 'bot-testnet' | 'bot-mainnet'

interface NetworkPreset {
  chainId: number
  name: string
  rpcUrl: string
  explorerUrl: string
  explorerName: string
  nativeSymbol: string
  testnet: boolean
  /** Settlement token for this network — MockUSDT on BSC Testnet, USDT on BOT Chain. */
  usdtAddress: Address
  /** What logs and API messages call the settlement token. */
  tokenSymbol: string
  /** Least native gas a hosted agent's wallet needs before the host will run it. */
  hostedMinGas: string
  /** System wallets (keeper, arbiter, hosted agents) below this log a warning. */
  lowGasWarn: string
  /** Multicall3, when deployed on this chain — batches contract reads. */
  multicall3?: Address
  /** Largest block span per eth_getLogs call the default RPC accepts (with margin). */
  logRange: bigint
  /** AgentEco deployment defaults, where this repo has one. */
  deployment?: { agentEcoAddress: Address; deploymentBlock: bigint }
}

// Each preset verified against its RPC's eth_chainId.
const PRESETS: Record<NetworkName, NetworkPreset> = {
  'bsc-testnet': {
    chainId: 97,
    name: 'BSC Testnet',
    // PublicNode, not the official data-seed nodes: those reject eth_getLogs
    // ("limit exceeded" even for 1,000 blocks), and escrow discovery needs it.
    // PublicNode allows 50,000 blocks per call. Override with RPC_URL.
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
    explorerUrl: 'https://testnet.bscscan.com',
    explorerName: 'BscScan Testnet',
    nativeSymbol: 'tBNB',
    testnet: true,
    // MockUSDT (mUSDT, 18 decimals) — AgentEco's own test token, see contracts/MockUSDT.sol.
    usdtAddress: '0xae0BbCf2Ec6cbE83C39927e9A087c9486E51Cea7',
    tokenSymbol: 'mUSDT',
    hostedMinGas: '0.003',
    lowGasWarn: '0.01',
    logRange: BigInt(45000),
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    deployment: {
      agentEcoAddress: '0x8bdff809013c28aA8a85038660D9d6E8d2c0294b',
      deploymentBlock: BigInt(133381113),
    },
  },
  'bot-testnet': {
    chainId: 968,
    name: 'BOT Chain Testnet',
    rpcUrl: 'https://rpc.bohr.life',
    explorerUrl: 'https://scan.bohr.life',
    explorerName: 'BOT Chain Explorer',
    nativeSymbol: 'BOT',
    testnet: true,
    usdtAddress: '0x75edC9335175Fc0552D51D48439F229c10420fe3',
    tokenSymbol: 'USDT',
    hostedMinGas: '0.05',
    lowGasWarn: '0.05',
    logRange: BigInt(5000),
  },
  'bot-mainnet': {
    chainId: 677,
    name: 'BOT Chain Mainnet',
    rpcUrl: 'https://rpc.botchain.ai',
    explorerUrl: 'https://scan.botchain.ai',
    explorerName: 'BOT Chain Explorer',
    nativeSymbol: 'BOT',
    testnet: false,
    usdtAddress: '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C',
    tokenSymbol: 'USDT',
    hostedMinGas: '0.05',
    lowGasWarn: '0.05',
    logRange: BigInt(5000),
  },
}

// Names from before the BSC Testnet deployment.
const ALIASES: Record<string, NetworkName> = { testnet: 'bot-testnet', mainnet: 'bot-mainnet' }

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function readNetwork(): NetworkName {
  const raw = (env('NETWORK') ?? 'bsc-testnet').toLowerCase()
  const name = ALIASES[raw] ?? raw
  if (!(name in PRESETS)) {
    throw new Error(`NETWORK must be one of ${Object.keys(PRESETS).join(', ')}, got: ${raw}`)
  }
  return name as NetworkName
}

function readAddress(name: string, fallback: Address | undefined): Address {
  const value = env(name) ?? fallback
  if (!value) throw new Error(`${name} must be set when NETWORK=${NETWORK} — there is no default deployment for it.`)
  if (!isAddress(value)) throw new Error(`${name} is not a valid EVM address: ${value}`)
  return value
}

function readBlock(name: string, fallback: bigint | undefined): bigint | null {
  const value = env(name)
  if (!value) return fallback ?? null
  try {
    return BigInt(value)
  } catch {
    throw new Error(`${name} must be an integer block number, got: ${value}`)
  }
}

export const NETWORK: NetworkName = readNetwork()
const preset = PRESETS[NETWORK]

/** Overridable (e.g. a private RPC provider); defaults to the network's public RPC. */
export const RPC_URL = env('RPC_URL') ?? preset.rpcUrl
export const EXPLORER_URL = preset.explorerUrl
export const NATIVE_SYMBOL = preset.nativeSymbol
export const TOKEN_SYMBOL = preset.tokenSymbol
/** Minimum native balance for a hosted agent wallet (HOSTED_MIN_GAS overrides). */
export const HOSTED_MIN_GAS = env('HOSTED_MIN_GAS') ?? preset.hostedMinGas
/** Warn when a system wallet's native balance drops below this (LOW_GAS_WARN_TBNB overrides). */
export const LOW_GAS_WARN = env('LOW_GAS_WARN_TBNB') ?? preset.lowGasWarn
/** Block span per eth_getLogs call (LOG_RANGE_BLOCKS overrides, e.g. for a paid RPC). */
export const LOG_RANGE = readBlock('LOG_RANGE_BLOCKS', preset.logRange) ?? preset.logRange
export const AGENT_ECO_ADDRESS = readAddress('AGENT_ECO_ADDRESS', preset.deployment?.agentEcoAddress)
export const USDT_ADDRESS = readAddress('USDT_ADDRESS', preset.usdtAddress)
/** Block AgentEco.sol was deployed at — log scans start here. Null = unknown (scan from "now"). */
export const DEPLOYMENT_BLOCK = readBlock('DEPLOYMENT_BLOCK', preset.deployment?.deploymentBlock)

export const appChain = defineChain({
  id: preset.chainId,
  name: preset.name,
  nativeCurrency: { name: preset.nativeSymbol, symbol: preset.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: preset.explorerName, url: preset.explorerUrl } },
  contracts: preset.multicall3 ? { multicall3: { address: preset.multicall3 } } : undefined,
  testnet: preset.testnet,
})

/** Explorer link for a transaction on the active network. */
export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

/**
 * Fails fast when RPC_URL points at a different chain than NETWORK — e.g. a
 * mainnet process accidentally given a testnet RPC.
 */
export async function assertRpcMatchesNetwork(getChainId: () => Promise<number>): Promise<void> {
  const actual = await getChainId()
  if (actual !== appChain.id) {
    throw new Error(`RPC_URL reports chain id ${actual}, but NETWORK=${NETWORK} expects ${appChain.id} (${appChain.name}).`)
  }
}
