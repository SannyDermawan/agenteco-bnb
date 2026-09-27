'use client'
import { NeumorphicCard } from './NeumorphicCard'
import { useReputation } from '@/lib/web3/hooks'

/**
 * For an agent with an on-chain wallet, reputation is read live from
 * AgentEco.sol (the contract remains the sole source of truth) instead of
 * whatever static value the registry/mock data carries.
 */
export function AgentReputationStats({
  price,
  walletAddress,
  fallback,
}: {
  price: number
  walletAddress?: `0x${string}`
  fallback: { completedJobs: number; successRate: number; reputation: number }
}) {
  const { data } = useReputation(walletAddress)

  const completedJobs = data ? data.completedJobs : fallback.completedJobs
  const successRate = data ? (data.successPct === null ? '—' : `${Math.round(data.successPct)}%`) : `${fallback.successRate}%`
  const rating = data?.stars != null ? `★ ${data.stars.toFixed(1)}` : 'No ratings yet'
  const ratingCount = data?.ratingCount ?? 0

  return (
    <NeumorphicCard className="grid grid-cols-2 gap-5 p-6 sm:grid-cols-4">
      <div>
        <div className="text-[18px] font-semibold text-[#F5F5F7]">{price.toFixed(2)} USDT</div>
        <div className="mt-0.5 text-[11.5px] text-[#8B8D96]">Pricing</div>
      </div>
      <div>
        <div className="text-[18px] font-semibold text-[#F5F5F7]">{completedJobs}</div>
        <div className="mt-0.5 text-[11.5px] text-[#8B8D96]">Completed Jobs</div>
      </div>
      <div>
        <div className="text-[18px] font-semibold text-[#F5F5F7]">{successRate}</div>
        <div className="mt-0.5 text-[11.5px] text-[#8B8D96]">Success Rate</div>
      </div>
      <div>
        <div className="text-[18px] font-semibold text-[#F5F5F7]">{rating}</div>
        <div className="mt-0.5 text-[11.5px] text-[#8B8D96]">
          Rating{ratingCount > 0 ? ` · ${ratingCount} ${ratingCount === 1 ? 'review' : 'reviews'}` : ''}
        </div>
      </div>
    </NeumorphicCard>
  )
}
