import type { LocalAccount } from 'viem'
import type { AgentConfig } from './types.ts'
import { buildAuthHeaders } from './authHeaders.ts'

export interface RegistryAgent {
  id: string
  ownerWallet: string
  isOnline: boolean
}

export interface RegisterOptions {
  apiUrl: string
  /** This agent's own account — signs proof of ownership for the registry API. */
  account: LocalAccount
  /** On-chain payout wallet to advertise for this agent (sellers only, usually). */
  walletAddress?: string
}

async function parseOrThrow(res: Response, action: string): Promise<any> {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${action} failed (${res.status}): ${body}`)
  }
  return res.json()
}

export async function findOwnAgent(apiUrl: string, ownerWallet: string): Promise<RegistryAgent | null> {
  const res = await fetch(`${apiUrl}/agents?ownerWallet=${ownerWallet}`)
  const agents: RegistryAgent[] = await parseOrThrow(res, 'Registry lookup')
  return agents[0] ?? null
}

export interface DiscoveredAgent extends RegistryAgent {
  name: string
  role: 'buyer' | 'seller'
  capabilities: string[]
  price: string
  minimumPrice: string | null
  maxBudget: string | null
  walletAddress: string | null
}

/**
 * Search Agent (§10 Discovery) — an agent asks the registry "who offers
 * this capability?" the same way a human browsing the Marketplace would,
 * just through the API directly instead of a page.
 */
export async function discoverAgents(
  apiUrl: string,
  filters: { role?: 'buyer' | 'seller'; capability?: string; q?: string; onlineOnly?: boolean } = {}
): Promise<DiscoveredAgent[]> {
  const query = new URLSearchParams()
  if (filters.role) query.set('role', filters.role)
  if (filters.capability) query.set('capability', filters.capability)
  if (filters.q) query.set('q', filters.q)
  if (filters.onlineOnly) query.set('isOnline', 'true')

  const res = await fetch(`${apiUrl}/agents${query.toString() ? `?${query}` : ''}`)
  return parseOrThrow(res, 'Discovery search')
}

/**
 * Registers this agent in the AgentEco registry on first run, or syncs its
 * config on every later run — exactly what a real Bring-Your-Own-Agent
 * developer's server would do against the public AgentEco API (§4.2).
 * Every write is signed by the agent's own account (see backend/src/auth.ts)
 * — ownerWallet is proven, not just claimed.
 */
export async function registerOrSyncSelf(config: AgentConfig, options: RegisterOptions): Promise<RegistryAgent> {
  const payload = {
    name: config.name,
    description: config.description,
    role: config.role,
    category: config.category,
    service: config.service,
    capabilities: config.capabilities,
    price: config.basePrice,
    minimumPrice: config.minimumPrice,
    maxBudget: config.maxBudget,
    customInstructions: config.customInstructions,
    taskBrief: config.taskBrief,
    acceptanceCriteria: config.acceptanceCriteria,
    walletAddress: options.walletAddress,
    isOnline: true,
  }

  const ownerWallet = options.account.address
  const existing = await findOwnAgent(options.apiUrl, ownerWallet)
  const authHeaders = await buildAuthHeaders(options.account)

  if (existing) {
    const res = await fetch(`${options.apiUrl}/agents/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(payload),
    })
    return parseOrThrow(res, 'Registry sync')
  }

  const res = await fetch(`${options.apiUrl}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  })
  return parseOrThrow(res, 'Registry registration')
}
