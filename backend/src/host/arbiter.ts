import { createPublicClient, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  createOnchainClients,
  getEscrowDisputeInfo,
  getEscrowHashes,
  type OnchainClients,
} from '../../../agent-runtime/src/index.ts'
import { canRule, readArbiterSetup, ruleDispute } from '../../../agent-runtime/src/onchain/arbiter.ts'
import { readAllEscrows, type EscrowBasic } from '../../../agent-runtime/src/onchain/escrowIndex.ts'
import { ARBITER_OVERRIDE_WINDOW_SECONDS, SELLER_RESPONSE_WINDOW_SECONDS } from '../../../agent-runtime/src/durations.ts'
import { buildRationalePreimage, hashPreimage, type RationaleInput } from '../../../agent-runtime/src/shared/hashes.ts'
import { getCapability } from '../capabilityRegistry.ts'
import { recommendRuling, shouldAutoResolve } from '../ai/judge.ts'
import { ARBITER_AUTO_MIN_CONFIDENCE } from '../ai/config.ts'
import { prisma } from '../db.ts'
import { log, logError } from '../log.ts'
import { warnIfLowGas } from '../gasWatch.ts'
import { AGENT_ECO_ADDRESS, RPC_URL, agentEcoFor, appChain, appTransport } from '../network.ts'

/**
 * The AI arbiter (spec §11 steps 3–5), run by the host process: it already has
 * the database, the AI providers and the API, while the keeper stays a
 * permissionless timeout bot with no secrets beyond its gas wallet.
 *
 * Per disputed escrow: once the seller has answered (or its response window
 * has passed), the arbiter model recommends a ruling; the human arbiter then
 * has ARBITER_OVERRIDE_WINDOW_SECONDS to approve or reverse it on the Disputes
 * page. After that, a confident recommendation (≥ ARBITER_AUTO_MIN_CONFIDENCE)
 * with ≥ 60 s left before the on-chain deadline is executed here with
 * ARBITER_PRIVATE_KEY. Anything else waits for the human or the timeout refund.
 *
 * On AgentEco v2 the arbiter is an ArbiterCouncil and ARBITER_PRIVATE_KEY is
 * one of its members: the AI's ruling is its vote, which executes at once
 * when the council's ruling threshold is 1, or waits for a human's matching vote.
 */

// AgentEco.sol OrderStatus
const DISPUTED = 4
const SETTLED = 5
const REFUNDED = 6
const ZERO_HASH = `0x${'0'.repeat(64)}`

const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })
// The runtime's read helpers are typed against its own viem copy.
const chain = { publicClient } as unknown as Pick<OnchainClients, 'publicClient'>

let arbiter: OnchainClients | null | undefined

/**
 * The arbiter wallet, if ARBITER_PRIVATE_KEY is set and is the contract's
 * arbiter or a member of its council; otherwise recommend-only.
 */
export async function initArbiter(): Promise<void> {
  const raw = process.env.ARBITER_PRIVATE_KEY?.trim()
  const key = raw && !raw.startsWith('0x') ? `0x${raw}` : raw
  if (!key || !isHex(key) || key.length !== 66) {
    arbiter = null
    log('Arbiter: no ARBITER_PRIVATE_KEY — AI recommendations only, no automatic rulings.', 'HOST')
    return
  }
  const setup = await readArbiterSetup(publicClient, AGENT_ECO_ADDRESS)
  const account = privateKeyToAccount(key)
  if (!canRule(setup, account.address)) {
    arbiter = null
    const who = setup.council ? `a member of the arbiter council ${setup.council.address}` : `the contract's arbiter (${setup.arbiter})`
    log(`Arbiter: ARBITER_PRIVATE_KEY is ${account.address}, which is not ${who} — recommendations only.`, 'HOST')
    return
  }
  arbiter = createOnchainClients(key, RPC_URL)
  const via = setup.council
    ? `, voting in ArbiterCouncil ${setup.council.address} (${setup.council.rulingThreshold} of ${setup.council.members.length} votes rule)`
    : ''
  log(`Arbiter: ${account.address}${via} — auto-rules at confidence ≥ ${ARBITER_AUTO_MIN_CONFIDENCE} after a ${ARBITER_OVERRIDE_WINDOW_SECONDS}s override window.`, 'HOST')
}

const nowSec = () => Math.floor(Date.now() / 1000)
/** Waiting reasons already logged per escrow, so a long wait logs once. */
const loggedWait = new Map<string, string>()

function logOnce(escrowId: string, key: string, message: string): void {
  if (loggedWait.get(escrowId) === key) return
  loggedWait.set(escrowId, key)
  log(message)
}

async function recommend(escrow: EscrowBasic, disputedAt: number): Promise<void> {
  const id = escrow.id.toString()
  const responseWindowOver = nowSec() >= disputedAt + SELLER_RESPONSE_WINDOW_SECONDS

  let row = await prisma.dispute.findUnique({ where: { escrowId: id } })
  if (!row) {
    // The buyer's text never arrived (only its hash is on-chain): after the
    // response window, judge without it rather than let the deadline lapse.
    if (!responseWindowOver) return
    const { disputeReasonHash } = await getEscrowHashes(chain, escrow.id)
    row = await prisma.dispute.create({ data: { escrowId: id, buyerWallet: escrow.buyer.toLowerCase(), reason: '', reasonHash: disputeReasonHash } })
  }

  const { disputeResponseHash } = await getEscrowHashes(chain, escrow.id)
  const responded = disputeResponseHash !== ZERO_HASH
  // Wait for the seller's answer (and its text) until the window closes.
  if (!responseWindowOver && (!responded || !row.sellerResponse)) {
    logOnce(id, 'awaiting-response', `[arbiter] escrow #${id}: waiting for the seller's response…`)
    return
  }

  const [task, result] = await Promise.all([
    prisma.task.findUnique({ where: { escrowId: id } }),
    prisma.escrowResult.findUnique({ where: { escrowId: id } }),
  ])
  // Platform or community capability — a community one is judged by its published rubric.
  const capability = task ? await getCapability(task.capability) : null
  const rec =
    task && result?.resultJson && capability
      ? await recommendRuling(
          {
            capability: task.capability,
            label: capability.name,
            rubric: capability.rubric,
            brief: task.brief,
            criteria: task.criteria,
            result: JSON.parse(result.resultJson),
          },
          row.reason || null,
          row.sellerResponse ?? null
        )
      : null

  const recommendedAt = new Date()
  if (!rec) {
    await prisma.dispute.update({ where: { escrowId: id }, data: { recUnavailable: true, recommendedAt } })
    log(`[arbiter] escrow #${id}: AI recommendation unavailable — waiting for the arbiter or the timeout.`)
    return
  }
  await prisma.dispute.update({
    where: { escrowId: id },
    data: {
      recVerdict: rec.verdict,
      recConfidence: rec.confidence,
      recRationale: rec.rationale,
      recProvider: rec.provider,
      recModel: rec.model,
      recommendedAt,
      recUnavailable: false,
      overrideDeadline: new Date(recommendedAt.getTime() + ARBITER_OVERRIDE_WINDOW_SECONDS * 1000),
    },
  })
  log(`[arbiter] escrow #${id}: AI recommends ${rec.verdict} (${rec.confidence}% confident, ${rec.provider}/${rec.model}); override window ${ARBITER_OVERRIDE_WINDOW_SECONDS}s.`)
}

async function autoResolve(escrow: EscrowBasic, disputeDeadline: number): Promise<void> {
  const id = escrow.id.toString()
  const row = await prisma.dispute.findUnique({ where: { escrowId: id } })
  if (!row?.recommendedAt || row.recUnavailable || !row.recVerdict || row.recConfidence === null || !row.recRationale || !row.overrideDeadline) return
  if (!arbiter) return

  const decision = shouldAutoResolve({
    confidence: row.recConfidence,
    nowSec: nowSec(),
    overrideDeadlineSec: Math.floor(row.overrideDeadline.getTime() / 1000),
    disputeDeadlineSec: disputeDeadline,
  })
  if (!decision.ok) {
    if (decision.reason === 'low-confidence') logOnce(id, 'low-confidence', `[arbiter] escrow #${id}: confidence ${row.recConfidence}% is below ${ARBITER_AUTO_MIN_CONFIDENCE}% — left to the arbiter or the timeout.`)
    if (decision.reason === 'too-late') logOnce(id, 'too-late', `[arbiter] escrow #${id}: too close to the dispute deadline to rule — the timeout refunds the buyer.`)
    return
  }

  const rationale: RationaleInput = {
    verdict: row.recVerdict as 'seller' | 'buyer',
    confidence: row.recConfidence,
    rationale: row.recRationale,
    decidedBy: 'ai-auto',
  }
  const preimage = buildRationalePreimage(rationale)
  const toSeller = rationale.verdict === 'seller'
  log(`[arbiter] escrow #${id}: executing the AI ruling for the ${rationale.verdict}…`)
  const outcome = await ruleDispute(arbiter, escrow.id, toSeller, hashPreimage(preimage))
  if (outcome.kind !== 'executed') {
    // Council with a ruling threshold above 1: the AI's vote waits for a human's.
    logOnce(id, 'council-vote', `[arbiter] escrow #${id}: AI voted ${rationale.verdict} in the arbiter council (${outcome.votes}/${outcome.needed}) — waiting for another member.`)
    return
  }
  const tx = outcome.hash
  await prisma.dispute.update({
    where: { escrowId: id },
    data: {
      resolution: 'ai-auto',
      releasedToSeller: toSeller,
      rationalePreimage: preimage,
      rationaleHash: hashPreimage(preimage),
      resolutionTx: tx,
      resolvedAt: new Date(),
    },
  })
  log(`[arbiter] escrow #${id}: resolved for the ${rationale.verdict} (tx ${tx}).`)
}

/**
 * Records disputes that ended without us: the keeper's timeout refund, or a
 * manual ruling whose rationale text the browser never posted (hash only).
 */
async function sweepEnded(statusById: Map<string, number>): Promise<void> {
  const open = await prisma.dispute.findMany({ where: { resolution: null } })
  for (const row of open) {
    const status = statusById.get(row.escrowId)
    if (status !== SETTLED && status !== REFUNDED) continue
    const { resolutionHash } = await getEscrowHashes(chain, BigInt(row.escrowId))
    const timedOut = resolutionHash === ZERO_HASH
    await prisma.dispute.update({
      where: { escrowId: row.escrowId },
      data: {
        resolution: timedOut ? 'timeout' : 'arbiter-manual',
        releasedToSeller: status === SETTLED,
        ...(timedOut ? {} : { rationaleHash: resolutionHash }),
        resolvedAt: new Date(),
      },
    })
    log(`[arbiter] escrow #${row.escrowId}: dispute ended by ${timedOut ? 'timeout (buyer refunded)' : 'the arbiter'}.`)
  }
}

export async function runArbiterCycleOnce(): Promise<void> {
  if (arbiter === undefined) await initArbiter()
  const escrows = await readAllEscrows(chain.publicClient)
  const statusById = new Map(escrows.map((e) => [e.id.toString(), e.status]))

  // Only the current deployment's disputes can still be ruled (its arbiter is the one checked above).
  const disputed = escrows.filter((e) => e.status === DISPUTED && agentEcoFor(e.id) === AGENT_ECO_ADDRESS)
  if (disputed.length && arbiter) await warnIfLowGas(arbiter.publicClient, arbiter.account.address, 'arbiter')
  for (const escrow of disputed) {
    try {
      const info = await getEscrowDisputeInfo(chain, escrow.id)
      const row = await prisma.dispute.findUnique({ where: { escrowId: escrow.id.toString() }, select: { recommendedAt: true } })
      if (!row?.recommendedAt) await recommend(escrow, Number(info.disputedAt))
      else await autoResolve(escrow, Number(info.disputeDeadline))
    } catch (error) {
      logError(`[arbiter] escrow #${escrow.id} failed this cycle`, error, 'HOST')
    }
  }

  try {
    await sweepEnded(statusById)
  } catch (error) {
    logError('[arbiter] sweep failed', error, 'HOST')
  }
}
