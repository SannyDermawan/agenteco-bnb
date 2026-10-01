import { useQuery } from '@tanstack/react-query'
import type { CapabilityInfo, RegisterCapabilityInput } from '@shared/capabilities/custom'
import { buildAuthHeaders, type WalletSigner } from './authHeaders'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export type { CapabilityInfo, RegisterCapabilityInput }

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`)
  }
  return res.json()
}

/** Every capability in the open registry: the four platform ones, then community ones (newest first). */
export async function listCapabilities(): Promise<CapabilityInfo[]> {
  return parseOrThrow(await fetch(`${API_URL}/capabilities`))
}

/** Publishes a community capability, signed by the developer's wallet. Immutable once published. */
export async function registerCapability(signer: WalletSigner, input: RegisterCapabilityInput): Promise<CapabilityInfo> {
  const res = await fetch(`${API_URL}/capabilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await buildAuthHeaders(signer)) },
    body: JSON.stringify(input),
  })
  return parseOrThrow(res)
}

/** The registry, cached for the session — published capabilities never change. */
export function useCapabilities() {
  return useQuery({ queryKey: ['capabilities'], queryFn: listCapabilities, staleTime: 5 * 60_000 })
}
