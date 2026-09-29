import type { LocalAccount, PublicClient } from 'viem'
import {
  acceptAndSettleOnchain,
  getEscrowDisputeInfo,
  getEscrowHashes,
  getEscrowStatus,
  getEscrowTimestamps,
  raiseDisputeOnchain,
  rateSellerOnchain,
  submitDisputeReason,
  type OnchainClients,
} from '../../../agent-runtime/src/index.ts'
import { getTaskByEscrow } from '../../../agent-runtime/src/tasksClient.ts'
import { buildAuthHeaders } from '../../../agent-runtime/src/authHeaders.ts'
import { REVIEW_WINDOW_SECONDS } from '../../../agent-runtime/src/durations.ts'
import { hashPreimage, textHash } from '../../../agent-runtime/src/shared/hashes.ts'
import { isCapabilityId } from '../../../agent-runtime/src/shared/capabilities/definitions.ts'
import { disputeReasonFrom, ratingScoreFrom, verifyResult } from '../ai/judge.ts'
import { prisma } from '../db.ts'
import { log, logError } from '../log.ts'
import { recordRatingsFromTx } from '../ratings.ts'

// AgentEco.sol OrderStatus
const DELIVERED = 3
const DISPUTED = 4
const SETTLED = 5
const REFUNDED = 6

export type ReviewStep = 'waiting' | 'acted' | 'final'

interface Ctx {
  apiUrl: string
  agent: { id: string; name: string }
  onchain: OnchainClients
  account: LocalAccount
  escrowId: bigint
}

/** The delivered result, only if its stored text hashes to the on-chain resultHash. */
async function readVerifiedResult(ctx: Ctx): Promise<{ capability: string; result: unknown } | null> {
  const res = await fetch(`${ctx.apiUrl}/escrow-results/${ctx.escrowId}`, { headers: await buildAuthHeaders(ctx.account) })
  if (!res.ok) return null
  const stored = (await res.json()) as { capability: string; result: unknown; resultJson: string | null }
  if (!stored.resultJson) return null
  const { resultHash } = await getEscrowHashes(ctx.onchain, ctx.escrowId)
  if (hashPreimage(stored.resultJson).toLowerCase() !== resultHash.toLowerCase()) return null
  return { capability: stored.capability, result: JSON.parse(stored.resultJson) }
}

/** Step 1 at DELIVERED: score the result once and store the Verification (spec §10.1). */
async function verifyDelivery(ctx: Ctx) {
  const existing = await prisma.verification.findUnique({ where: { escrowId: ctx.escrowId.toString() } })
  if (existing) return existing

  const delivered = await readVerifiedResult(ctx)
  if (!delivered) {
    // A result hash with no matching plaintext can't be checked. Give the
    // seller half the review window to publish it, then dispute.
    const { deliveredAt } = await getEscrowTimestamps(ctx.onchain, ctx.escrowId)
    const waited = BigInt(Math.floor(Date.now() / 1000)) - deliveredAt
    if (waited * BigInt(2) < REVIEW_WINDOW_SECONDS) return null
    return prisma.verification.create({
      data: {
        escrowId: ctx.escrowId.toString(),
        score: 0,
        verdict: 'dispute',
        rationale: 'The seller committed a result hash on-chain but never published a result that matches it, so the delivery could not be checked.',
        provider: 'rule',
      },
    })
  }

  const task = await getTaskByEscrow(ctx.apiUrl, ctx.escrowId.toString(), ctx.account)
  const capability = task?.capability ?? delivered.capability
  if (!isCapabilityId(capability)) throw new Error(`escrow #${ctx.escrowId}: unknown capability "${capability}"`)
  const outcome = await verifyResult(
    { capability, brief: task?.brief ?? null, criteria: task?.criteria ?? '', result: delivered.result },
    { agentId: ctx.agent.id }
  )
  log(
    `[host:${ctx.agent.name}] escrow #${ctx.escrowId}: verification ${outcome.score ?? 'unscored'}/100 → ${outcome.verdict}` +
      ` (${outcome.provider}${outcome.model ? `/${outcome.model}` : ''})`
  )
  return prisma.verification.create({
    data: {
      escrowId: ctx.escrowId.toString(),
      score: outcome.score,
      verdict: outcome.verdict,
      rationale: outcome.rationale,
      provider: outcome.provider,
      model: outcome.model,
    },
  })
}

/** The dispute reason for a stored verification — rebuilt identically every time it's needed. */
function reasonFor(v: { score: number | null; rationale: string; provider: string; model: string | null }): string {
  return disputeReasonFrom({ score: v.score, verdict: 'dispute', rationale: v.rationale, provider: v.provider, model: v.model })
}

/** Sends the reason text if the API doesn't have it yet, after checking it matches the on-chain hash. */
async function ensureReasonSaved(ctx: Ctx): Promise<void> {
  const res = await fetch(`${ctx.apiUrl}/disputes/${ctx.escrowId}`, { headers: await buildAuthHeaders(ctx.account) })
  if (res.ok) return
  const v = await prisma.verification.findUnique({ where: { escrowId: ctx.escrowId.toString() } })
  if (!v) return
  const reason = reasonFor(v)
  const { disputeReasonHash } = await getEscrowHashes(ctx.onchain, ctx.escrowId)
  if (textHash(reason).toLowerCase() !== disputeReasonHash.toLowerCase()) {
    log(`[host:${ctx.agent.name}] escrow #${ctx.escrowId}: rebuilt dispute reason no longer matches its hash — cannot re-send it.`)
    return
  }
  await submitDisputeReason(ctx.apiUrl, ctx.account, ctx.escrowId.toString(), reason)
  log(`[host:${ctx.agent.name}] escrow #${ctx.escrowId}: dispute reason saved.`)
}

/** Rates the seller with the verification score once the escrow is final (spec §10.1 step 4). */
async function rateIfDue(ctx: Ctx): Promise<void> {
  const v = await prisma.verification.findUnique({ where: { escrowId: ctx.escrowId.toString() } })
  // Unscored (AI unavailable) or rule-made verifications don't rate.
  if (!v || v.score === null || v.provider === 'none' || v.provider === 'rule') return
  const [{ rated }, { deliveredAt }] = await Promise.all([
    getEscrowDisputeInfo(ctx.onchain, ctx.escrowId),
    getEscrowTimestamps(ctx.onchain, ctx.escrowId),
  ])
  if (rated || deliveredAt === BigInt(0)) return
  const score = ratingScoreFrom(v.score)
  const hash = await rateSellerOnchain(ctx.onchain, ctx.escrowId, score)
  log(`[host:${ctx.agent.name}] escrow #${ctx.escrowId}: rated the seller ${score}/100.`)
  try {
    await recordRatingsFromTx(ctx.onchain.publicClient as PublicClient, hash)
  } catch (error) {
    // The background SellerRated scan picks it up later.
    logError(`[host:${ctx.agent.name}] escrow #${ctx.escrowId}: rating not indexed yet`, error, 'HOST')
  }
}

/**
 * One step of a hosted buyer's review of its funded escrow:
 * DELIVERED → verify → acceptAndSettle, or raiseDispute(reasonHash) + reason;
 * DISPUTED  → make sure the reason reached the API, then wait for the ruling;
 * SETTLED / REFUNDED → rate the seller (if a model scored it) — 'final'.
 */
export async function reviewEscrow(
  apiUrl: string,
  agent: { id: string; name: string },
  onchain: OnchainClients,
  account: LocalAccount,
  escrowId: bigint
): Promise<ReviewStep> {
  const ctx: Ctx = { apiUrl, agent, onchain, account, escrowId }
  const status = await getEscrowStatus(onchain, escrowId)

  if (status === DELIVERED) {
    const v = await verifyDelivery(ctx)
    if (!v) return 'waiting'
    if (v.verdict === 'accept') {
      log(`[host:${agent.name}] escrow #${escrowId}: accepting & settling…`)
      await acceptAndSettleOnchain(onchain, escrowId)
      return 'acted'
    }
    const reason = reasonFor(v)
    log(`[host:${agent.name}] escrow #${escrowId}: raising a dispute…`)
    await raiseDisputeOnchain(onchain, escrowId, textHash(reason))
    try {
      await submitDisputeReason(apiUrl, account, escrowId.toString(), reason)
    } catch (error) {
      logError(`[host:${agent.name}] escrow #${escrowId}: dispute reason not saved yet — will retry`, error, 'HOST')
    }
    return 'acted'
  }

  if (status === DISPUTED) {
    await ensureReasonSaved(ctx)
    return 'waiting'
  }

  if (status === SETTLED || status === REFUNDED) {
    await rateIfDue(ctx)
    return 'final'
  }

  return 'waiting'
}
