import type { Hex, LocalAccount } from 'viem'
import { buildAuthHeaders } from './authHeaders.ts'
import { createAndFundEscrow } from './onchain/escrow.ts'
import type { OnchainClients } from './onchain/clients.ts'

/** A stored task (backend/prisma: Task). `preimage` re-hashes to `taskHash`. */
export interface RegistryTask {
  id: string
  capability: string
  brief: unknown
  criteria: string
  price: string
  buyer: string
  seller: string
  nonce: string
  preimage: string
  taskHash: Hex
  escrowId: string | null
  verified: boolean
}

async function parseOrThrow<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) throw new Error(`${action} failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function createTask(
  apiUrl: string,
  buyer: LocalAccount,
  input: { capability: string; brief: unknown; criteria?: string | null; price: string | number; seller: string }
): Promise<RegistryTask> {
  const res = await fetch(`${apiUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await buildAuthHeaders(buyer)) },
    body: JSON.stringify({ ...input, criteria: input.criteria ?? undefined }),
  })
  return parseOrThrow(res, 'Creating task')
}

export async function linkTaskEscrow(apiUrl: string, buyer: LocalAccount, taskId: string, escrowId: string): Promise<RegistryTask> {
  const res = await fetch(`${apiUrl}/tasks/${taskId}/escrow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await buildAuthHeaders(buyer)) },
    body: JSON.stringify({ escrowId }),
  })
  return parseOrThrow(res, 'Linking task to escrow')
}

/** The task behind an escrow, or null when none was linked (public read). */
export async function getTaskByEscrow(apiUrl: string, escrowId: string): Promise<RegistryTask | null> {
  const res = await fetch(`${apiUrl}/tasks/by-escrow/${escrowId}`)
  if (res.status === 404) return null
  return parseOrThrow(res, 'Reading task')
}

/**
 * A buyer agent's whole hire, in the order spec §5 requires: store the task
 * (the API returns its taskHash) → createEscrow with that hash + fund → link
 * the escrow to the task (the API checks the chain agrees).
 */
export async function hireWithTask(
  apiUrl: string,
  clients: OnchainClients,
  input: { capability: string; brief: unknown; criteria?: string | null; price: string; seller: `0x${string}` }
): Promise<{ escrowId: bigint; task: RegistryTask }> {
  const task = await createTask(apiUrl, clients.account, input)
  const escrowId = await createAndFundEscrow(clients, input.seller, input.price, task.taskHash)
  const linked = await linkTaskEscrow(apiUrl, clients.account, task.id, escrowId.toString())
  return { escrowId, task: linked }
}
