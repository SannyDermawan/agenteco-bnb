import type { DiscoveredAgent, OnchainClients } from '../../../agent-runtime/src/index.ts'
import { getOnchainReputation } from './reputation.ts'

export interface SellerFilters {
  minSuccessRate: number | null
  minCompletedJobs: number | null
  /**
   * Minimum average buyer rating on the contract's 1–100 scale (the UI shows
   * it as stars × 20). Stored in the agent's minReputation column.
   */
  minReputation: number | null
}

/**
 * "Recommended" (all three filters null) just picks the cheapest agent the
 * buyer can afford to open a negotiation with (see `checkPolicy`); if that one
 * walks away, the host tries the next. "Custom" additionally requires live on-chain reputation
 * meeting the buyer's thresholds — reputation is never trusted from the
 * registry row, only from AgentEco.sol itself.
 */
export async function selectSeller(
  onchain: OnchainClients,
  candidates: DiscoveredAgent[],
  checkPolicy: (price: number) => boolean,
  filters: SellerFilters
): Promise<DiscoveredAgent | null> {
  const affordable = candidates.filter((c) => checkPolicy(Number(c.price)))
  const hasCustomFilter =
    filters.minSuccessRate !== null || filters.minCompletedJobs !== null || filters.minReputation !== null

  let qualified = affordable
  if (hasCustomFilter) {
    const checked = await Promise.all(
      affordable.map(async (candidate) => {
        if (!candidate.walletAddress) return null
        const rep = await getOnchainReputation(onchain.publicClient, candidate.walletAddress as `0x${string}`)
        const okSuccess = filters.minSuccessRate === null || rep.successRatePct >= filters.minSuccessRate
        const okCompleted = filters.minCompletedJobs === null || rep.completedJobs >= filters.minCompletedJobs
        // A minimum rating excludes sellers nobody has rated yet.
        const okRating =
          filters.minReputation === null || (rep.avgRatingScore !== null && rep.avgRatingScore >= filters.minReputation)
        return okSuccess && okCompleted && okRating ? candidate : null
      })
    )
    qualified = checked.filter((c): c is DiscoveredAgent => c !== null)
  }

  if (qualified.length === 0) return null
  return [...qualified].sort((a, b) => Number(a.price) - Number(b.price))[0]
}
