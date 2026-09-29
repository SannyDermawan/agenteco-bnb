import type { LocalAccount } from 'viem'
import type { DemoAgentRuntime } from '../../agent-runtime/src/runtime.ts'
import { discoverAgents } from '../../agent-runtime/src/registryClient.ts'
import { listNegotiationsForAgent, openNegotiation } from '../../agent-runtime/src/negotiationClient.ts'

/**
 * One-time "go shopping" pass at startup: discover a seller for each
 * capability this buyer needs and send an opening offer. Doesn't wait for a
 * reply — the persistent poll loop in index.ts picks up the response and
 * carries the negotiation to accept/reject.
 */
export async function discoverAndNegotiate(
  runtime: DemoAgentRuntime,
  apiUrl: string,
  account: LocalAccount,
  buyerAgentId: string
): Promise<void> {
  for (const capability of runtime.config.capabilities) {
    console.log(`\n[${runtime.config.name}] discovering sellers for capability "${capability}"…`)
    const sellers = await discoverAgents(apiUrl, { role: 'seller', capability, onlineOnly: true })

    if (sellers.length === 0) {
      console.log(`[${runtime.config.name}] no online sellers found for "${capability}".`)
      continue
    }

    const affordableSeller = sellers.find((s) => runtime.checkPolicy(Number(s.price)))
    for (const seller of sellers) {
      const price = Number(seller.price)
      console.log(
        `[${runtime.config.name}] found "${seller.name}" (${seller.id}) — ${price} USDT — ` +
          `${runtime.checkPolicy(price) ? 'within budget ✓' : 'over budget ✗'}`
      )
    }
    if (!affordableSeller) {
      console.log(`[${runtime.config.name}] no seller for "${capability}" fits the budget — skipping negotiation.`)
      continue
    }

    const existing = await listNegotiationsForAgent(apiUrl, account, buyerAgentId)
    const alreadyNegotiating = existing.some(
      (n) => n.sellerAgentId === affordableSeller.id && n.capability === capability && n.status !== 'rejected'
    )
    if (alreadyNegotiating) {
      console.log(
        `[${runtime.config.name}] already has an open/accepted negotiation with "${affordableSeller.name}" for "${capability}" — skipping.`
      )
      continue
    }

    console.log(
      `\n[${runtime.config.name}] opening negotiation with "${affordableSeller.name}" — offering ${runtime.config.basePrice} USDT`
    )
    const negotiation = await openNegotiation(apiUrl, account, {
      buyerAgentId,
      sellerAgentId: affordableSeller.id,
      capability,
      price: runtime.config.basePrice,
    })
    console.log(`[${runtime.config.name}] negotiation ${negotiation.id} opened — the poll loop will handle the rest.`)
  }
}
