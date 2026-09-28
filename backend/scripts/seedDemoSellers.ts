/**
 * Seeds the platform's demo sellers (spec §8.4): hosted agents owned by the
 * platform wallet, funded with gas and always online, so a judge's first
 * hosted buyer always finds someone to hire.
 *
 *   npm run seed:sellers            (from backend/, against AGENTECO_API_URL)
 *
 * Safe to run again: a seller that already exists (same owner and name) is
 * not recreated — only topped up with gas, activated and put back online.
 *
 * Env: AGENTECO_API_URL (default http://localhost:4000), SEED_OWNER_PRIVATE_KEY
 * (default DEPLOYER_PRIVATE_KEY — the owner of the demo sellers), SEED_GAS_TBNB
 * (gas each seller wallet is kept at, default 0.01).
 */
import { createPublicClient, createWalletClient, formatEther, nonceManager, parseEther, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { buildAuthHeaders } from '../../agent-runtime/src/authHeaders.ts'
import { CAPABILITIES, type CapabilityId } from '../../agent-runtime/src/shared/capabilities/definitions.ts'
import { NATIVE_SYMBOL, TOKEN_SYMBOL, appChain } from '../../agent-runtime/src/network.ts'
import { appTransport } from '../src/network.ts'

interface DemoSeller {
  name: string
  capability: CapabilityId
  price: number
  /** Negotiation limit — the lowest price it accepts. */
  minimumPrice: number
  description: string
  customInstructions: string
}

// Names and prices: the defaults of spec §8.4.
const SELLERS: DemoSeller[] = [
  {
    name: 'Translator Budget',
    capability: 'translation',
    price: 0.1,
    minimumPrice: 0.08,
    description: 'Quick, casual translations into 13 languages — natural rather than word-for-word.',
    customInstructions:
      'Use a relaxed, conversational tone unless the buyer asks for another. Prefer natural phrasing over literal translation. Keep names, numbers and formatting unchanged.',
  },
  {
    name: 'Translator Pro',
    capability: 'translation',
    price: 0.3,
    minimumPrice: 0.24,
    description: 'Formal, precise translations for business and legal text.',
    customInstructions:
      'Formal register. Preserve terminology, numbers, names and paragraph structure exactly. Add a note only for genuinely ambiguous terms.',
  },
  {
    name: 'Data Analyst',
    capability: 'data_analysis',
    price: 0.25,
    minimumPrice: 0.2,
    description: 'Statistics and trends for a CSV, explained in plain language.',
    customInstructions:
      "Lead with the direct answer to the buyer's question. Quote exact numbers from the statistics and point out outliers or a small sample size.",
  },
  {
    name: 'Crypto Brief',
    capability: 'crypto_market_brief',
    price: 0.2,
    minimumPrice: 0.15,
    description: 'Live CoinGecko market snapshot for up to three coins, with a short neutral analysis.',
    customInstructions: 'Neutral, factual tone. Mention the biggest mover first. Never predict prices or suggest trades.',
  },
  {
    name: 'Tx Explainer',
    capability: 'tx_explainer',
    price: 0.15,
    minimumPrice: 0.12,
    description: 'Explains any BSC Testnet transaction in plain English: who sent what, and what happened.',
    customInstructions:
      'Write for a non-technical reader: who sent what to whom, whether it succeeded, and what each event means. Stay under 150 words.',
  },
]

const API = (process.env.AGENTECO_API_URL?.trim() || 'http://localhost:4000').replace(/\/+$/, '')
const ownerKey = (process.env.SEED_OWNER_PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim()) as `0x${string}` | undefined
if (!ownerKey) throw new Error('Set SEED_OWNER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) — the wallet that owns and funds the demo sellers.')
const GAS_TARGET = parseEther(process.env.SEED_GAS_TBNB?.trim() || '0.01')

const owner = privateKeyToAccount(ownerKey, { nonceManager })
const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })
const wallet = createWalletClient({ account: owner, chain: appChain, transport: appTransport() })

interface ApiAgent {
  id: string
  name: string
  role: string
  walletAddress: string | null
  isOnline: boolean
  taskStatus: string | null
  deletedAt?: string | null
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : await buildAuthHeaders(owner)) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`)
  return JSON.parse(text) as T
}

/** Tops the seller's own wallet up to GAS_TARGET — it pays for its startExecution/markDelivered/dispute txs. */
async function ensureGas(name: string, address: Address): Promise<void> {
  const balance = await publicClient.getBalance({ address })
  if (balance >= GAS_TARGET) {
    console.log(`  ${name}: gas ${formatEther(balance)} ${NATIVE_SYMBOL} — ok`)
    return
  }
  const topUp = GAS_TARGET - balance
  const hash = await wallet.sendTransaction({ to: address, value: topUp })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log(`  ${name}: topped up ${formatEther(topUp)} ${NATIVE_SYMBOL}`)
}

async function main(): Promise<void> {
  console.log(`Seeding ${SELLERS.length} demo sellers on ${appChain.name} via ${API}`)
  console.log(`Owner ${owner.address} — ${formatEther(await publicClient.getBalance({ address: owner.address }))} ${NATIVE_SYMBOL}`)

  const mine = await api<ApiAgent[]>('GET', `/agents?ownerWallet=${owner.address}&role=seller`)

  for (const s of SELLERS) {
    let agent = mine.find((a) => a.name === s.name)
    if (!agent) {
      agent = await api<ApiAgent>('POST', '/agents', {
        name: s.name,
        role: 'seller',
        hosted: true,
        capabilities: [s.capability],
        description: s.description,
        category: CAPABILITIES[s.capability].category,
        service: CAPABILITIES[s.capability].label,
        price: s.price,
        minimumPrice: s.minimumPrice,
        customInstructions: s.customInstructions,
      })
      console.log(`${s.name}: created (${s.price} / floor ${s.minimumPrice} ${TOKEN_SYMBOL}) — wallet ${agent.walletAddress}`)
    } else {
      console.log(`${s.name}: exists (${agent.id})`)
    }
    if (!agent.walletAddress) throw new Error(`${s.name} has no hosted wallet — was it created without hosted: true?`)

    await ensureGas(s.name, agent.walletAddress as Address)
    if (agent.taskStatus === 'awaiting_deposit') {
      agent = await api<ApiAgent>('POST', `/agents/${agent.id}/activate`)
      console.log(`  ${s.name}: activated`)
    }
    if (!agent.isOnline) {
      agent = await api<ApiAgent>('PATCH', `/agents/${agent.id}`, { isOnline: true })
      console.log(`  ${s.name}: back online`)
    }
  }
  console.log('Done — the host serves them as soon as it is running.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
