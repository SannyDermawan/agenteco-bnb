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
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'startExecution',
    args: [escrowId],
  })
  await clients.publicClient.waitForTransactionReceipt({ hash })
}

/** Seller side: deliver the task result (a hash of it — the payload itself lives off-chain/in logs). */
export async function markDelivered(clients: OnchainClients, escrowId: bigint, resultHash: `0x${string}`): Promise<void> {
  const hash = await clients.walletClient.writeContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'markDelivered',
    args: [escrowId, resultHash],
  })
  await clients.publicClient.waitForTransactionReceipt({ hash })
}

/** Buyer side: accept the delivered result and release payment in one call. */
export async function acceptAndSettle(clients: OnchainClients, escrowId: bigint): Promise<void> {
  const hash = await clients.walletClient.writeContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'acceptAndSettle',
    args: [escrowId],
  })
  await clients.publicClient.waitForTransactionReceipt({ hash })
}

export async function getEscrowStatus(clients: OnchainClients, escrowId: bigint): Promise<number> {
  return clients.publicClient.readContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'getEscrowStatus',
    args: [escrowId],
  })
}

