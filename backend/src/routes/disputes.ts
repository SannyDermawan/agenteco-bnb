import { Router } from 'express'
import { createPublicClient } from 'viem'
import { prisma } from '../db.ts'
import { agentEcoFor, appChain, appTransport } from '../network.ts'
import { verifyOwnerAuth } from '../auth.ts'
import { guardEscrow, isArbiter, requireViewer } from '../access.ts'
import { AGENT_ECO_ABI } from '../abi/agentEcoAbi.ts'
import { buildRationalePreimage, hashPreimage, textHash } from '../../../agent-runtime/src/shared/hashes.ts'
import { disputeReasonSchema, disputeResolutionSchema, disputeResponseSchema } from '../schemas/dispute.ts'

export const disputesRouter = Router()

const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })

// AgentEco.sol OrderStatus
const DISPUTED = 4
const SETTLED = 5
const REFUNDED = 6

async function readEscrow(escrowId: string) {
  const id = BigInt(escrowId)
  const [basic, hashes] = await Promise.all([
    publicClient.readContract({ address: agentEcoFor(id), abi: AGENT_ECO_ABI, functionName: 'getEscrowBasic', args: [id] }),
    publicClient.readContract({ address: agentEcoFor(id), abi: AGENT_ECO_ABI, functionName: 'getEscrowHashes', args: [id] }),
  ])
  const [buyer, seller, , status] = basic
  const [, , reasonHash, responseHash, resolutionHash] = hashes
  return { buyer, seller, status: Number(status), reasonHash, responseHash, resolutionHash }
}

function badId(escrowId: string): boolean {
  return !/^\d+$/.test(escrowId)
}

// Dispute texts are private to the escrow's buyer, seller and the arbiter,
// who can re-hash them against the chain. The full list is the arbiter's queue.
disputesRouter.get('/', async (req, res) => {
  const viewer = await requireViewer(req, res)
  if (!viewer) return
  if (!(await isArbiter(viewer))) return res.status(403).json({ error: 'Only the arbiter can list every dispute' })
  res.json(await prisma.dispute.findMany({ orderBy: { createdAt: 'desc' } }))
})

disputesRouter.get('/:escrowId', async (req, res) => {
  if (!(await guardEscrow(req, res, req.params.escrowId))) return
  const dispute = await prisma.dispute.findUnique({ where: { escrowId: req.params.escrowId } })
  if (!dispute) return res.status(404).json({ error: 'No dispute recorded for this escrow' })
  res.json(dispute)
})

/**
 * The buyer's reason. On-chain first: raiseDispute(id, keccak256(reason)) —
 * then the text comes here and is accepted only if it hashes to exactly that.
 */
disputesRouter.put('/:escrowId', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })
  const { escrowId } = req.params
  if (badId(escrowId)) return res.status(400).json({ error: 'escrowId must be a number' })

  const parsed = disputeReasonSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid reason' })

  let escrow: Awaited<ReturnType<typeof readEscrow>>
  try {
    escrow = await readEscrow(escrowId)
  } catch {
    return res.status(400).json({ error: 'Could not read this escrow on-chain — is the id correct?' })
  }
  if (escrow.buyer.toLowerCase() !== auth.wallet.toLowerCase()) {
    return res.status(403).json({ error: "Only this escrow's buyer can describe its dispute" })
  }
  const reasonHash = textHash(parsed.data.reason)
  if (reasonHash.toLowerCase() !== escrow.reasonHash.toLowerCase()) {
    return res.status(400).json({ error: 'This reason does not match the reason hash committed on-chain by raiseDispute.' })
  }

  const saved = await prisma.dispute.upsert({
    where: { escrowId },
    create: { escrowId, buyerWallet: auth.wallet.toLowerCase(), reason: parsed.data.reason, reasonHash },
    // Fills in a placeholder the arbiter made while the text was missing (same hash, so same text).
    update: { reason: parsed.data.reason, reasonHash },
  })
  res.json(saved)
})

/**
 * The seller's answer (hosted sellers sign with their agent wallet; a
 * self-hosted seller with its own). On-chain first:
 * submitDisputeResponse(id, keccak256(response)).
 */
disputesRouter.post('/:escrowId/response', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })
  const { escrowId } = req.params
  if (badId(escrowId)) return res.status(400).json({ error: 'escrowId must be a number' })

  const parsed = disputeResponseSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid response' })

  const dispute = await prisma.dispute.findUnique({ where: { escrowId } })
  if (!dispute) return res.status(404).json({ error: 'The buyer has not submitted this dispute yet' })

  let escrow: Awaited<ReturnType<typeof readEscrow>>
  try {
    escrow = await readEscrow(escrowId)
  } catch {
    return res.status(400).json({ error: 'Could not read this escrow on-chain — is the id correct?' })
  }
  if (escrow.seller.toLowerCase() !== auth.wallet.toLowerCase()) {
    return res.status(403).json({ error: "Only this escrow's seller can answer its dispute" })
  }
  const responseHash = textHash(parsed.data.response)
  if (responseHash.toLowerCase() !== escrow.responseHash.toLowerCase()) {
    return res.status(400).json({ error: 'This response does not match the response hash committed on-chain.' })
  }

  const saved = await prisma.dispute.update({
    where: { escrowId },
    data: {
      sellerResponse: parsed.data.response,
      responseHash,
      responseSource: dispute.responseSource ?? parsed.data.source,
      respondedAt: dispute.respondedAt ?? new Date(),
    },
  })
  res.json(saved)
})

/**
 * The arbiter's ruling. On-chain first: resolveDisputeFor*(id, rationaleHash)
 * — then the rationale object comes here and is accepted only if its
 * fixed-order JSON hashes to the on-chain resolutionHash. Anyone may submit
 * it (the hash is the proof); the backend's auto-arbiter does so too.
 */
disputesRouter.post('/:escrowId/resolution', async (req, res) => {
  const { escrowId } = req.params
  if (badId(escrowId)) return res.status(400).json({ error: 'escrowId must be a number' })
  const parsed = disputeResolutionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid resolution' })

  let escrow: Awaited<ReturnType<typeof readEscrow>>
  try {
    escrow = await readEscrow(escrowId)
  } catch {
    return res.status(400).json({ error: 'Could not read this escrow on-chain — is the id correct?' })
  }
  if (escrow.status !== SETTLED && escrow.status !== REFUNDED) {
    return res.status(400).json({ error: escrow.status === DISPUTED ? 'The dispute is not resolved on-chain yet' : 'This escrow was not disputed' })
  }

  const { txHash, ...rationale } = parsed.data
  const preimage = buildRationalePreimage(rationale)
  const rationaleHash = hashPreimage(preimage)
  if (rationaleHash.toLowerCase() !== escrow.resolutionHash.toLowerCase()) {
    return res.status(400).json({ error: 'This rationale does not match the resolution hash committed on-chain.' })
  }

  const saved = await prisma.dispute.update({
    where: { escrowId },
    data: {
      resolution: rationale.decidedBy,
      releasedToSeller: escrow.status === SETTLED,
      rationalePreimage: preimage,
      rationaleHash,
      ...(txHash && { resolutionTx: txHash }),
      resolvedAt: new Date(),
    },
  })
  // Unsigned route: confirm the ruling without echoing the private dispute texts.
  res.json({
    escrowId: saved.escrowId,
    resolution: saved.resolution,
    releasedToSeller: saved.releasedToSeller,
    rationaleHash: saved.rationaleHash,
    resolvedAt: saved.resolvedAt,
  })
})
