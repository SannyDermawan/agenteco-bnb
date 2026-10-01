import type { Hex } from 'viem'
import { DemoAgentRuntime } from '../runtime.ts'
import { RPC_URL } from '../network.ts'
import { discoverAgents, registerOrSyncSelf, type DiscoveredAgent } from '../registryClient.ts'
import { countOffersBySide, isMyTurn, listNegotiationsForAgent, openNegotiation, respondToNegotiation } from '../negotiationClient.ts'
import { attachEscrowToOrder, listOrdersForAgent } from '../ordersClient.ts'
import { hireWithTask } from '../tasksClient.ts'
import { createOnchainClients } from '../onchain/clients.ts'
import { acceptAndSettle, getEscrowHashes, getEscrowStatus, raiseDispute, rateSeller } from '../onchain/escrow.ts'
import { getEscrowResult } from '../resultsClient.ts'
import { submitDisputeReason } from '../disputesClient.ts'
import { hashPreimage, textHash } from '../shared/hashes.ts'
import { resolveCapability } from './capability.ts'
import { scoreWithAi, type AiModel } from './ai.ts'
import { DEFAULT_API_URL, type Logger, consoleLogger, sleep } from './common.ts'

export type Review =
  | { accept: true; /** Optional on-chain rating for the seller, 1–100. */ rating?: number }
  | { accept: false; /** Why — goes to the seller and the arbiter (≥ 10 characters). */ reason: string }

export interface HireOptions {
  /** The buyer's wallet: it pays into escrow (needs the token plus a little native gas). */
  privateKey: Hex
  /** AgentEco API. Default: AGENTECO_API_URL, else the public testnet API. */
  apiUrl?: string
  /** What to buy: a platform capability id or a community one from the registry. */
  capability: string
  /** The task, matching the capability's input schema — checked before anything is paid. */
  brief: unknown
  /** What a good result must satisfy; the seller, verifiers and arbiter read it. */
  criteria?: string
  /** The most you will pay. Never revealed to the seller. */
  maxBudget: number
  /** A specific seller (agent id). Default: the cheapest online seller of the capability whose opening offer fits the budget. */
  sellerId?: string
  /**
   * Your own model (see openAiCompatible), used as the verifier when you pass no
   * `review`: it scores the delivery 0–100 against the capability's rubric and your
   * criteria — the same verifier AgentEco's hosted buyers use — and accepts at 60 or
   * more (rating the seller with the score), otherwise disputes with its reasons.
   * AgentEco provides no model for self-hosted agents; this one is yours.
   */
  ai?: AiModel
  /**
   * Decide on the delivered result (already checked against the output schema
   * and the on-chain hash). Default: your `ai` verifier when given, else accept.
   * Rejecting raises a dispute.
   */
  review?: (result: Record<string, unknown>) => Promise<Review> | Review
  /** Name of the buyer agent in the registry. Default "SDK buyer". */
  name?: string
  /** Give up waiting for a deal or a delivery after this long. Default 20 minutes. */
  timeoutMs?: number
  pollMs?: number
  log?: Logger
}

export interface HireResult {
  escrowId: bigint
  seller: { id: string; name: string; wallet: string }
  /** The agreed price. */
  price: string
  result: Record<string, unknown>
  /** settled = paid; disputed = the arbiter (or the dispute timeout) decides. */
  outcome: 'settled' | 'disputed'
}

// AgentEco.sol OrderStatus
const DELIVERED = 3
const REFUNDED = 6

/** The buyer opens at half the listing, like hosted buyers (lib/negotiationSim.ts). */
const OPENING_RATIO = 0.5
const cents = (n: number) => Math.round(n * 100) / 100

/**
 * Hire an agent in one call: find a seller, negotiate within your budget,
 * store the task and lock the agreed price in escrow, wait for delivery,
 * check the result against the on-chain hash and the capability's output
 * schema, then settle (or dispute). Resolves with the result.
 */
export async function hire(options: HireOptions): Promise<HireResult> {
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL
  const name = options.name ?? 'SDK buyer'
  const log = options.log ?? consoleLogger(name)
  const pollMs = options.pollMs ?? 3000
  const deadline = Date.now() + (options.timeoutMs ?? 20 * 60_000)
  const onchain = createOnchainClients(options.privateKey, RPC_URL)
  const account = onchain.account
  const waitStep = async (what: string) => {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(pollMs)
  }

  // 1. The brief must fit the capability before anyone is approached.
  const capability = await resolveCapability(apiUrl, options.capability)
  const brief = capability.checkBrief(options.brief)
  if (!brief.ok) throw new Error(`Invalid ${options.capability} brief: ${brief.error}`)

  // 2. A seller.
  let seller: DiscoveredAgent | undefined
  if (options.sellerId) {
    const res = await fetch(`${apiUrl}/agents/${options.sellerId}`)
    if (!res.ok) throw new Error(`Seller ${options.sellerId} not found (${res.status}).`)
    seller = (await res.json()) as DiscoveredAgent
  } else {
    const sellers = await discoverAgents(apiUrl, { role: 'seller', capability: options.capability, onlineOnly: true })
    seller = sellers
      .filter((s) => s.walletAddress && cents(Number(s.price) * OPENING_RATIO) <= options.maxBudget)
      .sort((a, b) => Number(a.price) - Number(b.price))[0]
  }
  if (!seller?.walletAddress) throw new Error(`No online seller of "${options.capability}" fits a budget of ${options.maxBudget}.`)
  const listing = Number(seller.price)
  log(`seller: ${seller.name} (${seller.id.slice(0, 8)}) lists ${listing}`)

  // 3. Negotiate: open at half the listing, concede toward min(budget, listing).
  const ceiling = Math.min(options.maxBudget, listing)
  const opening = Math.min(cents(listing * OPENING_RATIO), ceiling)
  const buyerAgent = await registerOrSyncSelf(
    {
      name,
      role: 'buyer',
      capabilities: [options.capability],
      description: 'Self-hosted buyer agent (AgentEco SDK).',
      basePrice: opening,
      maxBudget: ceiling,
    },
    { apiUrl, account, hosted: false }
  )
  const policy = new DemoAgentRuntime({ name, role: 'buyer', capabilities: [options.capability], description: '', basePrice: opening, maxBudget: ceiling })
  let negotiation = await openNegotiation(apiUrl, account, {
    buyerAgentId: buyerAgent.id,
    sellerAgentId: seller.id,
    capability: options.capability,
    price: opening,
    source: 'rule',
  })
  log(`offered ${opening}`)
  while (negotiation.status === 'open') {
    await waitStep('the seller to answer')
    const open = await listNegotiationsForAgent(apiUrl, account, buyerAgent.id)
    negotiation = open.find((n) => n.id === negotiation.id) ?? negotiation
    if (!isMyTurn(negotiation, 'buyer')) continue
    const offered = Number(negotiation.messages[negotiation.messages.length - 1].price)
    const decision = policy.decideOnOffer(offered, countOffersBySide(negotiation, 'buyer'))
    log(`seller asks ${offered} → ${decision.action}${decision.action === 'counter' ? ` ${decision.price}` : ''}`)
    negotiation = await respondToNegotiation(apiUrl, account, negotiation.id, {
      side: 'buyer',
      action: decision.action,
      ...(decision.action === 'counter' ? { price: decision.price } : {}),
      source: 'rule',
    })
  }
  if (negotiation.status !== 'accepted') throw new Error(`No deal with ${seller.name}: the prices never met.`)
  // Float noise from the policy's arithmetic (0.07000000000000001) never reaches the escrow amount.
  const price = String(Number(Number(negotiation.agreedPrice).toFixed(6)))
  log(`deal at ${price}`)

  // 4. Task → escrow → fund → link (the API checks the chain agrees), and record it on the order.
  const order = (await listOrdersForAgent(apiUrl, account, buyerAgent.id, 'agreed')).find((o) => o.negotiationId === negotiation.id)
  const { escrowId } = await hireWithTask(apiUrl, onchain, {
    capability: options.capability,
    brief: brief.brief,
    criteria: options.criteria ?? '',
    price,
    seller: seller.walletAddress as `0x${string}`,
  })
  if (order) await attachEscrowToOrder(apiUrl, account, order.id, escrowId.toString())
  log(`escrow #${escrowId} funded — waiting for delivery`)

  // 5. Delivery, then the plaintext result (published right after the hash).
  for (;;) {
    const status = await getEscrowStatus(onchain, escrowId)
    if (status === DELIVERED) break
    if (status === REFUNDED) throw new Error(`Escrow #${escrowId} was refunded — the seller did not take or finish the job.`)
    await waitStep(`escrow #${escrowId} to be delivered`)
  }
  let published = await getEscrowResult(apiUrl, escrowId.toString(), account)
  while (!published) {
    await waitStep(`the result of escrow #${escrowId}`)
    published = await getEscrowResult(apiUrl, escrowId.toString(), account)
  }
  // The exact committed text: the API's `result` object comes from jsonb, with its keys reordered.
  const committedJson = published.resultJson ?? JSON.stringify(published.result)
  const result = JSON.parse(committedJson) as Record<string, unknown>

  // 6. Trust nothing: the result must hash to what the seller committed, and fit the schema.
  const { resultHash: onchainHash } = await getEscrowHashes(onchain, escrowId)
  const problems: string[] = []
  if (hashPreimage(committedJson).toLowerCase() !== onchainHash.toLowerCase()) problems.push('the result does not match the hash committed on-chain')
  const shape = capability.checkResult(result)
  if (!shape.ok) problems.push(`the result does not match the ${options.capability} output schema (${shape.error})`)
  let review: Review
  if (problems.length) {
    review = { accept: false, reason: `Automatic check failed: ${problems.join('; ')}.` }
  } else if (options.review) {
    review = await options.review(result)
  } else if (options.ai) {
    const verdict = await scoreWithAi(
      options.ai,
      { capability: options.capability, label: capability.name, rubric: capability.rubric, examples: capability.examples, brief: brief.brief, criteria: options.criteria ?? '', result },
      { log }
    )
    if (!verdict) {
      // Like a hosted buyer without a model: accept, unscored, and don't rate.
      log('the verifier model did not answer — accepting without a score')
      review = { accept: true }
    } else {
      log(`verifier: ${verdict.score}/100 — ${verdict.rationale}`)
      review = verdict.accept
        ? { accept: true, rating: verdict.score }
        : { accept: false, reason: `AI verification scored ${verdict.score}/100 (accept threshold 60). ${verdict.rationale}`.slice(0, 1000) }
    }
  } else {
    review = { accept: true }
  }

  const sellerInfo = { id: seller.id, name: seller.name, wallet: seller.walletAddress }
  if (!review.accept) {
    const reason = review.reason.trim()
    if (reason.length < 10) throw new Error('A dispute reason needs at least 10 characters.')
    await raiseDispute(onchain, escrowId, textHash(reason))
    await submitDisputeReason(apiUrl, account, escrowId.toString(), reason)
    log(`escrow #${escrowId}: disputed — the arbiter decides`)
    return { escrowId, seller: sellerInfo, price, result, outcome: 'disputed' }
  }

  await acceptAndSettle(onchain, escrowId)
  log(`escrow #${escrowId}: accepted — ${price} paid to ${seller.name}`)
  if (review.rating !== undefined) {
    const score = Math.max(1, Math.min(100, Math.round(review.rating)))
    const tx = await rateSeller(onchain, escrowId, score)
    await fetch(`${apiUrl}/ratings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: tx }) }).catch(() => {})
    log(`rated ${score}/100`)
  }
  return { escrowId, seller: sellerInfo, price, result, outcome: 'settled' }
}
