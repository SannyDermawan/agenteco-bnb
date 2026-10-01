import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { createPublicClient, parseUnits } from 'viem'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.ts'
import { verifyOwnerAuth } from '../auth.ts'
import { UUID_REGEX, canViewParties, guardEscrow, requireViewer } from '../access.ts'
import { AGENT_ECO_ABI } from '../abi/agentEcoAbi.ts'
import { ERC20_ABI } from '../../../agent-runtime/src/onchain/abi.ts'
import { agentEcoFor, USDT_ADDRESS, appChain, appTransport } from '../network.ts'
import { buildTaskPreimage, canonicalize, hashPreimage, normalizePrice } from '../../../agent-runtime/src/shared/hashes.ts'
import { CAPABILITIES, isCapabilityId } from '../../../agent-runtime/src/shared/capabilities/definitions.ts'
import { validateWithSchema } from '../../../agent-runtime/src/shared/capabilities/custom.ts'
import { getCapability } from '../capabilityRegistry.ts'
import { createTaskSchema, linkTaskEscrowSchema } from '../schemas/task.ts'

export const tasksRouter = Router()

const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })

/**
 * Step 1 of every hire (spec §5): store the task before createEscrow. The
 * server builds the preimage itself with the shared helper — the buyer is the
 * signed-in wallet, never a body field — and returns the taskHash the buyer
 * must pass to createEscrow.
 */
tasksRouter.post('/', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })

  const parsed = createTaskSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { capability, criteria, seller } = parsed.data

  // Platform capabilities validate with their zod schemas; community ones with their published JSON Schema.
  let brief: { data: unknown }
  if (isCapabilityId(capability)) {
    const checked = CAPABILITIES[capability].input.safeParse(parsed.data.brief)
    if (!checked.success) {
      return res.status(400).json({ error: `Invalid ${capability} brief: ${checked.error.issues.map((i) => i.message).join('; ')}` })
    }
    brief = checked
  } else {
    const info = await getCapability(capability)
    if (!info) return res.status(400).json({ error: `Unknown capability "${capability}" — publish it in the registry first.` })
    const checked = validateWithSchema(info.inputSchema, parsed.data.brief)
    if (!checked.ok) return res.status(400).json({ error: `Invalid ${capability} brief: ${checked.error}` })
    brief = checked
  }

  let price: string
  try {
    price = normalizePrice(parsed.data.price)
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message })
  }

  const input = {
    capability,
    brief: brief.data,
    criteria: criteria?.trim() ?? '',
    price,
    buyer: auth.wallet,
    seller,
    nonce: parsed.data.nonce ?? randomUUID(),
  }
  const preimage = buildTaskPreimage(input)
  const taskHash = hashPreimage(preimage)

  const task = await prisma.task.create({
    data: {
      capability,
      brief: canonicalize(brief.data) as Prisma.InputJsonValue,
      criteria: input.criteria,
      price,
      buyer: auth.wallet.toLowerCase(),
      seller: seller.toLowerCase(),
      nonce: input.nonce,
      preimage,
      taskHash,
    },
  })
  res.status(201).json(task)
})

/**
 * Step 2, after createEscrow: link the escrow. Accepted only when the chain
 * agrees — same taskHash, buyer, seller and amount — so a task can never be
 * attached to someone else's escrow or a different price. That on-chain
 * check is the proof, so no signature is needed: the buyer's browser saves a
 * wallet prompt, and anyone can finish a link a closed tab left undone.
 */
tasksRouter.post('/:id/escrow', async (req, res) => {
  const parsed = linkTaskEscrowSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'escrowId must be a number' })

  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Task not found' })
  const task = await prisma.task.findUnique({ where: { id: req.params.id } })
  if (!task) return res.status(404).json({ error: 'Task not found' })
  if (task.escrowId) {
    return task.escrowId === parsed.data.escrowId ? res.json(linkReceipt(task)) : res.status(409).json({ error: 'Task already linked to another escrow' })
  }

  const escrowId = BigInt(parsed.data.escrowId)
  let onchain: { buyer: string; seller: string; amount: bigint; taskHash: string }
  try {
    const [[buyer, seller, amount], [taskHash]] = await Promise.all([
      publicClient.readContract({ address: agentEcoFor(escrowId), abi: AGENT_ECO_ABI, functionName: 'getEscrowBasic', args: [escrowId] }),
      publicClient.readContract({ address: agentEcoFor(escrowId), abi: AGENT_ECO_ABI, functionName: 'getEscrowHashes', args: [escrowId] }),
    ])
    onchain = { buyer, seller, amount, taskHash }
  } catch {
    return res.status(400).json({ error: 'Could not read this escrow on-chain — is the id correct?' })
  }

  const decimals = await publicClient.readContract({ address: USDT_ADDRESS, abi: ERC20_ABI, functionName: 'decimals' })
  const problems = [
    onchain.taskHash.toLowerCase() !== task.taskHash.toLowerCase() && 'taskHash',
    onchain.buyer.toLowerCase() !== task.buyer && 'buyer',
    onchain.seller.toLowerCase() !== task.seller && 'seller',
    onchain.amount !== parseUnits(task.price, decimals) && 'amount',
  ].filter(Boolean)
  if (problems.length) {
    return res.status(400).json({ error: `Escrow #${escrowId} does not match this task (${problems.join(', ')} differ).` })
  }

  const linked = await prisma.task.update({ where: { id: task.id }, data: { escrowId: parsed.data.escrowId, verified: true } })
  res.json(linkReceipt(linked))
})

/** What an unsigned link call gets back: never the brief itself. */
function linkReceipt(task: { id: string; escrowId: string | null; taskHash: string; verified: boolean }) {
  return { id: task.id, escrowId: task.escrowId, taskHash: task.taskHash, verified: task.verified }
}

// The brief and its preimage — only for the escrow's buyer, seller and the
// arbiter, who can re-hash it against the chain.
tasksRouter.get('/by-escrow/:escrowId', async (req, res) => {
  const viewer = await guardEscrow(req, res, req.params.escrowId)
  if (!viewer) return
  const task = await prisma.task.findUnique({ where: { escrowId: req.params.escrowId } })
  if (!task) return res.status(404).json({ error: 'No task linked to this escrow' })
  res.json(task)
})

tasksRouter.get('/:id', async (req, res) => {
  const viewer = await requireViewer(req, res)
  if (!viewer) return
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Task not found' })
  const task = await prisma.task.findUnique({ where: { id: req.params.id } })
  if (!task) return res.status(404).json({ error: 'Task not found' })
  if (!(await canViewParties(viewer, { buyer: task.buyer, seller: task.seller }))) {
    return res.status(403).json({ error: 'This task is private — only its buyer, seller and the arbiter can see it.' })
  }
  res.json(task)
})
