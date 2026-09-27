import type { Address, PublicClient } from 'viem'
import { AGENT_ECO_ABI } from '../shared/abi.generated.ts'
import { AGENT_ECO_ADDRESS, appChain } from '../network.ts'

/**
 * Escrow discovery from contract state, not event logs. Public BSC Testnet
 * RPCs either refuse eth_getLogs (the official data-seed nodes) or prune log
 * history after ~80,000 blocks (~18 hours, PublicNode) — so a log scan from the
 * deploy block breaks a day after deployment. AgentEco.sol numbers escrows
 * 1..nextEscrowId-1 and exposes each one through getEscrowBasic, which works
 * against any RPC, forever.
 */

export interface EscrowBasic {
  id: bigint
  buyer: Address
  seller: Address
  amount: bigint
  status: number
}

/** Every escrow id that exists: 1..nextEscrowId-1. */
export async function allEscrowIds(publicClient: PublicClient): Promise<bigint[]> {
  const next = await publicClient.readContract({
    address: AGENT_ECO_ADDRESS,
    abi: AGENT_ECO_ABI,
    functionName: 'nextEscrowId',
  })
  const ids: bigint[] = []
  for (let id = BigInt(1); id < next; id++) ids.push(id)
  return ids
}

const BATCH = 200

/** Reads getEscrowBasic for many ids — batched through Multicall3 when the chain has it. */
export async function readEscrowBasics(publicClient: PublicClient, ids: bigint[]): Promise<EscrowBasic[]> {
  const out: EscrowBasic[] = []
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const calls = chunk.map((id) => ({
      address: AGENT_ECO_ADDRESS,
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
