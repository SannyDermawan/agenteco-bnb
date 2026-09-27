import { Router } from 'express'
import { createPublicClient, http, type Address } from 'viem'
import { prisma } from '../db.ts'
import { AGENT_ECO_ADDRESS, RPC_URL, appChain } from '../network.ts'
import { verifyOwnerAuth } from '../auth.ts'
import { disputeReasonSchema } from '../schemas/dispute.ts'

export const disputesRouter = Router()

const ESCROW_BASIC_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'escrowId', type: 'uint256' }],
    name: 'getEscrowBasic',
    outputs: [
      { internalType: 'address', name: 'buyer', type: 'address' },
      { internalType: 'address', name: 'seller', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint8', name: 'status', type: 'uint8' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// AgentEco.sol OrderStatus: DELIVERED (the buyer is about to dispute — its
// raiseDispute tx may not be visible to this RPC node yet) or DISPUTED.
const DISPUTABLE_STATUSES = new Set([3, 4])

const publicClient = createPublicClient({ chain: appChain, transport: http(RPC_URL) })

// Reasons are read by the arbiter and by both parties on the order page — no
// secrets in them, so reads are public like escrow results.
disputesRouter.get('/', async (_req, res) => {
  res.json(await prisma.disputeReason.findMany({ orderBy: { createdAt: 'desc' } }))
})

disputesRouter.get('/:escrowId', async (req, res) => {
  const reason = await prisma.disputeReason.findUnique({ where: { escrowId: req.params.escrowId } })
  if (!reason) return res.status(404).json({ error: 'No dispute reason recorded for this escrow' })
  res.json(reason)
})

// Only the escrow's own on-chain buyer may explain its dispute — checked
// against AgentEco.sol, not trusted from the request.
disputesRouter.put('/:escrowId', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })

  const parsed = disputeReasonSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid reason' })

  const { escrowId } = req.params
  if (!/^\d+$/.test(escrowId)) return res.status(400).json({ error: 'escrowId must be a number' })

  let buyer: Address
  let status: number
  try {
    ;[buyer, , , status] = await publicClient.readContract({
      address: AGENT_ECO_ADDRESS,
      abi: ESCROW_BASIC_ABI,
      functionName: 'getEscrowBasic',
      args: [BigInt(escrowId)],
    })
  } catch {
    return res.status(400).json({ error: 'Could not read this escrow on-chain — is the id correct?' })
  }

  if (buyer.toLowerCase() !== auth.wallet.toLowerCase()) {
    return res.status(403).json({ error: "Only this escrow's buyer can describe its dispute" })
  }
  if (!DISPUTABLE_STATUSES.has(status)) {
    return res.status(400).json({ error: 'This escrow is not delivered or disputed' })
  }

  const saved = await prisma.disputeReason.upsert({
    where: { escrowId },
    create: { escrowId, buyerWallet: auth.wallet, reason: parsed.data.reason },
    update: { reason: parsed.data.reason },
  })
  res.json(saved)
})
