import { createPublicClient, http, type Address } from 'viem'
import { createOnchainClients } from '../../agent-runtime/src/index.ts'
import { decryptAgentKey } from './agentKeyCrypto.ts'
import { prisma } from './db.ts'
import { refundLeftover } from './host/buyerTaskHost.ts'

import { RPC_URL, appChain } from './network.ts'
import { readAllEscrows } from '../../agent-runtime/src/onchain/escrowIndex.ts'

const publicClient = createPublicClient({ chain: appChain, transport: http(RPC_URL) })

// AgentEco.sol OrderStatus: FUNDED, EXECUTING, DELIVERED, DISPUTED — money is
// locked and someone still has to act. CREATED/SETTLED/REFUNDED are safe.
const IN_PROGRESS_STATUSES = new Set([1, 2, 3, 4])
const STATUS_LABEL = ['CREATED', 'FUNDED', 'EXECUTING', 'DELIVERED', 'DISPUTED', 'SETTLED', 'REFUNDED']

type DeletableAgent = {
  id: string
  role: string
  walletAddress: string | null
  taskStatus: string | null
  escrowScanBlock: bigint | null
}

/**
 * Why this agent can't be deleted right now, or null if it can. Deleting
 * mid-deal would strand the counterparty: a hosted agent would stop acting,
 * and an agreed-but-unfunded deal would never get funded.
 */
export async function findBlockingWork(agent: DeletableAgent): Promise<string | null> {
  const orders = await prisma.order.findMany({
    where: { OR: [{ buyerAgentId: agent.id }, { sellerAgentId: agent.id }] },
    select: { status: true, escrowId: true },
  })

  if (orders.some((o) => o.status === 'agreed')) {
    return 'This agent has an agreed deal that has not been funded yet.'
  }

  // Every escrow this agent is part of: its orders' escrows, plus any escrow
  // naming its wallet (direct hires have no Order row). Read from contract
  // state — no event logs, so it works on RPCs that prune history.
  const orderEscrowIds = new Set(orders.filter((o) => o.escrowId).map((o) => o.escrowId!))
  const wallet = agent.walletAddress?.toLowerCase()
  for (const escrow of await readAllEscrows(publicClient)) {
    const involved =
      orderEscrowIds.has(escrow.id.toString()) ||
      (!!wallet && (escrow.seller.toLowerCase() === wallet || escrow.buyer.toLowerCase() === wallet))
    if (involved && IN_PROGRESS_STATUSES.has(escrow.status)) {
      return `On-chain order #${escrow.id} is still ${STATUS_LABEL[escrow.status]} — finish, settle, or refund it first.`
    }
  }
  return null
}

/**
 * Empties a hosted agent's own wallet back to whoever funded it: all USDT,
 * then all native gas token (tBNB / BOT) minus the gas for that last transfer.
 */
export async function withdrawHostedWallet(encryptedKey: string, to: Address, label: string): Promise<void> {
  const onchain = createOnchainClients(decryptAgentKey(encryptedKey), RPC_URL)
  await refundLeftover(onchain, to, label, 'returned')

  const [balance, gasPrice] = await Promise.all([
    onchain.publicClient.getBalance({ address: onchain.account.address }),
    onchain.publicClient.getGasPrice(),
  ])
  // Plain transfer = 21000 gas; doubled so a gas-price tick between quote and send can't make it fail.
  const fee = gasPrice * BigInt(21000) * BigInt(2)
  if (balance <= fee) return

  const hash = await onchain.walletClient.sendTransaction({ to, value: balance - fee })
  await onchain.publicClient.waitForTransactionReceipt({ hash })
}
