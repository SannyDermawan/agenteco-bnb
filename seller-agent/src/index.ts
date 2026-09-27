import { keccak256, toHex, type LocalAccount } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { DemoAgentRuntime } from '../../agent-runtime/src/runtime.ts'
import { RPC_URL } from '../../agent-runtime/src/network.ts'
import { registerOrSyncSelf } from '../../agent-runtime/src/registryClient.ts'
import {
  countOffersBySide,
  isMyTurn,
  listNegotiationsForAgent,
  respondToNegotiation,
} from '../../agent-runtime/src/negotiationClient.ts'
import { createOnchainClients } from '../../agent-runtime/src/onchain/clients.ts'
import { getEscrowStatus, markDelivered, startExecution } from '../../agent-runtime/src/onchain/escrow.ts'
import { readAllEscrows } from '../../agent-runtime/src/onchain/escrowIndex.ts'
import { publishEscrowResult } from '../../agent-runtime/src/resultsClient.ts'
import { sellerAgentConfig } from './config.ts'

const API_URL = process.env.AGENTECO_API_URL ?? 'http://localhost:4000'
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000)
const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined

// Escrows with nothing left to do, in memory. After a restart each is re-checked
// once; every step is idempotent against on-chain status.
const finishedEscrows = new Set<bigint>()

// AgentEco.sol OrderStatus enum ordering.
const ON_CHAIN_FUNDED = 1
const ON_CHAIN_EXECUTING = 2
const ON_CHAIN_DELIVERED = 3
const ON_CHAIN_SETTLED = 5

async function publishResultSafely(runtime: DemoAgentRuntime, escrowId: bigint, capability: string): Promise<void> {
  const result = runtime.execute(capability)
  try {
    await publishEscrowResult(API_URL, escrowId.toString(), capability, result)
    console.log(`[${runtime.config.name}] published result for escrow #${escrowId}.`)
  } catch (error) {
    console.error(`[${runtime.config.name}] failed to publish result for escrow #${escrowId}:`, error)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handleNegotiations(runtime: DemoAgentRuntime, account: LocalAccount, agentId: string): Promise<void> {
  const negotiations = await listNegotiationsForAgent(API_URL, agentId, 'open')
  for (const negotiation of negotiations) {
    if (!isMyTurn(negotiation, 'seller')) continue

    const lastMessage = negotiation.messages[negotiation.messages.length - 1]
    const offeredPrice = Number(lastMessage.price)
    const priorOffers = countOffersBySide(negotiation, 'seller')
    const decision = runtime.decideOnOffer(offeredPrice, priorOffers)

    console.log(
      `[${runtime.config.name}] negotiation ${negotiation.id}: incoming ${offeredPrice} USDT -> ${decision.action}` +
        (decision.action === 'counter' ? ` (${decision.price} USDT)` : '')
    )

    await respondToNegotiation(API_URL, account, negotiation.id, {
      side: 'seller',
      action: decision.action,
      ...(decision.action === 'counter' ? { price: decision.price } : {}),
    })
  }
}

/**
 * Watches the chain directly for escrows naming this wallet as seller —
 * not just ones that happen to have a matching row in AgentEco's own
 * `orders` table. This is what makes a direct "Request Service" hire (which
 * never touches that table) get executed automatically too, closing the
 * gap where only negotiated orders used to be picked up.
 */
async function handleFundedEscrows(
  runtime: DemoAgentRuntime,
  onchain: ReturnType<typeof createOnchainClients>,
  sellerAddress: `0x${string}`
): Promise<void> {
  // Every escrow naming this wallet as seller, from contract state (no event
  // logs — public BSC Testnet RPCs prune history after ~18 hours).
  const mine = (await readAllEscrows(onchain.publicClient)).filter(
    (e) => e.seller.toLowerCase() === sellerAddress.toLowerCase() && !finishedEscrows.has(e.id)
  )
  const capability = runtime.config.capabilities[0]

  for (const { id: escrowId } of mine) {
    const status = await getEscrowStatus(onchain, escrowId)

    if (status === ON_CHAIN_FUNDED || status === ON_CHAIN_EXECUTING) {
      if (status === ON_CHAIN_FUNDED) {
        console.log(`[${runtime.config.name}] escrow #${escrowId} is funded — starting execution…`)
        await startExecution(onchain, escrowId)
      }

      const result = runtime.execute(capability)
      const resultHash = keccak256(toHex(JSON.stringify(result)))
      console.log(`[${runtime.config.name}] executed "${capability}" ->`, result)

      await markDelivered(onchain, escrowId, resultHash)
      console.log(`[${runtime.config.name}] escrow #${escrowId} marked delivered.`)
      await publishResultSafely(runtime, escrowId, capability)
      finishedEscrows.add(escrowId)
    } else if (status === ON_CHAIN_DELIVERED || status === ON_CHAIN_SETTLED) {
      // Already delivered — either by an earlier cycle, or (self-healing)
      // an escrow that was delivered before result-publishing existed.
      // execute() is deterministic per capability, so recomputing it here
      // reproduces the exact same hash already committed on-chain.
      await publishResultSafely(runtime, escrowId, capability)
      finishedEscrows.add(escrowId)
    }
    // Not funded yet, or disputed/refunded — nothing to do this cycle.
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
  const runtime = new DemoAgentRuntime(sellerAgentConfig)

  console.log(`[${runtime.config.name}] wallet: ${account.address}`)
  console.log(`[${runtime.config.name}] role: ${runtime.config.role}`)
  console.log(`[${runtime.config.name}] capabilities: ${runtime.config.capabilities.join(', ')}`)
  console.log(
    `[${runtime.config.name}] price: ${runtime.config.basePrice} USDT (floor: ${runtime.config.minimumPrice} USDT)`
  )

  const agent = await registerOrSyncSelf(runtime.config, {
    apiUrl: API_URL,
    account,
    walletAddress: account.address,
  })
  console.log(`[${runtime.config.name}] registered in AgentEco registry as ${agent.id}`)
  console.log(
    `[${runtime.config.name}] watching negotiations and on-chain escrows… (polling every ${POLL_INTERVAL_MS}ms, Ctrl+C to stop)`
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
      await handleFundedEscrows(runtime, onchain, account.address)
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
