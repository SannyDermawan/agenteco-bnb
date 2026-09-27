import { Router } from 'express'
import { prisma } from '../db.ts'
import { isAuthorizedForAgent, verifyOwnerAuth } from '../auth.ts'
import { fundOrderSchema, listOrdersQuerySchema } from '../schemas/order.ts'

export const ordersRouter = Router()

const fullInclude = {
  buyerAgent: true,
  sellerAgent: true,
  negotiation: { include: { messages: { orderBy: { createdAt: 'asc' as const } } } },
}

ordersRouter.get('/', async (req, res) => {
  const parsed = listOrdersQuerySchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { agentId, ownerWallet, status } = parsed.data

  const orders = await prisma.order.findMany({
    where: {
      ...(agentId && { OR: [{ buyerAgentId: agentId }, { sellerAgentId: agentId }] }),
      ...(ownerWallet && {
        OR: [
          { buyerAgent: { ownerWallet: { equals: ownerWallet, mode: 'insensitive' } } },
          { sellerAgent: { ownerWallet: { equals: ownerWallet, mode: 'insensitive' } } },
        ],
      }),
      ...(status && { status }),
    },
    include: fullInclude,
    orderBy: { createdAt: 'desc' },
  })
  res.json(orders)
})

ordersRouter.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: fullInclude })
  if (!order) return res.status(404).json({ error: 'Order not found' })
  res.json(order)
})

// Called once the buyer actually funds the on-chain escrow (RequestServiceCard
// or, later, the buyer agent itself). From here AgentEco.sol is the source of
// truth for status — this just remembers which escrowId belongs to which order.
ordersRouter.patch('/:id/escrow', async (req, res) => {
  const auth = await verifyOwnerAuth(req)
  if (!auth.ok) return res.status(401).json({ error: auth.error })

  const parsed = fundOrderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { buyerAgent: true } })
  if (!order) return res.status(404).json({ error: 'Order not found' })
  if (order.status === 'funded') return res.status(400).json({ error: 'Order is already funded' })

  if (!isAuthorizedForAgent(auth.wallet, order.buyerAgent)) {
    return res.status(403).json({ error: 'Only the buyer agent owner (or the agent itself) can attach an escrow to this order' })
  }

  // The task was linked to this escrow (and checked on-chain) just before — see routes/tasks.ts.
  const task = await prisma.task.findUnique({ where: { escrowId: parsed.data.escrowId }, select: { id: true } })

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: 'funded', escrowId: parsed.data.escrowId, ...(task && { taskId: task.id }) },
    include: fullInclude,
  })
  res.json(updated)
})
