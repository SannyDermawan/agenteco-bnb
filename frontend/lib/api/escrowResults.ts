const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export interface ApiEscrowResult {
  id: string
  escrowId: string
  capability: string
  result: Record<string, unknown>
  /** The exact text whose keccak256 is the on-chain resultHash. */
  resultJson: string | null
  resultHash: string
  createdAt: string
}

export async function getEscrowResult(escrowId: string): Promise<ApiEscrowResult | null> {
  const res = await fetch(`${API_URL}/escrow-results/${escrowId}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to load escrow result (${res.status})`)
  return res.json()
}
