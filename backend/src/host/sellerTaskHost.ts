import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, type Address, type PublicClient } from 'viem'
import {
  DemoAgentRuntime,
  respondToNegotiation,
  listNegotiationsForAgent,
  countOffersBySide,
  isMyTurn,
  createOnchainClients,
  startOnchainExecution,
  markOnchainDelivered,
  getEscrowStatus,
  publishEscrowResult,
  getDispute,
  getEscrowDisputeInfo,
  getEscrowHashes,
  submitDisputeResponseOnchain,
  submitDisputeResponseText,
  type OnchainClients,
} from '../../../agent-runtime/src/index.ts'
import { SELLER_RESPONSE_WINDOW_SECONDS } from '../../../agent-runtime/src/durations.ts'
import { defendDispute } from '../ai/judge.ts'
import { NEGOTIATION_ROUNDS } from '../../../agent-runtime/src/runtime.ts'
import { getTaskByEscrow } from '../../../agent-runtime/src/tasksClient.ts'
import { AGENT_ECO_ABI } from '../../../agent-runtime/src/shared/abi.generated.ts'
import { hashPreimage, resultHash, textHash } from '../../../agent-runtime/src/shared/hashes.ts'
import { isCapabilityId } from '../../../agent-runtime/src/shared/capabilities/definitions.ts'
import { prepareJob, runJob } from '../capabilities/execute.ts'
import { decideTurn } from '../ai/negotiate.ts'
import { buildNegotiationExtras } from './negotiationContext.ts'
import { decryptAgentKey } from '../agentKeyCrypto.ts'
import { prismaWithAgentKey } from '../db.ts'
import { log, logError } from '../log.ts'
import { warnIfLowGas } from '../gasWatch.ts'
import { API_URL, refundLeftover } from './buyerTaskHost.ts'
import { AGENT_ECO_ADDRESS, RPC_URL, TOKEN_SYMBOL, appChain, appTransport } from '../network.ts'
import { readAllEscrows, type EscrowBasic } from '../../../agent-runtime/src/onchain/escrowIndex.ts'

// AgentEco.sol OrderStatus enum ordering.
const ON_CHAIN_CREATED = 0
const ON_CHAIN_FUNDED = 1
const ON_CHAIN_EXECUTING = 2
const ON_CHAIN_DELIVERED = 3
const ON_CHAIN_DISPUTED = 4
const ON_CHAIN_SETTLED = 5

export interface HostedSellerAgentRow {
  id: string
  name: string
  capabilities: string[]
  price: unknown // Prisma.Decimal
  minimumPrice: unknown
  walletAddress: string | null
  agentWalletKey: string | null
  depositorWallet: string | null
  escrowScanBlock: bigint | null
  /** Seller's style guide for the model (≤ 500 chars) — see prompts/execute.ts. */
  customInstructions: string | null
}

/**
 * Escrows each seller has nothing left to do on, in memory only. After a host
 * restart everything is re-checked once — every step below is idempotent
 * against on-chain status, so that never double-executes anything.
 */
const finishedEscrows = new Map<string, Set<bigint>>()

/**
 * Results already committed on-chain (markDelivered) whose publish to the API
 * failed. The model's output isn't reproducible, so the exact object is kept
 * here and retried every cycle until the API has it.
 */
const unpublished = new Map<bigint, { capability: string; result: Record<string, unknown> }>()

/** Funded escrows already logged as waiting for their brief — logged once, not every cycle. */
const waitingForTask = new Set<bigint>()

/** Disputes this seller has answered, or decided not to answer. */
const defended = new Set<bigint>()
/** Responses committed on-chain whose text hasn't reached the API yet (exact string, retried). */
const pendingResponses = new Map<bigint, string>()
/** Delivered escrows logged as missing their published result. */
const missingResultLogged = new Set<bigint>()

const ZERO_HASH = `0x${'0'.repeat(64)}`

const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })

async function hasPublishedResult(escrowId: bigint): Promise<boolean> {
  const res = await fetch(`${API_URL}/escrow-results/${escrowId}`)
  return res.ok
}

async function onchainTaskHash(client: PublicClient, escrowId: bigint): Promise<`0x${string}`> {
  const [taskHash] = await client.readContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowHashes',
    args: [escrowId],
  })
  return taskHash
}

async function publishPending(label: string, escrowId: bigint): Promise<boolean> {
  const pending = unpublished.get(escrowId)
  if (!pending) return false
  try {
    await publishEscrowResult(API_URL, escrowId.toString(), pending.capability, pending.result)
    unpublished.delete(escrowId)
    log(`[host:${label}] escrow #${escrowId}: result published.`)
    return true
  } catch (error) {
    logError(`[host:${label}] escrow #${escrowId}: result publish failed — will retry`, error, 'HOST')
    return false
  }
}

/**
 * Works one escrow as far as it can go this cycle (spec §7, §8.3):
 * FUNDED → read the task from the API, check it against the on-chain
 * taskHash, validate the brief and compute the code part → startExecution →
 * AI → markDelivered(resultHash) → publish the result. Returns true once
 * there's nothing left for the seller to do on it.
 *
 * Never starting execution on a bad task is deliberate: the accept timeout
 * then refunds the buyer. Once started, a job that can't be delivered
 * (translation without AI) is left to the execution timeout.
 */
async function advanceEscrow(
  agentRow: HostedSellerAgentRow,
  onchain: OnchainClients,
  escrowId: bigint
): Promise<boolean> {
  const label = agentRow.name
  const status = await getEscrowStatus(onchain, escrowId)

  if (status === ON_CHAIN_FUNDED || status === ON_CHAIN_EXECUTING) {
    // The buyer links the task right after funding — until then, wait.
    const task = await getTaskByEscrow(API_URL, escrowId.toString())
    if (!task) {
      if (!waitingForTask.has(escrowId)) log(`[host:${label}] escrow #${escrowId} is funded — waiting for its task brief…`)
      waitingForTask.add(escrowId)
      return false
    }

    const expected = await onchainTaskHash(onchain.publicClient, escrowId)
    if (hashPreimage(task.preimage).toLowerCase() !== expected.toLowerCase()) {
      log(`[host:${label}] escrow #${escrowId}: stored task does not match the on-chain taskHash — not starting.`)
      return true
    }
    if (task.seller.toLowerCase() !== onchain.account.address.toLowerCase()) {
      log(`[host:${label}] escrow #${escrowId}: task names a different seller — not starting.`)
      return true
    }
    if (!isCapabilityId(task.capability) || !agentRow.capabilities.includes(task.capability)) {
      log(`[host:${label}] escrow #${escrowId}: this seller does not offer "${task.capability}" — not starting.`)
      return true
    }

    const ctx = { publicClient: onchain.publicClient, agentEcoAddress: AGENT_ECO_ADDRESS }
    const prepared = await prepareJob(task.capability, task.brief, ctx)
    if (!prepared.ok) {
      log(`[host:${label}] escrow #${escrowId}: ${prepared.reason} — not starting; the accept timeout refunds the buyer.`)
      return true
    }

    if (status === ON_CHAIN_FUNDED) {
      log(`[host:${label}] escrow #${escrowId}: brief is valid — starting execution…`)
      await startOnchainExecution(onchain, escrowId)
    }

    const outcome = await runJob(prepared.job, {
      ...ctx,
      agentId: agentRow.id,
      customInstructions: agentRow.customInstructions,
      criteria: task.criteria,
    })
    if (!outcome.deliver) {
      log(`[host:${label}] escrow #${escrowId}: ${outcome.reason} The execution timeout refunds the buyer.`)
      return true
    }

    const result = outcome.result as Record<string, unknown>
    await markOnchainDelivered(onchain, escrowId, resultHash(result))
    log(
      `[host:${label}] escrow #${escrowId} marked delivered` +
        (outcome.ai ? ` (${outcome.ai.provider}/${outcome.ai.model}).` : ' (AI unavailable — code-only result).')
    )
    unpublished.set(escrowId, { capability: task.capability, result })
    await publishPending(label, escrowId)
    // Keep watching: the buyer can still dispute a delivered result.
    return false
  }

  if (status === ON_CHAIN_DELIVERED || status === ON_CHAIN_SETTLED || status === ON_CHAIN_DISPUTED) {
    if (unpublished.has(escrowId)) {
      await publishPending(label, escrowId)
    } else if (!missingResultLogged.has(escrowId) && !(await hasPublishedResult(escrowId))) {
      // Delivered before a restart whose publish never landed: the exact
      // result is gone, so there's nothing to re-send.
      missingResultLogged.add(escrowId)
      log(`[host:${label}] escrow #${escrowId}: delivered but its result was never published and is no longer in memory.`)
    }
    if (status === ON_CHAIN_DISPUTED) await defendIfDue(agentRow, onchain, escrowId)
    // Done once paid out; a delivered or disputed escrow is still open.
    return status === ON_CHAIN_SETTLED && !unpublished.has(escrowId)
  }

  // CREATED (not funded yet) keeps waiting; REFUNDED is terminal.
  return status !== ON_CHAIN_CREATED
}

async function sendPendingResponse(label: string, onchain: OnchainClients, escrowId: bigint): Promise<void> {
  const response = pendingResponses.get(escrowId)
  if (!response) return
  try {
    await submitDisputeResponseText(API_URL, onchain.account, escrowId.toString(), response, 'ai')
    pendingResponses.delete(escrowId)
    defended.add(escrowId)
    log(`[host:${label}] escrow #${escrowId}: dispute response saved.`)
  } catch (error) {
    logError(`[host:${label}] escrow #${escrowId}: dispute response not saved yet — will retry`, error, 'HOST')
  }
}

/**
 * The hosted seller's side of a dispute (spec §11 step 2): once the buyer's
 * reason is readable, the model writes a response grounded in the brief and
 * the result; its hash goes on-chain, then the text to the API. Only within
 * SELLER_RESPONSE_WINDOW_SECONDS — after that the arbiter decides without it.
 */
async function defendIfDue(agentRow: HostedSellerAgentRow, onchain: OnchainClients, escrowId: bigint): Promise<void> {
  const label = agentRow.name
  if (pendingResponses.has(escrowId)) return sendPendingResponse(label, onchain, escrowId)
  if (defended.has(escrowId)) return

  const { disputeResponseHash } = await getEscrowHashes(onchain, escrowId)
  if (disputeResponseHash !== ZERO_HASH) {
    defended.add(escrowId) // answered before a restart
    return
  }
  const { disputedAt } = await getEscrowDisputeInfo(onchain, escrowId)
  if (BigInt(Math.floor(Date.now() / 1000)) > disputedAt + BigInt(SELLER_RESPONSE_WINDOW_SECONDS)) {
    defended.add(escrowId)
    log(`[host:${label}] escrow #${escrowId}: the response window has passed — not responding.`)
    return
  }

  // The buyer's reason reaches the API right after raiseDispute.
  const dispute = await getDispute(API_URL, escrowId.toString())
  if (!dispute) return
  const [task, resultRes] = await Promise.all([
    getTaskByEscrow(API_URL, escrowId.toString()),
    fetch(`${API_URL}/escrow-results/${escrowId}`),
  ])
  const stored = resultRes.ok ? ((await resultRes.json()) as { resultJson: string | null }) : null
  if (!task || !stored?.resultJson || !isCapabilityId(task.capability)) {
    defended.add(escrowId)
    log(`[host:${label}] escrow #${escrowId}: brief or result unavailable — not responding.`)
    return
  }

  const defense = await defendDispute(
    { capability: task.capability, brief: task.brief, criteria: task.criteria, result: JSON.parse(stored.resultJson) },
    dispute.reason,
    { agentId: agentRow.id }
  )
  if (!defense) {
    defended.add(escrowId)
    log(`[host:${label}] escrow #${escrowId}: AI unavailable — no dispute response; the arbiter sees "no response".`)
    return
  }
  log(`[host:${label}] escrow #${escrowId}: answering the dispute (${defense.provider}/${defense.model})…`)
  await submitDisputeResponseOnchain(onchain, escrowId, textHash(defense.response))
  pendingResponses.set(escrowId, defense.response)
  await sendPendingResponse(label, onchain, escrowId)
}

/**
 * @param myEscrows every escrow naming this agent's wallet as seller — read
 *   from contract state by the caller, once per cycle for all sellers.
 */
export async function processHostedSellerTask(agentRow: HostedSellerAgentRow, myEscrows: EscrowBasic[]): Promise<void> {
  if (!agentRow.agentWalletKey || !agentRow.depositorWallet) return
  if (agentRow.capabilities.length === 0) return

  const privateKey = decryptAgentKey(agentRow.agentWalletKey)
  const account = privateKeyToAccount(privateKey)
  const onchain = createOnchainClients(privateKey, RPC_URL)
  await warnIfLowGas(onchain.publicClient, account.address, `hosted seller "${agentRow.name}"`, 'hosted')

  const listingPrice = Number(agentRow.price)
  const runtime = new DemoAgentRuntime({
    name: agentRow.name,
    role: 'seller',
    capabilities: agentRow.capabilities,
    description: 'Hosted seller agent.',
    basePrice: listingPrice,
    minimumPrice: agentRow.minimumPrice != null ? Number(agentRow.minimumPrice) : undefined,
  })

  // 1. Answer every negotiation waiting on the seller. Isolated so an API
  //    outage never blocks step 2 — funded escrows are on-chain obligations
  //    with an execution deadline, and only need the chain to be worked.
  try {
    const negotiations = await listNegotiationsForAgent(API_URL, agentRow.id, 'open')
    for (const negotiation of negotiations) {
      if (!isMyTurn(negotiation, 'seller')) continue
      const lastMessage = negotiation.messages[negotiation.messages.length - 1]
      const offeredPrice = Number(lastMessage.price)

      // The buyer's brief only feeds the job's size to the model, never its content.
      let taskBrief: unknown = null
      try {
        const buyerRes = await fetch(`${API_URL}/agents/${negotiation.buyerAgentId}`)
        if (buyerRes.ok) taskBrief = ((await buyerRes.json()) as { taskBrief?: unknown }).taskBrief ?? null
      } catch {
        taskBrief = null
      }
      const extras = await buildNegotiationExtras(API_URL, onchain.publicClient, negotiation, {
        taskBrief,
        sellerWallet: account.address,
      })
      const move = await decideTurn({
        runtime,
        offeredPrice,
        myPriorOfferCount: countOffersBySide(negotiation, 'seller'),
        listingPrice,
        maxRounds: NEGOTIATION_ROUNDS,
        capability: negotiation.capability,
        agentId: agentRow.id,
        ...extras,
      })
      log(
        `[host:${agentRow.name}] negotiation ${negotiation.id}: incoming ${offeredPrice} ${TOKEN_SYMBOL} -> ${move.action}` +
          (move.action === 'counter' ? ` (${move.price} ${TOKEN_SYMBOL})` : '') +
          ` [${move.source}${move.adjusted ? ', adjusted' : ''}]`
      )
      await respondToNegotiation(API_URL, account, negotiation.id, { side: 'seller', ...move })
    }
  } catch (error) {
    logError(`[host:${agentRow.name}] negotiations skipped this cycle`, error, 'HOST')
  }

  // 2. Work every escrow naming this wallet as seller — negotiated orders and
  //    direct "Request Service" hires alike, straight from contract state.
  let finished = finishedEscrows.get(agentRow.id)
  if (!finished) finishedEscrows.set(agentRow.id, (finished = new Set()))
  for (const escrow of myEscrows) {
    if (finished.has(escrow.id)) continue
    if (escrow.status === ON_CHAIN_FUNDED) log(`[host:${agentRow.name}] found funded escrow #${escrow.id}`)
    try {
      if (await advanceEscrow(agentRow, onchain, escrow.id)) finished.add(escrow.id)
    } catch (error) {
      // A transient RPC/API/CoinGecko failure — retried next cycle.
      logError(`[host:${agentRow.name}] escrow #${escrow.id} failed this cycle`, error, 'HOST')
    }
  }

  // 3. Sweep settled earnings out to the owner — the agent wallet is only
  //    an operating wallet, not where the seller's money should sit.
  await refundLeftover(onchain, agentRow.depositorWallet as Address, agentRow.name, 'paid out earnings of')
}

export async function runSellerHostCycleOnce(): Promise<void> {
  // The only place (besides the buyer host) allowed to read agentWalletKey — see db.ts.
  const activeSellers = await prismaWithAgentKey.agent.findMany({ where: { role: 'seller', taskStatus: 'active', deletedAt: null } })
  if (activeSellers.length === 0) return

  // One batched read of every escrow for all sellers — no event logs, so it
  // keeps working on RPCs that prune history.
  const bySeller = new Map<string, EscrowBasic[]>()
  for (const escrow of await readAllEscrows(publicClient)) {
    const key = escrow.seller.toLowerCase()
    bySeller.set(key, [...(bySeller.get(key) ?? []), escrow])
  }

  for (const agentRow of activeSellers) {
    try {
      await processHostedSellerTask(agentRow, bySeller.get(agentRow.walletAddress?.toLowerCase() ?? '') ?? [])
    } catch (error) {
      logError(`[host:${agentRow.name}] cycle failed`, error, 'HOST')
    }
  }
}
