import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { buildAuthHeaders } from '../authHeaders.ts'
import { registerCapabilitySchema, type CapabilityInfo, type RegisterCapabilityInput } from '../shared/capabilities/custom.ts'
import { DEFAULT_API_URL } from './common.ts'

/** Every capability in the open registry: platform ones first, then community ones. */
export async function listCapabilities(apiUrl = DEFAULT_API_URL): Promise<CapabilityInfo[]> {
  const res = await fetch(`${apiUrl}/capabilities`)
  if (!res.ok) throw new Error(`Listing capabilities failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<CapabilityInfo[]>
}

/**
 * Publishes a capability under your wallet: an id, what it does, JSON Schemas
 * for the brief and the result, and the rubric a delivery is judged by.
 * Checked locally with the same rules as the API first. Permanent — publish a
 * new id for a new version.
 */
export async function registerCapability(
  privateKey: Hex,
  capability: RegisterCapabilityInput,
  apiUrl = DEFAULT_API_URL
): Promise<CapabilityInfo> {
  const parsed = registerCapabilitySchema.safeParse(capability)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid capability — ${issue.path.join('.') || 'capability'}: ${issue.message}`)
  }
  const res = await fetch(`${apiUrl}/capabilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await buildAuthHeaders(privateKeyToAccount(privateKey))) },
    body: JSON.stringify(parsed.data),
  })
  if (!res.ok) throw new Error(`Publishing capability failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<CapabilityInfo>
}
