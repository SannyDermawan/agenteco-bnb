import type { Hex } from 'viem'
import { DemoAgentRuntime } from '../runtime.ts'
import { AGENT_ECO_ADDRESS, RPC_URL } from '../network.ts'
import { registerOrSyncSelf } from '../registryClient.ts'
import { countOffersBySide, isMyTurn, listNegotiationsForAgent, respondToNegotiation } from '../negotiationClient.ts'
import { createOnchainClients } from '../onchain/clients.ts'
import { getEscrowDisputeInfo, getEscrowHashes, getEscrowStatus, markDelivered, startExecution, submitDisputeResponse } from '../onchain/escrow.ts'
import { readAllEscrows } from '../onchain/escrowIndex.ts'
import { hashPreimage, resultHash, textHash } from '../shared/hashes.ts'
import { isCapabilityId } from '../shared/capabilities/definitions.ts'
import { mentionsAiUnavailable, prepareJob, type PreparedJob } from '../capabilities/prepare.ts'
import { getTaskByEscrow } from '../tasksClient.ts'
import { getEscrowResult, publishEscrowResult } from '../resultsClient.ts'
import { getDispute, submitDisputeResponseText } from '../disputesClient.ts'
import { SELLER_RESPONSE_WINDOW_SECONDS } from '../durations.ts'
import { resolveCapability } from './capability.ts'
import { defendWithAi, runPlatformJob, type AiModel } from './ai.ts'
import { DEFAULT_API_URL, type Logger, consoleLogger, sleep } from './common.ts'

/** One paid job, handed to your code once the escrow is funded and the brief checks out. */
export interface Job {
  escrowId: bigint
  capability: string
  /** The buyer's brief, already validated against the capability's input schema. */
  brief: unknown
  /** What the buyer said a good result must satisfy ("" when none). */
  criteria: string
  /** The agreed price, in the settlement token (e.g. "0.08"). */
  price: string
  buyer: string
  /** Platform capabilities only: the data AgentEco's code computed (CSV stats, market data, tx facts). */
  prepared?: PreparedJob
}

export interface DisputeContext {
  escrowId: bigint
  job: Job
  /** What you delivered. */
  result: Record<string, unknown>
  /** The buyer's reason, when it has reached the API. */
  reason: string | null
}

export interface SellerAgentOptions {
  /** The seller's own wallet: it signs registry writes and on-chain moves, and is paid. Needs a little native gas. */
  privateKey: Hex
  /** AgentEco API. Default: AGENTECO_API_URL, else the public testnet API. */
  apiUrl?: string
  name: string
  description: string
  /** What you sell: a platform capability id, or one you published in the registry. */
  capability: string
  /** Listing price, and the lowest you will settle for (the floor is never shown to buyers). */
  price: number
  floor: number
  category?: 'Research' | 'Data' | 'Content' | 'Automation'
  /**
   * Your work. Return the result object; it must match the capability's output
   * schema (checked before anything is committed on-chain). Required for a
   * community capability. For a platform capability, pass this or `ai`.
   */
  handle?: (job: Job) => Promise<Record<string, unknown>>
  /**
   * Your own model (see openAiCompatible). AgentEco gives self-hosted agents no AI:
   * a platform capability is served by the same prompts AgentEco's hosted sellers
   * use, running on YOUR model and key, and disputes are answered by it too (unless
   * you pass respondToDispute). The four platform capabilities need an AI: with
   * neither `ai` nor `handle`, createSellerAgent throws. If the model fails when a
   * job comes, nothing is delivered and the contract's timeout refunds the buyer.
   */
  ai?: AiModel
  /** Style and focus for your model's prose (≤ 500 chars) — never the output shape. */
  instructions?: string
  /** Answer a buyer's dispute (≤ 1000 characters). Return null to stay silent. */
  respondToDispute?: (ctx: DisputeContext) => Promise<string | null>
  /** How often to poll for negotiations and escrows. Default 3000 ms. */
  pollMs?: number
  log?: Logger
}

export interface SellerAgent {
  /** The seller wallet's address. */
  readonly address: `0x${string}`
  /** Registers (or syncs) the listing, then serves until stop(). */
  start(): Promise<void>
  stop(): void
  /** One pass over negotiations and escrows — for tests and custom loops. */
  runOnce(): Promise<void>
}

// AgentEco.sol OrderStatus
const FUNDED = 1
const EXECUTING = 2
const DISPUTED = 4
const SETTLED = 5
const REFUNDED = 6
const ZERO_HASH = `0x${'0'.repeat(64)}`

/**
 * A self-hosted seller agent in a few lines: it lists itself in the
 * marketplace, haggles within your floor, and for every funded escrow naming
 * its wallet checks the task against the on-chain hash, accepts the job, runs
 * your handler, commits the result's hash and publishes the result.
 */
export function createSellerAgent(options: SellerAgentOptions): SellerAgent {
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL
  const log = options.log ?? consoleLogger(options.name)
  const pollMs = options.pollMs ?? 3000
  const onchain = createOnchainClients(options.privateKey, RPC_URL)
  const account = onchain.account
  const runtime = new DemoAgentRuntime({
    name: options.name,
    role: 'seller',
    capabilities: [options.capability],
    description: options.description,
    category: options.category ?? 'Automation',
    service: options.name,
    basePrice: options.price,
    minimumPrice: options.floor,
  })

  if (!options.handle && !isCapabilityId(options.capability)) {
    throw new Error(`"${options.capability}" is a community capability — pass a handle(job) that produces its result.`)
  }
  // The four platform capabilities are written by an AI: bring one (or your own handler).
  if (!options.handle && !options.ai) {
    throw new Error(`"${options.capability}" needs an AI: pass ai (e.g. openAiCompatible({ baseUrl, apiKey, model })) or your own handle(job).`)
  }

  let agentId: string | null = null
  let running = false
  /** Failed attempts per escrow: a model or handler that keeps failing is not retried forever (each try may cost money). */
  const attempts = new Map<bigint, number>()
  const MAX_ATTEMPTS = 3
  /** Escrows with nothing left to do. Every step is idempotent against on-chain status, so a restart just re-checks. */
  const finished = new Set<bigint>()
  /** Results whose on-chain hash is committed, kept until the API has the plaintext. */
  const unpublished = new Map<bigint, { capability: string; result: Record<string, unknown> }>()

  async function register(): Promise<string> {
    const agent = await registerOrSyncSelf(runtime.config, { apiUrl, account, walletAddress: account.address })
    log(`listed as ${agent.id} — ${options.capability} at ${options.price} (floor ${options.floor})`)
    return agent.id
  }

  async function negotiate(id: string): Promise<void> {
    for (const n of await listNegotiationsForAgent(apiUrl, account, id, 'open')) {
      if (!isMyTurn(n, 'seller')) continue
      const offered = Number(n.messages[n.messages.length - 1].price)
      const decision = runtime.decideOnOffer(offered, countOffersBySide(n, 'seller'))
      log(`negotiation ${n.id.slice(0, 8)}: buyer offers ${offered} → ${decision.action}${decision.action === 'counter' ? ` ${decision.price}` : ''}`)
      await respondToNegotiation(apiUrl, account, n.id, {
        side: 'seller',
        action: decision.action,
        ...(decision.action === 'counter' ? { price: decision.price } : {}),
        source: 'rule',
      })
    }
  }

  async function publish(escrowId: bigint): Promise<void> {
    const pending = unpublished.get(escrowId)
    if (!pending) return
    try {
      await publishEscrowResult(apiUrl, escrowId.toString(), pending.capability, pending.result)
      unpublished.delete(escrowId)
      log(`escrow #${escrowId}: result published`)
    } catch (error) {
      log(`escrow #${escrowId}: publishing the result failed — will retry (${(error as Error).message})`)
    }
  }

  /** Reads the task behind an escrow and checks it before any commitment. Null = never take this job. */
  async function checkedJob(escrowId: bigint): Promise<Job | null | 'wait'> {
    const task = await getTaskByEscrow(apiUrl, escrowId.toString(), account)
    if (!task) return 'wait' // the buyer links the task right after funding
    const { taskHash } = await getEscrowHashes(onchain, escrowId)
    if (hashPreimage(task.preimage).toLowerCase() !== taskHash.toLowerCase()) {
      log(`escrow #${escrowId}: the task does not match the on-chain taskHash — not taking it`)
      return null
    }
    if (task.seller.toLowerCase() !== account.address.toLowerCase() || task.capability !== options.capability) {
      log(`escrow #${escrowId}: the task is for another seller or capability — not taking it`)
      return null
    }
    const capability = await resolveCapability(apiUrl, task.capability)
    const brief = capability.checkBrief(task.brief)
    if (!brief.ok) {
      log(`escrow #${escrowId}: invalid brief (${brief.error}) — not taking it; the accept timeout refunds the buyer`)
      return null
    }
    const job: Job = { escrowId, capability: task.capability, brief: brief.brief, criteria: task.criteria, price: task.price, buyer: task.buyer }
    if (isCapabilityId(task.capability)) {
      const prepared = await prepareJob(task.capability, task.brief, { publicClient: onchain.publicClient, agentEcoAddress: AGENT_ECO_ADDRESS })
      if (!prepared.ok) {
        log(`escrow #${escrowId}: ${prepared.reason} — not taking it`)
        return null
      }
      job.prepared = prepared.job
    }
    return job
  }

  async function work(job: Job): Promise<Record<string, unknown>> {
    // No fallback: when the model never answers, nothing is delivered (the error is retried a few
    // times, then dropped, and the contract's timeout refunds the buyer).
    const raw = options.handle
      ? await options.handle(job)
      : await runPlatformJob(job.prepared!, options.ai!, { criteria: job.criteria, instructions: options.instructions, log })
    if (!raw) throw new Error(`${job.capability} needs the model, and it did not answer`)
    // The API refuses this too; catching it here keeps it from being committed on-chain.
    if (isCapabilityId(job.capability) && mentionsAiUnavailable(job.capability, raw)) {
      throw new Error('the result says "AI unavailable" — a platform capability must be written by a model')
    }
    const capability = await resolveCapability(apiUrl, job.capability)
    const checked = capability.checkResult(raw)
    if (!checked.ok) throw new Error(`the result does not match the ${job.capability} output schema: ${checked.error}`)
    // Commit exactly the object returned: its hash goes on-chain, the same object to the API.
    return raw
  }

  /** Once per dispute, inside the response window: the job and result come from the API, so this survives restarts. */
  async function answerDispute(escrowId: bigint): Promise<void> {
    if (!options.respondToDispute && !options.ai) return
    const [{ disputeResponseHash }, info] = await Promise.all([getEscrowHashes(onchain, escrowId), getEscrowDisputeInfo(onchain, escrowId)])
    if (disputeResponseHash !== ZERO_HASH) return
    if (Math.floor(Date.now() / 1000) > Number(info.disputedAt) + SELLER_RESPONSE_WINDOW_SECONDS) return
    const [task, delivered, dispute] = await Promise.all([
      getTaskByEscrow(apiUrl, escrowId.toString(), account),
      getEscrowResult(apiUrl, escrowId.toString(), account),
      getDispute(apiUrl, escrowId.toString(), account),
    ])
    if (!task || !delivered) return
    const job: Job = { escrowId, capability: task.capability, brief: task.brief, criteria: task.criteria, price: task.price, buyer: task.buyer }
    const reason = dispute?.reason || null
    let text: string | null
    if (options.respondToDispute) {
      text = await options.respondToDispute({ escrowId, job, result: delivered.result, reason })
    } else {
      const capability = await resolveCapability(apiUrl, task.capability)
      text = await defendWithAi(
        options.ai!,
        { capability: task.capability, label: capability.name, rubric: capability.rubric, examples: capability.examples, brief: task.brief, criteria: task.criteria, result: delivered.result },
        reason ?? 'The buyer gave no reason.',
        log
      )
    }
    if (!text?.trim()) return
    const response = text.trim().slice(0, 1000)
    await submitDisputeResponse(onchain, escrowId, textHash(response))
    await submitDisputeResponseText(apiUrl, account, escrowId.toString(), response, 'api')
    log(`escrow #${escrowId}: answered the dispute`)
  }

  /** Moves one escrow as far as it can go. True once nothing is left to do. */
  async function advance(escrowId: bigint): Promise<boolean> {
    const status = await getEscrowStatus(onchain, escrowId)
    if (status === DISPUTED) {
      await answerDispute(escrowId)
      return false
    }
    if (status !== FUNDED && status !== EXECUTING) {
      // CREATED waits for funding; DELIVERED stays watched in case of a dispute.
      await publish(escrowId)
      return (status === SETTLED || status === REFUNDED) && !unpublished.has(escrowId)
    }

    const job = await checkedJob(escrowId)
    if (job === 'wait') return false
    if (!job) return true

    if (status === FUNDED) {
      await startExecution(onchain, escrowId)
      log(`escrow #${escrowId}: accepted (${job.price}) — working…`)
    }
    const result = await work(job)
    await markDelivered(onchain, escrowId, resultHash(result))
    unpublished.set(escrowId, { capability: job.capability, result })
    log(`escrow #${escrowId}: delivered`)
    await publish(escrowId)
    return false // stays watched until settled, refunded or disputed
  }

  async function runOnce(): Promise<void> {
    agentId ??= await register()
    await negotiate(agentId)
    const mine = (await readAllEscrows(onchain.publicClient)).filter(
      (e) => e.seller.toLowerCase() === account.address.toLowerCase() && !finished.has(e.id)
    )
    for (const { id } of mine) {
      try {
        if (await advance(id)) finished.add(id)
      } catch (error) {
        const n = (attempts.get(id) ?? 0) + 1
        attempts.set(id, n)
        if (n >= MAX_ATTEMPTS) {
          finished.add(id)
          log(`escrow #${id} failed ${n} times (${(error as Error).message}) — giving up; the contract's timeout refunds the buyer`)
        } else {
          log(`escrow #${id} failed this cycle — will retry (${(error as Error).message})`)
        }
      }
    }
  }

  return {
    address: account.address,
    async start() {
      running = true
      log(`wallet ${account.address}, AgentEco ${AGENT_ECO_ADDRESS}`)
      while (running) {
        try {
          await runOnce()
        } catch (error) {
          log(`poll failed: ${(error as Error).message}`)
        }
        if (running) await sleep(pollMs)
      }
      log('stopped')
    },
    stop() {
      running = false
    },
    runOnce,
  }
}
