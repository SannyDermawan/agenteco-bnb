import type { LocalAccount } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hireWithTask } from '../../agent-runtime/src/tasksClient.ts'
import { DemoAgentRuntime } from '../../agent-runtime/src/runtime.ts'
import { RPC_URL } from '../../agent-runtime/src/network.ts'
import { discoverAgents, registerOrSyncSelf } from '../../agent-runtime/src/registryClient.ts'
import {
  countOffersBySide,
  isMyTurn,
  listNegotiationsForAgent,
  openNegotiation,
  respondToNegotiation,
} from '../../agent-runtime/src/negotiationClient.ts'
import { attachEscrowToOrder, listOrdersForAgent } from '../../agent-runtime/src/ordersClient.ts'
import { createOnchainClients } from '../../agent-runtime/src/onchain/clients.ts'
import { acceptAndSettle, getEscrowStatus } from '../../agent-runtime/src/onchain/escrow.ts'
import { discoverAndNegotiate } from './negotiate.ts'
import { buyerAgentConfig } from './config.ts'

const API_URL = process.env.AGENTECO_API_URL ?? 'http://localhost:4000'
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000)
const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined

const ON_CHAIN_DELIVERED = 3 // AgentEco.sol OrderStatus.DELIVERED

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handleNegotiations(runtime: DemoAgentRuntime, account: LocalAccount, agentId: string) {
  const negotiations = await listNegotiationsForAgent(API_URL, agentId, 'open')
  for (const negotiation of negotiations) {
    if (!isMyTurn(negotiation, 'buyer')) continue

    const lastMessage = negotiation.messages[negotiation.messages.length - 1]
    const offeredPrice = Number(lastMessage.price)
    const priorOffers = countOffersBySide(negotiation, 'buyer')
    const decision = runtime.decideOnOffer(offeredPrice, priorOffers)

    console.log(
      `[${runtime.config.name}] negotiation ${negotiation.id}: incoming ${offeredPrice} USDT -> ${decision.action}` +
        (decision.action === 'counter' ? ` (${decision.price} USDT)` : '')
    )

    await respondToNegotiation(API_URL, account, negotiation.id, {
      side: 'buyer',
      action: decision.action,
      ...(decision.action === 'counter' ? { price: decision.price } : {}),
    })
  }
}

async function handleAgreedOrders(
  runtime: DemoAgentRuntime,
  account: LocalAccount,
  onchain: ReturnType<typeof createOnchainClients>,
  agentId: string
) {
  const orders = await listOrdersForAgent(API_URL, agentId, 'agreed')
  for (const order of orders) {
    const sellerRes = await fetch(`${API_URL}/agents/${order.sellerAgentId}`)
    const seller = (await sellerRes.json()) as { walletAddress: `0x${string}` | null }
    if (!seller.walletAddress) {
      console.log(`[${runtime.config.name}] order ${order.id}: seller has no on-chain wallet — cannot fund.`)
      continue
    }

    console.log(`[${runtime.config.name}] order ${order.id}: funding escrow for ${order.price} USDT…`)
    // Store the task, escrow its hash, link the two (spec §5).
    const { escrowId, task } = await hireWithTask(API_URL, onchain, {
      capability: order.capability,
      brief: runtime.config.taskBrief,
      criteria: runtime.config.acceptanceCriteria,
      price: order.price,
      seller: seller.walletAddress,
    })
    await attachEscrowToOrder(API_URL, account, order.id, escrowId.toString())
    console.log(`[${runtime.config.name}] order ${order.id}: funded as escrow #${escrowId} (task ${task.taskHash.slice(0, 10)}…).`)
  }
}

async function handleDeliveredOrders(
  runtime: DemoAgentRuntime,
  onchain: ReturnType<typeof createOnchainClients>,
  agentId: string
) {
  const orders = await listOrdersForAgent(API_URL, agentId, 'funded')
  for (const order of orders) {
    if (!order.escrowId) continue
    const escrowId = BigInt(order.escrowId)

    const status = await getEscrowStatus(onchain, escrowId)
    if (status !== ON_CHAIN_DELIVERED) continue

    console.log(`[${runtime.config.name}] escrow #${escrowId} was delivered — accepting and settling…`)
    await acceptAndSettle(onchain, escrowId)
    console.log(`[${runtime.config.name}] escrow #${escrowId} settled. Payment released to the seller.`)
  }
}

async function main(): Promise<void> {
  if (!privateKey) {
    throw new Error(
      'Missing WALLET_PRIVATE_KEY in .env. Generate one with: node -e "console.log(require(\'viem/accounts\').generatePrivateKey())"'
    )
  }

  const account = privateKeyToAccount(privateKey)
  const onchain = createOnchainClients(privateKey, RPC_URL)
  const runtime = new DemoAgentRuntime(buyerAgentConfig)

  console.log(`[${runtime.config.name}] wallet: ${account.address}`)
  console.log(`[${runtime.config.name}] role: ${runtime.config.role}`)
  console.log(`[${runtime.config.name}] capabilities: ${runtime.config.capabilities.join(', ')}`)
  console.log(`[${runtime.config.name}] budget: up to ${runtime.config.maxBudget} USDT`)

  const agent = await registerOrSyncSelf(runtime.config, {
    apiUrl: API_URL,
    account,
  })
  console.log(`[${runtime.config.name}] registered in AgentEco registry as ${agent.id}`)

  // Discovery + opening offers (§10/§11) — a one-time "go shopping" pass at
  // startup. Everything after this (responding to counters, funding,
  // accepting delivery) is handled by the persistent loop below.
  await discoverAndNegotiate(runtime, API_URL, account, agent.id)

  console.log(
    `\n[${runtime.config.name}] watching negotiations/orders for funding & settlement… (polling every ${POLL_INTERVAL_MS}ms, Ctrl+C to stop)`
  )

  let running = true
  const shutdown = () => {
    running = false
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  while (running) {
    try {
      await handleNegotiations(runtime, account, agent.id)
      await handleAgreedOrders(runtime, account, onchain, agent.id)
      await handleDeliveredOrders(runtime, onchain, agent.id)
    } catch (error) {
      console.error(`[${runtime.config.name}] poll cycle failed:`, error)
    }
    if (running) await sleep(POLL_INTERVAL_MS)
  }

  console.log(`[${runtime.config.name}] stopped.`)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
