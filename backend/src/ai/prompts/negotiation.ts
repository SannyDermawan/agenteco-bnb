import type { Prompt } from './execute.ts'

export interface NegotiationTurnInput {
  role: 'buyer' | 'seller'
  capability: string
  /** The seller's listing price. */
  listingPrice: number
  /** This side's own private limit: the seller's minimum, the buyer's maximum. Never shown to the other side. */
  privateLimit: number
  /** Price on the table from the other side. */
  offeredPrice: number
  /** Offers so far, oldest first. */
  history: { side: 'buyer' | 'seller'; action: string; price: number | null }[]
  /** 1-based round of this agent's next move, out of maxRounds. */
  round: number
  maxRounds: number
  /** Size of the job, never its content (spec §9). */
  brief?: { length: number } | null
  seller?: { stars: number | null; completedJobs: number } | null
  /** Listing prices of other sellers offering the same capability. */
  otherSellerPrices?: number[]
}

/**
 * One negotiation move (spec §9). The model sees its own limit so it can plan,
 * but is told never to reveal it; code clamps prices and filters leaks anyway.
 */
export function negotiationPrompt(t: NegotiationTurnInput): Prompt {
  const goal =
    t.role === 'seller'
      ? `You are the SELLER agent. Get the best price you can, but never below your private minimum of ${t.privateLimit}.`
      : `You are the BUYER agent. Pay as little as you can, but never above your private maximum of ${t.privateLimit}.`
  const history = t.history.map((m) => `${m.side} ${m.action}${m.price === null ? '' : ` ${m.price}`}`).join(' → ') || '(none)'
  const market = t.otherSellerPrices?.length ? t.otherSellerPrices.join(', ') : 'none listed'
  const seller = t.seller
    ? `${t.seller.stars === null ? 'no ratings yet' : `${t.seller.stars.toFixed(1)} stars`}, ${t.seller.completedJobs} completed jobs`
    : 'unknown'

  return {
    system:
      `You negotiate the price of an AI service in an agent marketplace. ${goal} ` +
      `This is round ${t.round} of at most ${t.maxRounds}; after the last round an offer you do not accept ends the deal. ` +
      'Make a reasonable move: accept a fair offer, or counter step by step toward a deal; reject only if no deal is possible. ' +
      'NEVER mention, hint at, or quote your private limit or any number derived from it in the reason, and never call a price your minimum, maximum, floor or limit. ' +
      'Prices have two decimals. In the reason, quote only the price you are sending or prices already on the table. ' +
      'Answer with a JSON object: {"action": "counter" | "accept" | "reject", "price": number (your counter price; for accept, the offered price; for reject, 0), ' +
      '"reason": string (English, 1-2 sentences, at most 280 characters, addressed to the other agent)}.',
    user:
      `Capability: ${t.capability}. Seller's listing price: ${t.listingPrice}.\n` +
      `Offer on the table from the other side: ${t.offeredPrice}.\n` +
      `History: ${history}\n` +
      `Job size: ${t.brief ? `${t.brief.length} characters of brief` : 'unknown'}. Seller track record: ${seller}.\n` +
      `Other sellers' listing prices for this capability: ${market}.`,
  }
}
