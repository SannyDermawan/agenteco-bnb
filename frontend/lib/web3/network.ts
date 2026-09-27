import { isAddress, type Address } from 'viem'

/**
 * Which network the app runs on and which AgentEco deployment it talks to.
 * Mirrors agent-runtime/src/network.ts (the backend side) — keep in sync.
 *
 * Pick the network with NEXT_PUBLIC_NETWORK=bsc-testnet|bot-testnet|bot-mainnet
 * (default bsc-testnet; "testnet"/"mainnet" still mean the BOT Chain presets).
 * Chain params come from the presets below; the deployment — contract, token,
 * deploy block — comes from env, with working defaults where this repo has
 * deployed. A build for a network without a default deployment fails loudly
 * instead of silently pointing users at another chain's contracts.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so each must be read with a
 * literal `process.env.NEXT_PUBLIC_…` — and changing one needs a redeploy.
 */

type NetworkName = 'bsc-testnet' | 'bot-testnet' | 'bot-mainnet'

export interface FaucetLink {
  label: string
  url: string
}

interface NetworkPreset {
  chainId: number
  name: string
  /** Short label for the top bar badge. */
  label: string
  rpcUrl: string
  /** Tried when rpcUrl fails — mirrors agent-runtime/src/network.ts. */
  fallbackRpcUrls?: string[]
  explorerUrl: string
  explorerName: string
  nativeSymbol: string
  testnet: boolean
  /** Settlement token — MockUSDT on BSC Testnet, USDT on BOT Chain. */
  usdtAddress: Address
  /** What the UI calls the settlement token. */
  tokenSymbol: string
  /** True when the settlement token is MockUSDT, which has a public faucet(). */
  tokenHasFaucet: boolean
  /** Where users get native gas tokens for this network (outside the app). */
  gasFaucets: FaucetLink[]
  /** Multicall3, when deployed on this chain — batches contract reads. */
  multicall3?: Address
  /** Largest block span per eth_getLogs call the default RPC accepts (with margin). */
  logRange: bigint
  /** Blocks of log history the default RPC keeps (null = full history). */
  logHistory: bigint | null
  /** Native gas sent to a hosted agent's wallet at activation. */
  agentGasTopup: string
  deployment?: { agentEcoAddress: Address; deployBlock: bigint }
}

// Each preset verified against its RPC's eth_chainId; faucet URLs checked live.
const PRESETS: Record<NetworkName, NetworkPreset> = {
  'bsc-testnet': {
    chainId: 97,
    name: 'BSC Testnet',
    label: 'BSC Testnet',
    // PublicNode, not the official data-seed nodes: those reject eth_getLogs,
    // which every escrow/dispute scan here needs. 50,000 blocks per call.
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
    fallbackRpcUrls: ['https://bsc-testnet-dataseed.bnbchain.org', 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'],
    explorerUrl: 'https://testnet.bscscan.com',
    explorerName: 'BscScan Testnet',
    nativeSymbol: 'tBNB',
    testnet: true,
    usdtAddress: '0xae0BbCf2Ec6cbE83C39927e9A087c9486E51Cea7',
    tokenSymbol: 'mUSDT',
    tokenHasFaucet: true,
    gasFaucets: [
      { label: 'QuickNode BNB testnet faucet', url: 'https://faucet.quicknode.com/binance-smart-chain/bnb-testnet' },
      { label: 'BNB Chain Telegram bot (@bnbchain_official_bot)', url: 'https://t.me/bnbchain_official_bot' },
    ],
    // BSC Testnet gas is ~0.1–3 gwei; one job costs well under 0.001 tBNB.
    agentGasTopup: '0.005',
    logHistory: BigInt(75000),
    logRange: BigInt(45000),
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    deployment: {
      agentEcoAddress: '0x8bdff809013c28aA8a85038660D9d6E8d2c0294b',
      deployBlock: BigInt(133381113),
    },
  },
  'bot-testnet': {
    chainId: 968,
    name: 'BOT Chain Testnet',
    label: 'BOT Testnet',
    rpcUrl: 'https://rpc.bohr.life',
    explorerUrl: 'https://scan.bohr.life',
    explorerName: 'BOT Chain Explorer',
    nativeSymbol: 'BOT',
    testnet: true,
    usdtAddress: '0x75edC9335175Fc0552D51D48439F229c10420fe3',
    tokenSymbol: 'USDT',
    tokenHasFaucet: false,
    gasFaucets: [],
    // BOT Chain gas is ~20 gwei.
    agentGasTopup: '0.08',
    logHistory: null,
    logRange: BigInt(500000),
  },
  'bot-mainnet': {
    chainId: 677,
    name: 'BOT Chain Mainnet',
    label: 'BOT Mainnet',
    rpcUrl: 'https://rpc.botchain.ai',
    explorerUrl: 'https://scan.botchain.ai',
    explorerName: 'BOT Chain Explorer',
    nativeSymbol: 'BOT',
    testnet: false,
    usdtAddress: '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C',
    tokenSymbol: 'USDT',
    tokenHasFaucet: false,
    gasFaucets: [],
    // BOT Chain gas is ~20 gwei.
    agentGasTopup: '0.08',
    logHistory: null,
    logRange: BigInt(500000),
  },
}

// Names from before the BSC Testnet deployment.
const ALIASES: Record<string, NetworkName> = { testnet: 'bot-testnet', mainnet: 'bot-mainnet' }

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readNetwork(raw: string | undefined): NetworkName {
  const value = (clean(raw) ?? 'bsc-testnet').toLowerCase()
  const name = ALIASES[value] ?? value
  if (!(name in PRESETS)) {
    throw new Error(`NEXT_PUBLIC_NETWORK must be one of ${Object.keys(PRESETS).join(', ')}, got: ${value}`)
  }
  return name as NetworkName
}

export const NETWORK: NetworkName = readNetwork(process.env.NEXT_PUBLIC_NETWORK)
const preset = PRESETS[NETWORK]

function readAddress(name: string, raw: string | undefined, fallback: Address | undefined): Address {
  const value = clean(raw) ?? fallback
  if (!value) throw new Error(`${name} must be set when NEXT_PUBLIC_NETWORK=${NETWORK} — there is no default deployment for it.`)
  if (!isAddress(value)) throw new Error(`${name} is not a valid EVM address: ${value}`)
  return value
}

function readBlock(raw: string | undefined, fallback: bigint | undefined): bigint {
  const value = clean(raw)
  if (!value) {
    if (fallback === undefined) throw new Error(`NEXT_PUBLIC_DEPLOY_BLOCK must be set when NEXT_PUBLIC_NETWORK=${NETWORK}.`)
    return fallback
  }
  try {
    return BigInt(value)
  } catch {
    throw new Error(`NEXT_PUBLIC_DEPLOY_BLOCK must be an integer block number, got: ${value}`)
  }
}

function readNumber(name: string, raw: string | undefined, fallback: number): number {
  const value = clean(raw)
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got: ${value}`)
  return n
}

export const CHAIN_ID = preset.chainId
export const CHAIN_NAME = preset.name
export const NETWORK_LABEL = preset.label
export const IS_TESTNET = preset.testnet
export const RPC_URL = clean(process.env.NEXT_PUBLIC_RPC_URL) ?? preset.rpcUrl
/** RPC_URL, then fallbacks (NEXT_PUBLIC_RPC_FALLBACK_URLS, comma-separated, or "none"). */
export const RPC_URLS: string[] = [
  RPC_URL,
  ...(clean(process.env.NEXT_PUBLIC_RPC_FALLBACK_URLS)?.toLowerCase() === 'none'
    ? []
    : (clean(process.env.NEXT_PUBLIC_RPC_FALLBACK_URLS)?.split(',').map((u) => u.trim()).filter(Boolean) ?? preset.fallbackRpcUrls ?? [])),
].filter((url, i, all) => all.indexOf(url) === i)
export const EXPLORER_URL = preset.explorerUrl
/** Block span per eth_getLogs call for this network's RPC. */
export const LOG_RANGE = preset.logRange
export const MULTICALL3 = preset.multicall3
/**
 * How far back the default RPC still serves logs (PublicNode on BSC Testnet
 * prunes after ~80,000 blocks). Log scans — only used for explorer links —
 * never reach further back; escrow discovery reads contract state instead.
 */
export const LOG_HISTORY_BLOCKS = preset.logHistory
export const EXPLORER_NAME = preset.explorerName
export const NATIVE_SYMBOL = preset.nativeSymbol
export const TOKEN_SYMBOL = preset.tokenSymbol
export const TOKEN_HAS_FAUCET = preset.tokenHasFaucet
export const GAS_FAUCETS = preset.gasFaucets

/** Below this native balance the app asks for gas before anything else (default 0.002). */
/** Native gas sent to a hosted agent's wallet at activation (NEXT_PUBLIC_AGENT_GAS_TOPUP overrides). */
export const AGENT_GAS_TOPUP = clean(process.env.NEXT_PUBLIC_AGENT_GAS_TOPUP) ?? preset.agentGasTopup

export const MIN_NATIVE_BALANCE = readNumber('NEXT_PUBLIC_MIN_TBNB', process.env.NEXT_PUBLIC_MIN_TBNB, 0.002)

export const AGENT_ECO_ADDRESS = readAddress(
  'NEXT_PUBLIC_AGENT_ECO_ADDRESS',
  process.env.NEXT_PUBLIC_AGENT_ECO_ADDRESS,
  preset.deployment?.agentEcoAddress
)
export const USDT_ADDRESS = readAddress(
  'NEXT_PUBLIC_USDT_ADDRESS',
  process.env.NEXT_PUBLIC_USDT_ADDRESS,
  preset.usdtAddress
)
/** Block AgentEco.sol was deployed at — every event-log scan starts here. */
export const DEPLOY_BLOCK = readBlock(process.env.NEXT_PUBLIC_DEPLOY_BLOCK, preset.deployment?.deployBlock)

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}
