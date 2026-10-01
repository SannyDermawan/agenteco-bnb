import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { createPublicClient, type Address } from 'viem'
import { prisma } from '../db.ts'
import { buildResultPreimage, hashPreimage } from '../../../agent-runtime/src/shared/hashes.ts'
import { agentEcoFor, appChain, appTransport } from '../network.ts'
import { createEscrowResultSchema } from '../schemas/escrowResult.ts'
import { guardEscrow } from '../access.ts'

export const escrowResultsRouter = Router()

const RESULT_HASH_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'escrowId', type: 'uint256' }],
    name: 'getResultHash',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })

// The delivered work belongs to the deal: only its buyer, seller and the
// arbiter can read it (and re-hash it against the chain).
escrowResultsRouter.get('/:escrowId', async (req, res) => {
  if (!(await guardEscrow(req, res, req.params.escrowId))) return
  const result = await prisma.escrowResult.findUnique({ where: { escrowId: req.params.escrowId } })
  if (!result) return res.status(404).json({ error: 'No result recorded for this escrow' })
  res.json(result)
})

// Anyone can attempt to submit one too — instead of an owner-wallet check,
// this verifies the result actually hashes to what the seller already
// committed on-chain via markDelivered. A mismatched or premature submission
// is rejected by that check, not by who's asking.
escrowResultsRouter.post('/', async (req, res) => {
  const parsed = createEscrowResultSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { escrowId, capability, result } = parsed.data

  let onChainHash: `0x${string}`
  try {
    onChainHash = await publicClient.readContract({
      address: agentEcoFor(BigInt(escrowId)),
      abi: RESULT_HASH_ABI,
      functionName: 'getResultHash',
      args: [BigInt(escrowId)],
    })
  } catch {
    return res.status(400).json({ error: 'Could not read this escrow on-chain — is the id correct?' })
  }

  // Hash the exact JSON text and keep it: jsonb reorders keys, so only the
  // stored text lets anyone re-hash the result against the chain later.
  const resultJson = buildResultPreimage(result)
  const computedHash = hashPreimage(resultJson)
  if (computedHash.toLowerCase() !== onChainHash.toLowerCase()) {
    return res.status(400).json({
      error: 'Result does not match the hash already committed on-chain for this escrow (markDelivered must run first).',
    })
  }

  const saved = await prisma.escrowResult.upsert({
    where: { escrowId },
    create: { escrowId, capability, result: result as Prisma.InputJsonValue, resultJson, resultHash: computedHash },
    update: { capability, result: result as Prisma.InputJsonValue, resultJson, resultHash: computedHash },
  })
  res.status(201).json(saved)
})
