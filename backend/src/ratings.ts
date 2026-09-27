import { getAbiItem, parseEventLogs, type Hex, type Log, type PublicClient } from 'viem'
import { AGENT_ECO_ABI } from '../../agent-runtime/src/shared/abi.generated.ts'
import { prisma } from './db.ts'
import { log } from './log.ts'
import { AGENT_ECO_ADDRESS, LOG_RANGE } from './network.ts'

/**
 * Ratings index (spec §10.3). The contract keeps only ratingSum/ratingCount
 * per seller; the per-escrow score lives in the SellerRated event. Each one
 * is stored with where it came from (a hosted agent's AI verification, or a
 * human) and whether buyer and seller belong to the same owner — those are
 * left out of the displayed average and out of seller selection, so nobody
 * can pump their own seller.
 */

interface SellerRatedArgs {
  escrowId: bigint
  seller: `0x${string}`
  buyer: `0x${string}`
  score: number
}

/** The owner behind an address: the agent it belongs to, or the address itself (a human wallet). */
async function ownerOf(address: string): Promise<{ owner: string; hostedAgent: boolean }> {
  const agent = await prisma.agent.findFirst({ where: { walletAddress: { equals: address, mode: 'insensitive' } } })
  if (!agent) return { owner: address.toLowerCase(), hostedAgent: false }
  return { owner: agent.ownerWallet.toLowerCase(), hostedAgent: agent.taskStatus !== null }
}

async function saveRating(args: SellerRatedArgs, txHash: string | null): Promise<void> {
  const [buyer, seller] = await Promise.all([ownerOf(args.buyer), ownerOf(args.seller)])
  const data = {
    seller: args.seller.toLowerCase(),
    buyer: args.buyer.toLowerCase(),
    score: Number(args.score),
    source: buyer.hostedAgent ? 'ai' : 'user',
    sameOwner: buyer.owner === seller.owner,
    txHash,
  }
  await prisma.rating.upsert({
    where: { escrowId: args.escrowId.toString() },
    create: { escrowId: args.escrowId.toString(), ...data },
    update: { ...data, txHash: txHash ?? undefined },
  })
}

function sellerRatedIn(logs: Log[]): { args: SellerRatedArgs; txHash: string | null }[] {
  return parseEventLogs({ abi: AGENT_ECO_ABI, logs, eventName: 'SellerRated' })
    .filter((l) => l.address.toLowerCase() === AGENT_ECO_ADDRESS.toLowerCase())
    .map((l) => ({ args: l.args as SellerRatedArgs, txHash: l.transactionHash }))
}

/** Records the SellerRated event(s) in one transaction. Returns how many were stored. */
export async function recordRatingsFromTx(publicClient: PublicClient, txHash: Hex): Promise<number> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
  const events = sellerRatedIn(receipt.logs as Log[])
  for (const e of events) await saveRating(e.args, e.txHash)
  return events.length
}

const SELLER_RATED = getAbiItem({ abi: AGENT_ECO_ABI, name: 'SellerRated' })

// Where the background scan continues from (in memory: a restart rescans a recent window).
let scannedTo: bigint | null = null
// Public RPCs prune logs after ~80k blocks; ratings older than that are only on-chain.
const INITIAL_LOOKBACK = BigInt(20_000)

/**
 * Catches ratings made outside our own flows (self-hosted buyers, direct
 * contract calls): scans recent blocks for SellerRated, in LOG_RANGE chunks.
 */
export async function indexRecentRatings(publicClient: PublicClient): Promise<void> {
  const head = await publicClient.getBlockNumber()
  let from = scannedTo === null ? (head > INITIAL_LOOKBACK ? head - INITIAL_LOOKBACK : BigInt(0)) : scannedTo + BigInt(1)
  const span = BigInt(LOG_RANGE)
  let stored = 0
  while (from <= head) {
    const to = from + span - BigInt(1) < head ? from + span - BigInt(1) : head
    const logs = await publicClient.getLogs({ address: AGENT_ECO_ADDRESS, event: SELLER_RATED, fromBlock: from, toBlock: to })
    for (const l of logs) {
      await saveRating(l.args as SellerRatedArgs, l.transactionHash)
      stored++
    }
    scannedTo = to
    from = to + BigInt(1)
  }
  if (stored) log(`[ratings] indexed ${stored} SellerRated event(s)`)
}

export interface RatingSummary {
  seller: string
  /** Ratings counted in the displayed average (same-owner ratings excluded). */
  count: number
  /** Average score 0–100 of those, or null with none. */
  avgScore: number | null
  /** Same-owner ratings left out. */
  excluded: number
}

/** Displayed rating per seller address (lowercased), same-owner ratings excluded. */
export async function ratingSummaries(sellers: string[]): Promise<RatingSummary[]> {
  const addrs = [...new Set(sellers.map((s) => s.toLowerCase()))]
  if (addrs.length === 0) return []
  const rows = await prisma.rating.findMany({ where: { seller: { in: addrs } }, select: { seller: true, score: true, sameOwner: true } })
  return addrs.map((seller) => {
    const mine = rows.filter((r) => r.seller === seller)
    const counted = mine.filter((r) => !r.sameOwner)
    return {
      seller,
      count: counted.length,
      avgScore: counted.length ? counted.reduce((sum, r) => sum + r.score, 0) / counted.length : null,
      excluded: mine.length - counted.length,
    }
  })
}
