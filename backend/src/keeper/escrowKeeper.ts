import { AGENT_ECO_ABI } from '../abi/agentEcoAbi.ts'
import { readAllEscrows } from '../../../agent-runtime/src/onchain/escrowIndex.ts'
import type { Clients } from '../clients.ts'
import type { KeeperConfig } from '../config.ts'
import { log, logError } from '../log.ts'
import { decideKeeperAction, FLAG_FOR_STATUS, type KeeperAction, type TimeoutFlags } from './decide.ts'

/** The AgentEco.sol view behind each timeout flag. */
const FLAG_READER = {
  acceptTimedOut: 'isAcceptTimedOut',
  executionTimedOut: 'isExecutionTimedOut',
  reviewExpired: 'isReviewExpired',
  disputeTimedOut: 'isDisputeTimedOut',
} as const satisfies Record<keyof TimeoutFlags, string>

const ACTION_REASON: Record<NonNullable<KeeperAction>, string> = {
  claimAcceptTimeout: 'seller never started the funded job',
  claimExecutionTimeout: 'seller missed the execution deadline',
  finalizeAfterReviewWindow: 'buyer let the review window expire',
  claimDisputeTimeout: 'arbiter missed the dispute deadline',
}

async function submitKeeperTx(
  clients: Clients,
  config: KeeperConfig,
  escrowId: bigint,
  functionName: NonNullable<KeeperAction>
): Promise<void> {
  if (config.dryRun) {
    log(`[DRY RUN] Would submit ${functionName}(#${escrowId}) — no transaction sent.`)
    return
  }

  try {
    // Simulate first: catches a stale/ineligible escrow (e.g. someone
    // else's keeper already claimed it) before we spend gas.
    const { request } = await clients.publicClient.simulateContract({
      address: config.agentEcoAddress,
      abi: AGENT_ECO_ABI,
      functionName,
      args: [escrowId],
      account: clients.account,
    })

    log(`Submitting ${functionName}(#${escrowId})`)
    const hash = await clients.walletClient.writeContract(request)
    log(`Transaction: ${hash}`)

    // Awaiting the receipt here — not just the hash — is what guarantees
    // this escrow can't be double-submitted: processEscrow() is only
    // called sequentially within a cycle, and cycles never overlap
    // (see index.ts), so nothing else touches this escrowId until this
    // resolves.
    const receipt = await clients.publicClient.waitForTransactionReceipt({ hash })
    log(
      `${functionName}(#${escrowId}) ${receipt.status === 'success' ? 'succeeded' : 'reverted'} — ` +
        `block ${receipt.blockNumber}, tx ${receipt.transactionHash}`
    )
  } catch (error) {
    logError(`${functionName}(#${escrowId}) failed`, error)
  }
}

async function processEscrow(clients: Clients, config: KeeperConfig, escrowId: bigint, status: number): Promise<void> {
  try {
    // Only the flag that matters for this status is read (one RPC call, not four).
    const flag = FLAG_FOR_STATUS[status]
    if (!flag) return
    const flagValue = await clients.publicClient.readContract({
      address: config.agentEcoAddress,
      abi: AGENT_ECO_ABI,
      functionName: FLAG_READER[flag],
      args: [escrowId],
    })

    const action = decideKeeperAction(status, { [flag]: flagValue })
    if (!action) return

    log(`Escrow #${escrowId}: ${ACTION_REASON[action]} — calling ${action}`)
    await submitKeeperTx(clients, config, escrowId, action)
  } catch (error) {
    logError(`Failed checking escrow #${escrowId}`, error)
  }
}

/**
 * One full keeper pass: read every escrow's status straight from the contract
 * (batched — no event logs, so it works on RPCs that prune history), then act
 * on each one that can time out. Escrows are processed sequentially so a slow
 * or stuck transaction can't cause overlapping submissions.
 */
export async function runKeeperCycle(clients: Clients, config: KeeperConfig): Promise<void> {
  const escrows = await readAllEscrows(clients.publicClient)
  const live = escrows.filter((e) => FLAG_FOR_STATUS[e.status] !== undefined)
  if (live.length) log(`${escrows.length} escrows, ${live.length} live — checking timeouts`)

  for (const escrow of live) {
    await processEscrow(clients, config, escrow.id, escrow.status)
  }
}
