import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { CAPABILITIES, isCapabilityId } from '../../../agent-runtime/src/shared/capabilities/definitions.ts'
import { canonicalize } from '../../../agent-runtime/src/shared/hashes.ts'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { prisma, prismaWithAgentKey } from '../db.ts'
import { verifyOwnerAuth } from '../auth.ts'
import { encryptAgentKey } from '../agentKeyCrypto.ts'
import { findBlockingWork, withdrawHostedWallet } from '../agentDeletion.ts'
import { createAgentSchema, listAgentsQuerySchema, updateAgentSchema } from '../schemas/agent.ts'

export const agentsRouter = Router()

agentsRouter.get('/', async (req, res) => {
  const parsed = listAgentsQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const { role, isOnline, capability, ownerWallet, taskStatus, q } = parsed.data

  const agents = await prisma.agent.findMany({
    where: {
      deletedAt: null,
      ...(role && { role }),
      ...(isOnline !== undefined && { isOnline }),
      ...(capability && { capabilities: { has: capability } }),
      ...(ownerWallet && { ownerWallet: { equals: ownerWallet, mode: 'insensitive' } }),
      ...(taskStatus && { taskStatus }),
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { service: { contains: q, mode: 'insensitive' } },
        ],
      }),
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json(agents)
})

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

agentsRouter.get('/:id', async (req, res) => {
  // Postgres rejects a non-uuid id outright — that's a 404, not a server error.
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Agent not found' })
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } })
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  res.json(agent)
})

// Creating an agent claims a wallet as its owner — that claim must be
// backed by a signature, or anyone could register agents "owned by"
// addresses they don't control.
agentsRouter.post('/', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })

  const parsed = createAgentSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }

  const { hosted, ...agentData } = parsed.data

  // A hosted buyer task (or a seller created with hosted: true) gets its own
  // wallet — the host runtime signs with it directly, so the human never has
  // to keep MetaMask open once it's funded. See agentKeyCrypto.ts for the
  // (testnet-only) custodial trade-off.
  const hostedFields: Partial<Prisma.AgentCreateInput> = {}
  if (agentData.role === 'buyer' || hosted) {
    const agentPrivateKey = generatePrivateKey()
    const agentAccount = privateKeyToAccount(agentPrivateKey)
    hostedFields.walletAddress = agentAccount.address
    hostedFields.agentWalletKey = encryptAgentKey(agentPrivateKey)
    hostedFields.taskStatus = 'awaiting_deposit'
    hostedFields.depositorWallet = auth.wallet
  }
  if (agentData.role === 'seller' && hosted) {
    // Hidden from buyers until activated — nothing would answer them yet.
    hostedFields.isOnline = false
    const { getChainHead } = await import('../hostedDeposit.ts')
    hostedFields.escrowScanBlock = await getChainHead()
  }

  // Store the brief as its schema normalised it (trimmed text, lowercase coin
  // ids…) — exactly what the seller will execute.
  const capability = agentData.capabilities[0]
  if (agentData.taskBrief !== undefined && capability && isCapabilityId(capability)) {
    agentData.taskBrief = canonicalize(CAPABILITIES[capability].input.parse(agentData.taskBrief))
  }

  const agent = await prisma.agent.create({
    data: { ...agentData, ownerWallet: auth.wallet, ...hostedFields } as Prisma.AgentCreateInput,
  })
  res.status(201).json(agent)
})

// The human confirms they've sent the deposit to the agent's wallet — a
// buyer needs the token (maxBudget) plus a little native gas for the host
// runtime's own transactions; a seller only needs the gas. Verified on-chain here,
// not just trusted — the same "prove it, don't claim it" pattern as
// everything else that moves money in this app.
agentsRouter.post('/:id/activate', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })

  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } })
  if (!agent || agent.deletedAt) return res.status(404).json({ error: 'Agent not found' })
  if (!agent.walletAddress || agent.taskStatus === null) {
    return res.status(400).json({ error: 'This agent is not hosted by AgentEco' })
  }
  if (auth.wallet.toLowerCase() !== agent.ownerWallet.toLowerCase()) {
    return res.status(403).json({ error: 'Only the agent owner can activate it' })
  }
  if (agent.taskStatus !== 'awaiting_deposit') {
    return res.status(400).json({ error: `Agent is already ${agent.taskStatus}` })
  }

  const { checkHostedDeposit } = await import('../hostedDeposit.ts')
  const isSeller = agent.role === 'seller'
  const requiredUsdt = isSeller ? '0' : agent.maxBudget!.toString()
  const check = await checkHostedDeposit(agent.walletAddress as `0x${string}`, requiredUsdt)
  if (!check.ok) return res.status(400).json({ error: check.error })

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    // A hosted seller goes live in the marketplace only now that the host can actually serve it.
    data: { taskStatus: 'active', ...(isSeller && { isOnline: true }) },
  })
  res.json(updated)
})

agentsRouter.patch('/:id', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })

  const parsed = updateAgentSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const existing = await prisma.agent.findUnique({ where: { id: req.params.id } })
  if (!existing || existing.deletedAt) return res.status(404).json({ error: 'Agent not found' })

  if (auth.wallet.toLowerCase() !== existing.ownerWallet.toLowerCase()) {
    return res.status(403).json({ error: 'Only the agent owner can update this agent' })
  }
  if (parsed.data.isOnline && existing.role === 'seller' && existing.taskStatus === 'awaiting_deposit') {
    return res.status(400).json({ error: 'Deposit gas and activate this agent before putting it online' })
  }

  const agent = await prisma.agent.update({
    where: { id: req.params.id },
    data: parsed.data as Prisma.AgentUpdateInput,
  })
  res.json(agent)
})

// Soft delete (see schema.prisma) — refused while the agent is mid-deal, so
// no counterparty is left stranded. A hosted agent's own wallet is emptied
// back to its funder first; its key stays encrypted in the row, unused.
agentsRouter.delete('/:id', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })

  // The only route allowed to read agentWalletKey — it has to sign the withdrawal.
  const agent = await prismaWithAgentKey.agent.findUnique({ where: { id: req.params.id } })
  if (!agent || agent.deletedAt) return res.status(404).json({ error: 'Agent not found' })
  if (auth.wallet.toLowerCase() !== agent.ownerWallet.toLowerCase()) {
    return res.status(403).json({ error: 'Only the agent owner can delete this agent' })
  }

  const blocking = await findBlockingWork(agent)
  if (blocking) return res.status(409).json({ error: blocking })

  if (agent.agentWalletKey && agent.depositorWallet) {
    try {
      await withdrawHostedWallet(agent.agentWalletKey, agent.depositorWallet as `0x${string}`, agent.name)
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : 'unknown error'
      return res.status(502).json({ error: `Could not return the agent wallet's funds, so nothing was deleted: ${reason}` })
    }
  }

  await prisma.$transaction([
    prisma.negotiation.updateMany({
      where: { status: 'open', OR: [{ buyerAgentId: agent.id }, { sellerAgentId: agent.id }] },
      data: { status: 'rejected' },
    }),
    prisma.agent.update({ where: { id: agent.id }, data: { deletedAt: new Date(), isOnline: false } }),
  ])
  res.status(204).end()
})
