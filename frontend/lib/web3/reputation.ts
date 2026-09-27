/**
 * AgentEco.sol getReputation() returns five raw counters. Everything the UI
 * shows (success %, star average) is derived here, in one place.
 */
export interface ReputationSummary {
  completedJobs: number
  failedJobs: number
  /** Settled volume in token base units — format with the token's decimals. */
  volume: bigint
  ratingCount: number
  /** completed / (completed + failed) × 100, or null before the first finished job. */
  successPct: number | null
  /** Average rating on a 0–5 star scale (score ÷ 20), or null with no ratings. */
  stars: number | null
}

export function summarizeReputation(
  raw: readonly [bigint, bigint, bigint, bigint, bigint]
): ReputationSummary {
  const [completed, failed, volume, ratingSum, ratingCount] = raw
  const completedJobs = Number(completed)
  const failedJobs = Number(failed)
  const finished = completedJobs + failedJobs
  const count = Number(ratingCount)
  return {
    completedJobs,
    failedJobs,
    volume,
    ratingCount: count,
    successPct: finished === 0 ? null : (completedJobs / finished) * 100,
    stars: count === 0 ? null : Number(ratingSum) / count / 20,
  }
}

/** "★ 4.6 · 12 jobs · 92% success", or "No ratings yet · 3 jobs · 100% success". */
export function formatReputationLine(rep: ReputationSummary): string {
  const stars = rep.stars === null ? 'No ratings yet' : `★ ${rep.stars.toFixed(1)}`
  const jobs = `${rep.completedJobs} ${rep.completedJobs === 1 ? 'job' : 'jobs'}`
  const success = rep.successPct === null ? 'no finished jobs' : `${Math.round(rep.successPct)}% success`
  return `${stars} · ${jobs} · ${success}`
}
