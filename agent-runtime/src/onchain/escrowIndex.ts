import type { Address, PublicClient } from 'viem'
import { AGENT_ECO_ABI } from '../shared/abi.generated.ts'
import { AGENT_ECO_ADDRESS, FIRST_ESCROW_ID, LEGACY_AGENT_ECO_ADDRESS, agentEcoFor, appChain } from '../network.ts'

/**
 * Escrow discovery from contract state, not event logs. Public BSC Testnet
 * RPCs either refuse eth_getLogs (the official data-seed nodes) or prune log
 * history after ~80,000 blocks (~18 hours, PublicNode) — so a log scan from the
 * deploy block breaks a day after deployment. AgentEco.sol numbers escrows
 * firstEscrowId..nextEscrowId-1 and exposes each one through getEscrowBasic,
 * which works against any RPC, forever.
 *
 * With a legacy deployment (AgentEco v1, see ../network.ts), its escrows
 * 1..nextEscrowId-1 come first; ids never overlap, so callers treat both
 * contracts as one list and agentEcoFor(id) finds the right contract.
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

/** Every escrow id that exists: the legacy deployment's, then the current one's. */
export async function allEscrowIds(publicClient: PublicClient): Promise<bigint[]> {
  const [legacy, current] = await Promise.all([
    LEGACY_AGENT_ECO_ADDRESS ? idsOn(publicClient, LEGACY_AGENT_ECO_ADDRESS, BigInt(1), FIRST_ESCROW_ID) : Promise.resolve([]),
    idsOn(publicClient, AGENT_ECO_ADDRESS, FIRST_ESCROW_ID),
  ])
  return [...legacy, ...current]
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
