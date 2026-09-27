import type { Address, PublicClient } from 'viem'
import { AGENT_ECO_ABI, AGENT_ECO_ADDRESS } from '../../../agent-runtime/src/onchain/abi.ts'

export interface OnchainReputation {
  completedJobs: number
  failedJobs: number
  /** completed / (completed + failed) × 100; 0 before the first finished job. */
  successRatePct: number
  ratingCount: number
  /** Average buyer rating on the contract's 1–100 scale; null with no ratings. */
  avgRatingScore: number | null
}

/** Raw on-chain reputation, exactly as AgentEco.sol reports it. */
export async function getOnchainReputation(publicClient: PublicClient, address: Address): Promise<OnchainReputation> {
  const [completed, failed, , ratingSum, ratingCount] = await publicClient.readContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'getReputation',
    args: [address],
  })
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
