'use client'
import { useQuery } from '@tanstack/react-query'
import { getRatingSummaries, type ApiRatingSummary } from './api/judging'

/** The displayed rating of one seller wallet (same-owner ratings excluded). */
export function useSellerRating(wallet?: string) {
  return useQuery({
    queryKey: ['ratingSummaries', wallet?.toLowerCase()],
    enabled: !!wallet,
    staleTime: 30_000,
    queryFn: async (): Promise<ApiRatingSummary | null> => (await getRatingSummaries([wallet!]))[0] ?? null,
  })
}
