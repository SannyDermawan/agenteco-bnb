import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, keccak256, toHex, type Address } from 'viem'
import {
  DemoAgentRuntime,
  respondToNegotiation,
  listNegotiationsForAgent,
  countOffersBySide,
  isMyTurn,
  createOnchainClients,
  startOnchainExecution,
  markOnchainDelivered,
  getEscrowStatus,
  publishEscrowResult,
  type OnchainClients,
} from '../../../agent-runtime/src/index.ts'
import { decryptAgentKey } from '../agentKeyCrypto.ts'
import { prismaWithAgentKey } from '../db.ts'
import { log, logError } from '../log.ts'
import { warnIfLowGas } from '../gasWatch.ts'
import { API_URL, refundLeftover } from './buyerTaskHost.ts'
import { RPC_URL, TOKEN_SYMBOL, appChain } from '../network.ts'
import { readAllEscrows, type EscrowBasic } from '../../../agent-runtime/src/onchain/escrowIndex.ts'

// AgentEco.sol OrderStatus enum ordering.
const ON_CHAIN_FUNDED = 1
const ON_CHAIN_EXECUTING = 2
const ON_CHAIN_DELIVERED = 3
const ON_CHAIN_DISPUTED = 4
const ON_CHAIN_SETTLED = 5

export interface HostedSellerAgentRow {
  id: string
  name: string
  capabilities: string[]
  price: unknown // Prisma.Decimal
  minimumPrice: unknown
  agentWalletKey: string | null
  depositorWallet: string | null
  escrowScanBlock: bigint | null
}

/**
 * Escrows each seller has nothing left to do on, in memory only. After a host
 * restart everything is re-checked once — every step below is idempotent
 * against on-chain status, so that never double-executes anything.
 */
const finishedEscrows = new Map<string, Set<bigint>>()

const publicClient = createPublicClient({ chain: appChain, transport: http(RPC_URL) })

async function hasPublishedResult(escrowId: bigint): Promise<boolean> {
  const res = await fetch(`${API_URL}/escrow-results/${escrowId}`)
  return res.ok
}

/**
 * Executes one escrow as far as it can go this cycle: FUNDED -> EXECUTING ->
 * DELIVERED (+ publishes the plaintext result). Returns true once there's
 * nothing left for the seller to do on it.
 */
async function advanceEscrow(
  runtime: DemoAgentRuntime,
  onchain: OnchainClients,
  escrowId: bigint,
  capability: string
): Promise<boolean> {
  const label = runtime.config.name
  const status = await getEscrowStatus(onchain, escrowId)

  if (status === ON_CHAIN_FUNDED || status === ON_CHAIN_EXECUTING) {
    if (status === ON_CHAIN_FUNDED) {
      log(`[host:${label}] escrow #${escrowId} is funded — starting execution…`)
      await startOnchainExecution(onchain, escrowId)
    }
    // execute() is deterministic per capability, so the hash committed here
    // always matches the result published right after.
    const result = runtime.execute(capability)
    await markOnchainDelivered(onchain, escrowId, keccak256(toHex(JSON.stringify(result))))
    log(`[host:${label}] escrow #${escrowId} marked delivered.`)
    await publishEscrowResult(API_URL, escrowId.toString(), capability, result)
    return true
  }

  if (status === ON_CHAIN_DELIVERED || status === ON_CHAIN_SETTLED || status === ON_CHAIN_DISPUTED) {
    // Self-heal: delivered in an earlier cycle whose result publish failed.
    if (!(await hasPublishedResult(escrowId))) {
      await publishEscrowResult(API_URL, escrowId.toString(), capability, runtime.execute(capability))
      log(`[host:${label}] published missing result for escrow #${escrowId}.`)
    }
    return true
  }

  // CREATED (not funded yet) keeps waiting; REFUNDED is terminal.
  return status !== 0
}

/**
 * @param myEscrows every escrow naming this agent's wallet as seller — read
 *   from contract state by the caller, once per cycle for all sellers.
 */
export async function processHostedSellerTask(agentRow: HostedSellerAgentRow, myEscrows: EscrowBasic[]): Promise<void> {
  if (!agentRow.agentWalletKey || !agentRow.depositorWallet) return
  const capability = agentRow.capabilities[0]
  if (!capability) return

  const privateKey = decryptAgentKey(agentRow.agentWalletKey)
  const account = privateKeyToAccount(privateKey)
  const onchain = createOnchainClients(privateKey, RPC_URL)
  await warnIfLowGas(onchain.publicClient, account.address, `hosted seller "${agentRow.name}"`, 'hosted')

  const runtime = new DemoAgentRuntime({
    name: agentRow.name,
    role: 'seller',
    capabilities: agentRow.capabilities,
    description: 'Hosted seller agent.',
    basePrice: Number(agentRow.price),
    minimumPrice: agentRow.minimumPrice != null ? Number(agentRow.minimumPrice) : undefined,
  })

  // 1. Answer every negotiation waiting on the seller. Isolated so an API
  //    outage never blocks step 3 — funded escrows are on-chain obligations
  //    with an execution deadline, and only need the chain to be worked.
  try {
    const negotiations = await listNegotiationsForAgent(API_URL, agentRow.id, 'open')
    for (const negotiation of negotiations) {
      if (!isMyTurn(negotiation, 'seller')) continue
      const lastMessage = negotiation.messages[negotiation.messages.length - 1]
      const offeredPrice = Number(lastMessage.price)
      const decision = runtime.decideOnOffer(offeredPrice, countOffersBySide(negotiation, 'seller'))
      log(
        `[host:${agentRow.name}] negotiation ${negotiation.id}: incoming ${offeredPrice} ${TOKEN_SYMBOL} -> ${decision.action}` +
          (decision.action === 'counter' ? ` (${decision.price} ${TOKEN_SYMBOL})` : '')
      )
      await respondToNegotiation(API_URL, account, negotiation.id, {
        side: 'seller',
        action: decision.action,
        ...(decision.action === 'counter' ? { price: decision.price } : {}),
      })
    }
  } catch (error) {
    logError(`[host:${agentRow.name}] negotiations skipped this cycle`, error, 'HOST')
  }

  // 2. Work every escrow naming this wallet as seller — negotiated orders and
  //    direct "Request Service" hires alike, straight from contract state.
  let finished = finishedEscrows.get(agentRow.id)
  if (!finished) finishedEscrows.set(agentRow.id, (finished = new Set()))
  for (const escrow of myEscrows) {
    if (finished.has(escrow.id)) continue
    if (escrow.status === ON_CHAIN_FUNDED) log(`[host:${agentRow.name}] found funded escrow #${escrow.id}`)
    const done = await advanceEscrow(runtime, onchain, escrow.id, capability)
    if (done) finished.add(escrow.id)
  }

  // 4. Sweep settled earnings out to the owner — the agent wallet is only
  //    an operating wallet, not where the seller's money should sit.
  await refundLeftover(onchain, agentRow.depositorWallet as Address, agentRow.name, 'paid out earnings of')
}

export async function runSellerHostCycleOnce(): Promise<void> {
  // The only place (besides the buyer host) allowed to read agentWalletKey — see db.ts.
  const activeSellers = await prismaWithAgentKey.agent.findMany({ where: { role: 'seller', taskStatus: 'active', deletedAt: null } })
  if (activeSellers.length === 0) return

  // One batched read of every escrow for all sellers — no event logs, so it
  // keeps working on RPCs that prune history.
  const bySeller = new Map<string, EscrowBasic[]>()
  for (const escrow of await readAllEscrows(publicClient)) {
    const key = escrow.seller.toLowerCase()
    bySeller.set(key, [...(bySeller.get(key) ?? []), escrow])
  }

  for (const agentRow of activeSellers) {
    try {
      await processHostedSellerTask(agentRow, bySeller.get(agentRow.walletAddress?.toLowerCase() ?? '') ?? [])
    } catch (error) {
      logError(`[host:${agentRow.name}] cycle failed`, error, 'HOST')
    }
  }
}
