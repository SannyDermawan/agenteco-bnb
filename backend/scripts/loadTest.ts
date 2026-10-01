/**
 * Load test (spec §15.3): LOAD_BUYERS hosted buyers (default 5, spec 5–10)
 * hire sellers at the same time on BSC Testnet, the whole agent ↔ agent flow
 * — negotiate, fund, execute, verify, settle or dispute. Reports each
 * transaction's time and outcome, the average time, how many AI calls hit
 * HTTP 429, and how many fell back to rules/code per stage.
 *
 *   npm run load-test      (from backend/, with the API and host running)
 *
 * Buyers are funded by minting MockUSDT with the owner key (not the faucet),
 * plus a little gas. They belong to the same owner as the seeded demo
 * sellers, so their ratings never count toward the public averages.
 *
 * Env: AGENTECO_API_URL (default http://localhost:4000), LOAD_OWNER_PRIVATE_KEY
 * (default DEPLOYER_PRIVATE_KEY — must own MockUSDT to mint), LOAD_BUYERS,
 * LOAD_TIMEOUT_MIN (default 25).
 */
import { createPublicClient, createWalletClient, formatEther, nonceManager, parseEther, parseUnits, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { buildAuthHeaders } from '../../agent-runtime/src/authHeaders.ts'
import { AGENT_ECO_ABI, MOCK_USDT_ABI } from '../../agent-runtime/src/shared/abi.generated.ts'
import { CAPABILITY_IDS, type CapabilityId } from '../../agent-runtime/src/shared/capabilities/definitions.ts'
import { AGENT_ECO_ADDRESS, NATIVE_SYMBOL, TOKEN_SYMBOL, USDT_ADDRESS, appChain } from '../../agent-runtime/src/network.ts'
import { appTransport } from '../src/network.ts'

const API = (process.env.AGENTECO_API_URL?.trim() || 'http://localhost:4000').replace(/\/+$/, '')
const ownerKey = (process.env.LOAD_OWNER_PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim()) as `0x${string}` | undefined
if (!ownerKey) throw new Error('Set LOAD_OWNER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) — the MockUSDT owner.')
const BUYERS = Math.min(10, Math.max(1, Number(process.env.LOAD_BUYERS ?? 5)))
const TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MIN ?? 25) * 60_000
const BUYER_GAS = parseEther('0.004')
const STATUS = ['CREATED', 'FUNDED', 'EXECUTING', 'DELIVERED', 'DISPUTED', 'SETTLED', 'REFUNDED']

const owner = privateKeyToAccount(ownerKey, { nonceManager })
const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })
const wallet = createWalletClient({ account: owner, chain: appChain, transport: appTransport() })
const RUN = Date.now().toString(36).slice(-4)
const t0 = Date.now()
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One realistic brief per capability. The crypto brief always asks for the
// same coins, so concurrent jobs share the 60 s CoinGecko cache.
const BRIEFS: Record<CapabilityId, { brief: unknown; criteria: string }> = {
  translation: {
    brief: { text: 'Our weekly demo is on Friday at 3 pm. Please bring your laptop and the updated slides.', targetLanguage: 'id', tone: 'casual' },
    criteria: 'Every sentence translated; times and names unchanged.',
  },
  data_analysis: {
    brief: {
      csv: ['week,signups,churn', '2026-08-03,120,9', '2026-08-10,134,11', '2026-08-17,151,8', '2026-08-24,149,12', '2026-08-31,170,10'].join('\n'),
      question: 'Is signup growth outpacing churn?',
    },
    criteria: 'Report mean and max for every numeric column and answer the question.',
  },
  crypto_market_brief: { brief: { coins: ['bitcoin', 'ethereum'], horizon: '24h' }, criteria: 'Cover both coins with their 24h change.' },
  // AgentEco's own deployment transaction — always available on BSC Testnet.
  tx_explainer: {
    brief: { txHash: '0x3446b954d5c08b42d6cedf46af23304a242f9acaa59eccb5c36560c8303e99e6' },
    criteria: 'Say what was deployed and by whom.',
  },
}

interface Agent {
  id: string
  name: string
  price: string
  capabilities: string[]
  walletAddress: string | null
  taskStatus: string | null
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(await buildAuthHeaders(owner)) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

async function send(tx: Promise<`0x${string}`>): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await tx })
  if (receipt.status !== 'success') throw new Error(`transaction ${receipt.transactionHash} reverted`)
}

interface Run {
  buyer: Agent
  capability: CapabilityId
  startedAt: number
  endedAt?: number
  escrowId?: string
  status?: string
  price?: string
  score?: number | null
  disputed?: boolean
  resolution?: string | null
}

async function main(): Promise<void> {
  const sellers = await api<Agent[]>('GET', '/agents?role=seller&isOnline=true')
  const offered = CAPABILITY_IDS.filter((c) => sellers.some((s) => s.capabilities.includes(c) && s.walletAddress))
  if (offered.length === 0) throw new Error('No online sellers — run `npm run seed:sellers` and start the host first.')

  // Budget: the dearest online seller of the capability, so every buyer can afford a deal.
  const plan = Array.from({ length: BUYERS }, (_, i) => {
    const capability = offered[i % offered.length]
    const maxBudget = Math.max(...sellers.filter((s) => s.capabilities.includes(capability)).map((s) => Number(s.price)))
    return { capability, maxBudget }
  })
  const total = plan.reduce((sum, p) => sum + p.maxBudget, 0)
  const decimals = await publicClient.readContract({ address: USDT_ADDRESS, abi: MOCK_USDT_ABI, functionName: 'decimals' })
  log(`run ${RUN}: ${BUYERS} buyers over ${offered.join(', ')} — ${total.toFixed(2)} ${TOKEN_SYMBOL} + ${formatEther(BUYER_GAS * BigInt(BUYERS))} ${NATIVE_SYMBOL}`)

  await send(wallet.writeContract({ address: USDT_ADDRESS, abi: MOCK_USDT_ABI, functionName: 'mint', args: [owner.address, parseUnits(total.toFixed(6), decimals)] }))
  log(`minted ${total.toFixed(2)} ${TOKEN_SYMBOL} to the owner`)

  // Create and fund every buyer first, then activate them together so they start at the same moment.
  const created: { agent: Agent; capability: CapabilityId }[] = []
  for (const [i, p] of plan.entries()) {
    const agent = await api<Agent>('POST', '/agents', {
      name: `Load ${RUN}-${i + 1} (${p.capability})`,
      role: 'buyer',
      capabilities: [p.capability],
      price: 0,
      maxBudget: p.maxBudget,
      taskBrief: BRIEFS[p.capability].brief,
      acceptanceCriteria: BRIEFS[p.capability].criteria,
    })
    const to = agent.walletAddress as Address
    await send(wallet.writeContract({ address: USDT_ADDRESS, abi: MOCK_USDT_ABI, functionName: 'transfer', args: [to, parseUnits(p.maxBudget.toFixed(6), decimals)] }))
    await send(wallet.sendTransaction({ to, value: BUYER_GAS }))
    created.push({ agent, capability: p.capability })
    log(`buyer ${i + 1}/${BUYERS} funded: ${agent.name}`)
  }

  const since = new Date().toISOString()
  const runs: Run[] = await Promise.all(
    created.map(async ({ agent, capability }) => {
      await api('POST', `/agents/${agent.id}/activate`)
      return { buyer: agent, capability, startedAt: Date.now() }
    })
  )
  log(`all ${BUYERS} buyers active — the host takes over`)

  const deadline = Date.now() + TIMEOUT_MS
  while (runs.some((r) => !r.endedAt) && Date.now() < deadline) {
    await sleep(10_000)
    for (const r of runs.filter((x) => !x.endedAt)) {
      try {
        const [order] = await api<{ escrowId: string | null; price: string }[]>('GET', `/orders?agentId=${r.buyer.id}`)
        if (!order?.escrowId) continue
        r.escrowId = order.escrowId
        r.price = order.price
        const [, , , status] = await publicClient.readContract({ address: AGENT_ECO_ADDRESS, abi: AGENT_ECO_ABI, functionName: 'getEscrowBasic', args: [BigInt(order.escrowId)] })
        const label = STATUS[Number(status)]
        if (label !== r.status) log(`${r.buyer.name}: escrow #${order.escrowId} ${label}`)
        r.status = label
        if (label === 'DISPUTED') r.disputed = true
        const agent = await api<Agent>('GET', `/agents/${r.buyer.id}`)
        if ((label === 'SETTLED' || label === 'REFUNDED') && agent.taskStatus === 'completed') {
          r.endedAt = Date.now()
          const v = await fetch(`${API}/verifications/${order.escrowId}`, { headers: await buildAuthHeaders(owner) })
          r.score = v.ok ? ((await v.json()) as { score: number | null }).score : undefined
          const d = await fetch(`${API}/disputes/${order.escrowId}`, { headers: await buildAuthHeaders(owner) })
          if (d.ok) {
            r.disputed = true
            r.resolution = ((await d.json()) as { resolution: string | null }).resolution
          }
        }
      } catch (error) {
        log(`${r.buyer.name}: poll error (${(error as Error).message.slice(0, 80)}) — retrying`)
      }
    }
  }

  // ---- Report -------------------------------------------------------------
  console.log('\n=== Load test report ===')
  for (const r of runs) {
    const secs = r.endedAt ? `${((r.endedAt - r.startedAt) / 1000).toFixed(0)}s` : 'not finished'
    console.log(
      `${r.buyer.name.padEnd(34)} escrow #${r.escrowId ?? '-'} ${String(r.status ?? '-').padEnd(9)} ${r.price ?? '-'} ${TOKEN_SYMBOL}` +
        `  verify ${r.score ?? '-'}  ${r.disputed ? `dispute→${r.resolution ?? 'open'}` : ''}  ${secs}`
    )
  }
  const done = runs.filter((r) => r.endedAt)
  const avg = done.length ? done.reduce((s, r) => s + (r.endedAt! - r.startedAt), 0) / done.length / 1000 : 0
  console.log(`\nFinished ${done.length}/${runs.length}; average ${avg.toFixed(0)}s from activation to a final escrow.`)

  // Fallbacks visible in the data each stage produced.
  let ruleMoves = 0
  let aiMoves = 0
  let unscored = 0
  for (const r of runs) {
    const orders = await api<{ negotiation: { messages: { source: string }[] } }[]>('GET', `/orders?agentId=${r.buyer.id}`)
    for (const m of orders[0]?.negotiation.messages ?? []) (m.source === 'ai' ? aiMoves++ : ruleMoves++)
    if (!r.escrowId) continue
    if (r.score === null) unscored++
  }
  const stats = (await (await fetch(`${API}/ai-calls/stats?since=${encodeURIComponent(since)}`)).json()) as {
    byTask: Record<string, Record<string, number>>
    totals: { attempts: number; ok: number; rateLimited: number; fallbacks: number }
  }
  console.log(`\nAI calls: ${stats.totals.attempts} attempts, ${stats.totals.ok} ok, ${stats.totals.rateLimited} × HTTP 429, ${stats.totals.fallbacks} fell back to rules/code.`)
  for (const [task, outcomes] of Object.entries(stats.byTask)) {
    console.log(`  ${task.padEnd(15)} ${Object.entries(outcomes).map(([k, v]) => `${k}=${v}`).join('  ')}`)
  }
  console.log(`Negotiation moves: ${aiMoves} by AI, ${ruleMoves} rule-based (includes buyers' fixed opening offers).`)
  console.log(`Verifications without a score: ${unscored}.`)
  process.exit(done.length === runs.length ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
