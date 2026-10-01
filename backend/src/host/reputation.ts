import type { Address, PublicClient } from 'viem'
import { AGENT_ECO_ABI, AGENT_ECO_ADDRESS } from '../../../agent-runtime/src/onchain/abi.ts'
import { LEGACY_AGENT_ECO_ADDRESS } from '../../../agent-runtime/src/network.ts'

export interface OnchainReputation {
  completedJobs: number
  failedJobs: number
  /** completed / (completed + failed) × 100; 0 before the first finished job. */
  successRatePct: number
  ratingCount: number
  /** Average buyer rating on the contract's 1–100 scale; null with no ratings. */
  avgRatingScore: number | null
}

/**
 * Raw on-chain reputation, as AgentEco.sol reports it — summed over the
 * current deployment and the legacy one, so a seller keeps its history.
 */
export async function getOnchainReputation(publicClient: PublicClient, address: Address): Promise<OnchainReputation> {
  const contracts = LEGACY_AGENT_ECO_ADDRESS ? [AGENT_ECO_ADDRESS, LEGACY_AGENT_ECO_ADDRESS] : [AGENT_ECO_ADDRESS]
  const reads = await Promise.all(
    contracts.map((contract) => publicClient.readContract({ address: contract, abi: AGENT_ECO_ABI, functionName: 'getReputation', args: [address] }))
  )
  let [completed, failed, ratingSum, ratingCount] = [BigInt(0), BigInt(0), BigInt(0), BigInt(0)]
  for (const [c, f, , sum, count] of reads) {
    completed += c
    failed += f
    ratingSum += sum
    ratingCount += count
  }
  const completedJobs = Number(completed)
  const failedJobs = Number(failed)
  const finished = completedJobs + failedJobs
  const count = Number(ratingCount)
  return {
    completedJobs,
    failedJobs,
    successRatePct: finished === 0 ? 0 : (completedJobs / finished) * 100,
    ratingCount: count,
    avgRatingScore: count === 0 ? null : Number(ratingSum) / count,
  }
}
