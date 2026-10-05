import type { Address, Hex, PublicClient } from 'viem'
import { AGENT_ECO_ABI, ARBITER_COUNCIL_ABI } from '../shared/abi.generated.ts'
import { AGENT_ECO_ADDRESS, agentEcoFor } from '../network.ts'
import type { OnchainClients } from './clients.ts'

/**
 * Who may rule disputes. AgentEco's arbiter is either a wallet, or (from v2)
 * an ArbiterCouncil contract — a small multisig whose members are the AI
 * arbiter's key and human operators. With a council, a member rules by
 * voting; the vote that reaches its ruling threshold executes the ruling.
 */

export interface ArbiterSetup {
  /** AgentEco.arbiter() */
  arbiter: Address
  /** Present when the arbiter is an ArbiterCouncil. */
  council: { address: Address; members: Address[]; rulingThreshold: number; adminThreshold: number } | null
}

export async function readArbiterSetup(publicClient: PublicClient, agentEco: Address = AGENT_ECO_ADDRESS): Promise<ArbiterSetup> {
  const arbiter = await publicClient.readContract({ address: agentEco, abi: AGENT_ECO_ABI, functionName: 'arbiter' })
  const code = await publicClient.getCode({ address: arbiter })
  if (!code || code === '0x') return { arbiter, council: null }
  const [members, rulingThreshold, adminThreshold, councilEco] = await Promise.all([
    publicClient.readContract({ address: arbiter, abi: ARBITER_COUNCIL_ABI, functionName: 'getMembers' }),
    publicClient.readContract({ address: arbiter, abi: ARBITER_COUNCIL_ABI, functionName: 'rulingThreshold' }),
    publicClient.readContract({ address: arbiter, abi: ARBITER_COUNCIL_ABI, functionName: 'adminThreshold' }),
    publicClient.readContract({ address: arbiter, abi: ARBITER_COUNCIL_ABI, functionName: 'agentEco' }),
  ])
  if (councilEco.toLowerCase() !== agentEco.toLowerCase()) {
    throw new Error(`The arbiter ${arbiter} is a council for another contract (${councilEco}).`)
  }
  return { arbiter, council: { address: arbiter, members: [...members], rulingThreshold: Number(rulingThreshold), adminThreshold: Number(adminThreshold) } }
}

/** Whether `address` can rule: it is the arbiter wallet, or a member of the arbiter council. */
export function canRule(setup: ArbiterSetup, address: string): boolean {
  const a = address.toLowerCase()
  if (setup.council) return setup.council.members.some((m) => m.toLowerCase() === a)
  return setup.arbiter.toLowerCase() === a
}

export type RulingOutcome =
  /** The ruling executed on AgentEco in this transaction. */
  | { kind: 'executed'; hash: Hex }
  /** A council vote was recorded; more members must vote the same ruling. */
  | { kind: 'voted'; hash: Hex; votes: number; needed: number }
  /** This member already voted for exactly this ruling; waiting for the others. */
  | { kind: 'already-voted'; votes: number; needed: number }

/**
 * Rule a dispute as the arbiter: directly when the arbiter is this wallet,
 * or by a council vote when it is an ArbiterCouncil this wallet belongs to.
 */
export async function ruleDispute(
  clients: OnchainClients,
  escrowId: bigint,
  toSeller: boolean,
  rationaleHash: Hex
): Promise<RulingOutcome> {
  const { account, publicClient, walletClient } = clients
  const eco = agentEcoFor(escrowId)
  const setup = await readArbiterSetup(publicClient, eco)
  if (!canRule(setup, account.address)) {
    throw new Error(`${account.address} is neither the arbiter nor a member of its council.`)
  }

  if (!setup.council) {
    const hash = await walletClient.writeContract({
      address: eco,
      abi: AGENT_ECO_ABI,
      functionName: toSeller ? 'resolveDisputeForSeller' : 'resolveDisputeForBuyer',
      args: [escrowId, rationaleHash],
    })
    await waitOk(clients, hash, 'resolveDispute')
    return { kind: 'executed', hash }
  }

  const council = setup.council.address
  const needed = setup.council.rulingThreshold
  const id = await publicClient.readContract({
    address: council,
    abi: ARBITER_COUNCIL_ABI,
    functionName: 'rulingId',
    args: [escrowId, toSeller, rationaleHash],
  })
  const [voted, [votesBefore]] = await Promise.all([
    publicClient.readContract({ address: council, abi: ARBITER_COUNCIL_ABI, functionName: 'hasVoted', args: [id, account.address] }),
    publicClient.readContract({ address: council, abi: ARBITER_COUNCIL_ABI, functionName: 'proposals', args: [id] }),
  ])
  if (voted) return { kind: 'already-voted', votes: Number(votesBefore), needed }

  const hash = await walletClient.writeContract({
    address: council,
    abi: ARBITER_COUNCIL_ABI,
    functionName: 'voteRuling',
    args: [escrowId, toSeller, rationaleHash],
    chain: walletClient.chain,
    account,
  })
  await waitOk(clients, hash, 'voteRuling')
  const [votes, executed] = await publicClient.readContract({ address: council, abi: ARBITER_COUNCIL_ABI, functionName: 'proposals', args: [id] })
  return executed ? { kind: 'executed', hash } : { kind: 'voted', hash, votes: Number(votes), needed }
}

async function waitOk(clients: OnchainClients, hash: Hex, what: string): Promise<void> {
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${what} reverted (tx ${hash})`)
}
