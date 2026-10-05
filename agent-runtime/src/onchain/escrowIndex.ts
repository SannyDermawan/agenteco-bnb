import type { Address, PublicClient } from 'viem'
import { AGENT_ECO_ABI } from '../shared/abi.generated.ts'
import { AGENT_ECO_ADDRESS, FIRST_ESCROW_ID, LEGACY_DEPLOYMENTS, agentEcoFor, appChain } from '../network.ts'

/**
 * Escrow discovery from contract state, not event logs. Public BSC Testnet
 * RPCs either refuse eth_getLogs (the official data-seed nodes) or prune log
 * history after ~80,000 blocks (~18 hours, PublicNode) — so a log scan from the
 * deploy block breaks a day after deployment. AgentEco.sol numbers escrows
 * firstEscrowId..nextEscrowId-1 and exposes each one through getEscrowBasic,
 * which works against any RPC, forever.
 *
 * Legacy deployments (v1 and v2, see ../network.ts) come first, each within
 * its own id range; ids never overlap, so callers treat every contract as one
 * list and agentEcoFor(id) finds the right one.
 */

export interface EscrowBasic {
  id: bigint
  buyer: Address
  seller: Address
  amount: bigint
  status: number
}

async function idsOn(publicClient: PublicClient, address: Address, first: bigint, cap?: bigint): Promise<bigint[]> {
  const next = await publicClient.readContract({ address, abi: AGENT_ECO_ABI, functionName: 'nextEscrowId' })
  const end = cap !== undefined && cap < next ? cap : next
  const ids: bigint[] = []
  for (let id = first; id < end; id++) ids.push(id)
  return ids
}

/** Every escrow id that exists: each legacy deployment's, oldest first, then the current one's. */
export async function allEscrowIds(publicClient: PublicClient): Promise<bigint[]> {
  const lists = await Promise.all([
    ...LEGACY_DEPLOYMENTS.map((d) => idsOn(publicClient, d.address, d.firstEscrowId, d.endEscrowId)),
    idsOn(publicClient, AGENT_ECO_ADDRESS, FIRST_ESCROW_ID),
  ])
  return lists.flat()
}

/** Escrow ids on the current deployment only — the ones that can still change. */
export async function currentEscrowIds(publicClient: PublicClient): Promise<bigint[]> {
  return idsOn(publicClient, AGENT_ECO_ADDRESS, FIRST_ESCROW_ID)
}

const BATCH = 200

/** Reads getEscrowBasic for many ids — batched through Multicall3 when the chain has it. */
export async function readEscrowBasics(publicClient: PublicClient, ids: bigint[]): Promise<EscrowBasic[]> {
  const out: EscrowBasic[] = []
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const calls = chunk.map((id) => ({
      address: agentEcoFor(id),
      abi: AGENT_ECO_ABI,
      functionName: 'getEscrowBasic' as const,
      args: [id] as const,
    }))
    const results = appChain.contracts?.multicall3
      ? await publicClient.multicall({ contracts: calls, allowFailure: false })
      : await Promise.all(calls.map((c) => publicClient.readContract(c)))
    results.forEach(([buyer, seller, amount, status], j) => {
      out.push({ id: chunk[j], buyer, seller, amount, status: Number(status) })
    })
  }
  return out
}

/** Every escrow, as basic info. */
export async function readAllEscrows(publicClient: PublicClient): Promise<EscrowBasic[]> {
  return readEscrowBasics(publicClient, await allEscrowIds(publicClient))
}

/** Every escrow on the current deployment, as basic info. */
export async function readCurrentEscrows(publicClient: PublicClient): Promise<EscrowBasic[]> {
  return readEscrowBasics(publicClient, await currentEscrowIds(publicClient))
}
