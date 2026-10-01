import { decodeEventLog, parseUnits, type Address, type Hex, type TransactionReceipt } from 'viem'
import {
  AGENT_ECO_ABI,
  AGENT_ECO_ADDRESS,
  ERC20_ABI,
  EXECUTION_WINDOW_SECONDS,
  REVIEW_WINDOW_SECONDS,
  USDT_ADDRESS,
} from './abi.ts'
import type { OnchainClients } from './clients.ts'
import { agentEcoFor } from '../network.ts'

export function parseCreatedEscrowId(receipt: TransactionReceipt): bigint | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== AGENT_ECO_ADDRESS.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: AGENT_ECO_ABI, data: log.data, topics: log.topics })
      if (decoded.eventName === 'EscrowCreated') {
        return (decoded.args as { escrowId: bigint }).escrowId
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Buyer side: create the escrow for the negotiated price, committing the task's
 * hash (see ../shared/hashes.ts), then fund it.
 */
export async function createAndFundEscrow(
  clients: OnchainClients,
  sellerAddress: Address,
  priceUsdt: number | string,
  taskHash: Hex
): Promise<bigint> {
  const { account, publicClient, walletClient } = clients
  const decimals = await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'decimals',
  })
  const amount = parseUnits(priceUsdt.toString(), decimals)

  const createHash = await walletClient.writeContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'createEscrow',
    args: [sellerAddress, amount, EXECUTION_WINDOW_SECONDS, REVIEW_WINDOW_SECONDS, taskHash],
  })
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash })
  const escrowId = parseCreatedEscrowId(createReceipt)
  if (escrowId === null) throw new Error('Could not read the new escrow id from the createEscrow receipt.')

  const allowance = await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, AGENT_ECO_ADDRESS],
  })
  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      address: USDT_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [AGENT_ECO_ADDRESS, amount],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
  }

  const fundHash = await walletClient.writeContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'fundEscrow',
    args: [escrowId],
  })
  await publicClient.waitForTransactionReceipt({ hash: fundHash })

  return escrowId
}

/** Seller side: move a funded escrow into EXECUTING. */
export async function startExecution(clients: OnchainClients, escrowId: bigint): Promise<void> {
  const hash = await clients.walletClient.writeContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'startExecution',
    args: [escrowId],
  })
  await clients.publicClient.waitForTransactionReceipt({ hash })
}

/** Seller side: deliver the task result (a hash of it — the payload itself lives off-chain/in logs). */
export async function markDelivered(clients: OnchainClients, escrowId: bigint, resultHash: `0x${string}`): Promise<void> {
  const hash = await clients.walletClient.writeContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'markDelivered',
    args: [escrowId, resultHash],
  })
  await clients.publicClient.waitForTransactionReceipt({ hash })
}

/** Buyer side: accept the delivered result and release payment in one call. */
export async function acceptAndSettle(clients: OnchainClients, escrowId: bigint): Promise<void> {
  const hash = await clients.walletClient.writeContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'acceptAndSettle',
    args: [escrowId],
  })
  await clients.publicClient.waitForTransactionReceipt({ hash })
}

export async function getEscrowStatus(clients: OnchainClients, escrowId: bigint): Promise<number> {
  return clients.publicClient.readContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowStatus',
    args: [escrowId],
  })
}


async function writeAndWait(
  clients: OnchainClients,
  functionName: 'raiseDispute' | 'submitDisputeResponse' | 'rateSeller' | 'resolveDisputeForSeller' | 'resolveDisputeForBuyer',
  args: readonly [bigint, ...unknown[]]
): Promise<`0x${string}`> {
  const hash = await clients.walletClient.writeContract({
    address: agentEcoFor(args[0]),
    abi: AGENT_ECO_ABI,
    functionName,
    args,
  } as never)
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (tx ${hash})`)
  return hash
}

/** Buyer side: dispute a delivered result. `reasonHash` = textHash(reason); the text goes to the API after. */
export function raiseDispute(clients: OnchainClients, escrowId: bigint, reasonHash: `0x${string}`) {
  return writeAndWait(clients, 'raiseDispute', [escrowId, reasonHash])
}

/** Seller side: answer a dispute once, before its deadline. */
export function submitDisputeResponse(clients: OnchainClients, escrowId: bigint, responseHash: `0x${string}`) {
  return writeAndWait(clients, 'submitDisputeResponse', [escrowId, responseHash])
}

/** Buyer side: rate the seller 1–100, once, after the escrow is final and something was delivered. */
export function rateSeller(clients: OnchainClients, escrowId: bigint, score: number) {
  return writeAndWait(clients, 'rateSeller', [escrowId, score])
}

/**
 * Arbiter side: rule a dispute, committing the rationale's hash — only when the
 * arbiter is this wallet. ruleDispute (./arbiter.ts) also handles an ArbiterCouncil.
 */
export function resolveDispute(clients: OnchainClients, escrowId: bigint, toSeller: boolean, rationaleHash: `0x${string}`) {
  return writeAndWait(clients, toSeller ? 'resolveDisputeForSeller' : 'resolveDisputeForBuyer', [escrowId, rationaleHash])
}

/** getEscrowDisputeInfo: dispute timing, the accept deadline and whether the buyer has rated. */
export async function getEscrowDisputeInfo(clients: Pick<OnchainClients, 'publicClient'>, escrowId: bigint) {
  const [disputedAt, disputeDeadline, acceptDeadline, rated] = await clients.publicClient.readContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowDisputeInfo',
    args: [escrowId],
  })
  return { disputedAt, disputeDeadline, acceptDeadline, rated }
}

/** getEscrowHashes: every hash committed for an escrow (0x00… until that stage happened). */
export async function getEscrowHashes(clients: Pick<OnchainClients, 'publicClient'>, escrowId: bigint) {
  const [taskHash, resultHash, disputeReasonHash, disputeResponseHash, resolutionHash] = await clients.publicClient.readContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowHashes',
    args: [escrowId],
  })
  return { taskHash, resultHash, disputeReasonHash, disputeResponseHash, resolutionHash }
}

/** getEscrowTimestamps: createdAt … settledAt (0 until reached). */
export async function getEscrowTimestamps(clients: Pick<OnchainClients, 'publicClient'>, escrowId: bigint) {
  const [createdAt, fundedAt, executingAt, deliveredAt, settledAt] = await clients.publicClient.readContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowTimestamps',
    args: [escrowId],
  })
  return { createdAt, fundedAt, executingAt, deliveredAt, settledAt }
}

/** getEscrowWindows: the negotiated windows, and their deadlines (0 until execution / delivery started). */
export async function getEscrowWindows(clients: Pick<OnchainClients, 'publicClient'>, escrowId: bigint) {
  const [executionWindow, reviewWindow, executionDeadline, reviewDeadline] = await clients.publicClient.readContract({
    address: agentEcoFor(escrowId),
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowWindows',
    args: [escrowId],
  })
  return { executionWindow, reviewWindow, executionDeadline, reviewDeadline }
}
