import type { LocalAccount } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { DemoAgentRuntime } from '../../agent-runtime/src/runtime.ts'
import { AGENT_ECO_ADDRESS, RPC_URL } from '../../agent-runtime/src/network.ts'
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
import { AGENT_ECO_ABI } from '../../agent-runtime/src/shared/abi.generated.ts'
import { hashPreimage, resultHash } from '../../agent-runtime/src/shared/hashes.ts'
import { isCapabilityId } from '../../agent-runtime/src/shared/capabilities/definitions.ts'
import { codeOnlyResult, prepareJob } from '../../agent-runtime/src/capabilities/prepare.ts'
import { getTaskByEscrow } from '../../agent-runtime/src/tasksClient.ts'
import { publishEscrowResult } from '../../agent-runtime/src/resultsClient.ts'
import { sellerAgentConfig } from './config.ts'

const API_URL = process.env.AGENTECO_API_URL ?? 'http://localhost:4000'
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000)
const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined

// Escrows with nothing left to do, in memory. After a restart each is re-checked
// once; every step is idempotent against on-chain status.
const finishedEscrows = new Set<bigint>()

// Results committed on-chain whose publish to the API failed — kept so the
// exact same object can be retried.
const unpublished = new Map<bigint, { capability: string; result: Record<string, unknown> }>()

// AgentEco.sol OrderStatus enum ordering.
const ON_CHAIN_CREATED = 0
const ON_CHAIN_FUNDED = 1
const ON_CHAIN_EXECUTING = 2

type Onchain = ReturnType<typeof createOnchainClients>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function publishPending(name: string, escrowId: bigint): Promise<void> {
  const pending = unpublished.get(escrowId)
  if (!pending) return
  try {
    await publishEscrowResult(API_URL, escrowId.toString(), pending.capability, pending.result)
    unpublished.delete(escrowId)
    console.log(`[${name}] published result for escrow #${escrowId}.`)
  } catch (error) {
    console.error(`[${name}] failed to publish result for escrow #${escrowId} — will retry:`, error)
  }
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
      `[${runtime.config.name}] negotiation ${negotiation.id}: incoming ${offeredPrice} -> ${decision.action}` +
        (decision.action === 'counter' ? ` (${decision.price})` : '')
    )

    await respondToNegotiation(API_URL, account, negotiation.id, {
      side: 'seller',
      action: decision.action,
      ...(decision.action === 'counter' ? { price: decision.price } : {}),
    })
  }
}

/**
 * One escrow, as far as it can go this cycle. Returns true once there's
 * nothing left to do on it. A task that doesn't check out is never started,
 * so the contract's accept timeout refunds the buyer.
 */
async function advanceEscrow(runtime: DemoAgentRuntime, onchain: Onchain, escrowId: bigint): Promise<boolean> {
  const name = runtime.config.name
  const status = await getEscrowStatus(onchain, escrowId)

  if (status !== ON_CHAIN_FUNDED && status !== ON_CHAIN_EXECUTING) {
    // CREATED keeps waiting; delivered/disputed/settled/refunded are done
    // (after a publish retry, if one is pending).
    if (unpublished.has(escrowId)) await publishPending(name, escrowId)
    return status !== ON_CHAIN_CREATED && !unpublished.has(escrowId)
  }

  // 1. The brief, from the API — the buyer links it right after funding.
  const task = await getTaskByEscrow(API_URL, escrowId.toString())
  if (!task) return false

  // 2. It must be exactly what the buyer committed on-chain, for this seller.
  const [taskHash] = await onchain.publicClient.readContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowHashes',
    args: [escrowId],
  })
  if (hashPreimage(task.preimage).toLowerCase() !== taskHash.toLowerCase()) {
    console.log(`[${name}] escrow #${escrowId}: task does not match the on-chain taskHash — not starting.`)
    return true
  }
  if (task.seller.toLowerCase() !== onchain.account.address.toLowerCase() || !isCapabilityId(task.capability) || !runtime.matchesCapability(task.capability)) {
    console.log(`[${name}] escrow #${escrowId}: task is not for this seller or capability — not starting.`)
    return true
  }

  // 3. Validate the brief and compute the result before accepting the job.
  const prepared = await prepareJob(task.capability, task.brief, { publicClient: onchain.publicClient, agentEcoAddress: AGENT_ECO_ADDRESS })
  if (!prepared.ok) {
    console.log(`[${name}] escrow #${escrowId}: ${prepared.reason} — not starting.`)
    return true
  }
  const result = codeOnlyResult(prepared.job)
  if (!result) {
    console.log(`[${name}] escrow #${escrowId}: "${task.capability}" needs a model, which this agent doesn't have — not starting.`)
    return true
  }

  // 4. Accept, deliver the hash, publish the plaintext.
  if (status === ON_CHAIN_FUNDED) {
    console.log(`[${name}] escrow #${escrowId}: brief is valid — starting execution…`)
    await startExecution(onchain, escrowId)
  }
  await markDelivered(onchain, escrowId, resultHash(result))
  console.log(`[${name}] escrow #${escrowId} marked delivered.`)
  unpublished.set(escrowId, { capability: task.capability, result })
  await publishPending(name, escrowId)
  return !unpublished.has(escrowId)
}

/**
 * Watches the chain directly for escrows naming this wallet as seller —
 * negotiated orders and direct "Request Service" hires alike.
 */
async function handleEscrows(runtime: DemoAgentRuntime, onchain: Onchain, sellerAddress: `0x${string}`): Promise<void> {
  // From contract state, not event logs — public BSC Testnet RPCs prune history after ~18 hours.
  const mine = (await readAllEscrows(onchain.publicClient)).filter(
    (e) => e.seller.toLowerCase() === sellerAddress.toLowerCase() && !finishedEscrows.has(e.id)
  )
  for (const { id } of mine) {
    try {
      if (await advanceEscrow(runtime, onchain, id)) finishedEscrows.add(id)
    } catch (error) {
      console.error(`[${runtime.config.name}] escrow #${id} failed this cycle — will retry:`, error)
    }
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
  console.log(`[${runtime.config.name}] price: ${runtime.config.basePrice} (floor: ${runtime.config.minimumPrice})`)

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
      await handleEscrows(runtime, onchain, account.address)
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
