import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DemoAgentRuntime } from './runtime.ts'

const sellerConfig = {
  name: 'Data Analyst',
  role: 'seller' as const,
  capabilities: ['data_analysis'],
  description: 'Analyses CSV data.',
  basePrice: 0.2,
  minimumPrice: 0.15,
}

const buyerConfig = {
  name: 'Agent D',
  role: 'buyer' as const,
  capabilities: ['data_analysis'],
  description: 'Finds and hires agents on your behalf.',
  basePrice: 0.15,
  maxBudget: 1,
}

test('matchesCapability is true only for capabilities the agent actually has', () => {
  const seller = new DemoAgentRuntime(sellerConfig)
  assert.equal(seller.matchesCapability('data_analysis'), true)
  assert.equal(seller.matchesCapability('image_generation'), false)
})

test('seller policy accepts anything at or above its minimumPrice', () => {
  const seller = new DemoAgentRuntime(sellerConfig)
  assert.equal(seller.checkPolicy(0.2), true)
  assert.equal(seller.checkPolicy(0.18), true)
  assert.equal(seller.checkPolicy(0.15), true)
  assert.equal(seller.checkPolicy(0.1), false)
})

test('buyer policy accepts anything at or below its maxBudget', () => {
  const buyer = new DemoAgentRuntime(buyerConfig)
  assert.equal(buyer.checkPolicy(0.15), true)
  assert.equal(buyer.checkPolicy(1), true)
  assert.equal(buyer.checkPolicy(1.01), false)
})

test('a role with no explicit floor/ceiling falls back to its basePrice', () => {
  const seller = new DemoAgentRuntime({ ...sellerConfig, minimumPrice: undefined })
  assert.equal(seller.checkPolicy(0.2), true)
  assert.equal(seller.checkPolicy(0.19), false)
})

test('rejects a config where minimumPrice is above basePrice', () => {
  assert.throws(() => new DemoAgentRuntime({ ...sellerConfig, minimumPrice: 0.25 }))
})

test('rejects a config where maxBudget is below basePrice', () => {
  assert.throws(() => new DemoAgentRuntime({ ...buyerConfig, maxBudget: 0.1 }))
})

test('reproduces the §11 example: seller counters once, then buyer accepts', () => {
  const seller = new DemoAgentRuntime(sellerConfig)
  const buyer = new DemoAgentRuntime(buyerConfig)

  // Buyer opens with 0.15 (myPriorOfferCount is irrelevant for the opener).
  // Seller evaluates it having made 0 offers so far -> counters.
  const sellerDecision = seller.decideOnOffer(0.15, 0)
  assert.deepEqual(sellerDecision, { action: 'counter', price: 0.18 })

  // Buyer evaluates the counter having already made 1 offer (its opener) -> accepts.
  const buyerDecision = buyer.decideOnOffer(0.18, 1)
  assert.deepEqual(buyerDecision, { action: 'accept' })
})

test('seller counters an offer below its minimumPrice instead of rejecting it outright', () => {
  const seller = new DemoAgentRuntime(sellerConfig)
  assert.deepEqual(seller.decideOnOffer(0.1, 0), { action: 'counter', price: 0.18 })
})

test('seller rejects only once every concession step is used up', () => {
  const seller = new DemoAgentRuntime(sellerConfig)
  assert.deepEqual(seller.decideOnOffer(0.1, 3), { action: 'reject' })
  assert.deepEqual(seller.decideOnOffer(0.16, 3), { action: 'accept' })
})

/** Plays a full buyer-opens negotiation between two runtimes; returns the outcome. */
function playNegotiation(buyer: DemoAgentRuntime, seller: DemoAgentRuntime) {
  let price = buyer.config.basePrice
  const offers = { buyer: 1, seller: 0 }
  let turn: 'buyer' | 'seller' = 'seller'
  for (let i = 0; i < 20; i++) {
    const agent = turn === 'seller' ? seller : buyer
    const decision = agent.decideOnOffer(price, offers[turn])
    if (decision.action !== 'counter') return { action: decision.action, price }
    price = decision.price
    offers[turn]++
    turn = turn === 'seller' ? 'buyer' : 'seller'
  }
  throw new Error('negotiation never terminated')
}

test('both sides keep conceding until they meet (seller 0.30/floor 0.24, buyer 0.21/max 0.30)', () => {
  const seller = new DemoAgentRuntime({ ...sellerConfig, basePrice: 0.3, minimumPrice: 0.24 })
  const buyer = new DemoAgentRuntime({ ...buyerConfig, basePrice: 0.21, maxBudget: 0.3 })
  // buyer 0.21 -> seller 0.28 -> buyer 0.24 -> seller 0.26 -> buyer accepts
  assert.deepEqual(playNegotiation(buyer, seller), { action: 'accept', price: 0.26 })
})

test('negotiation ends in a reject when the ranges never overlap', () => {
  const seller = new DemoAgentRuntime({ ...sellerConfig, basePrice: 0.3, minimumPrice: 0.24 })
  const buyer = new DemoAgentRuntime({ ...buyerConfig, basePrice: 0.15, maxBudget: 0.22 })
  assert.equal(playNegotiation(buyer, seller).action, 'reject')
})

test('accepts immediately when the offer already meets the ideal target', () => {
  const seller = new DemoAgentRuntime(sellerConfig)
  assert.deepEqual(seller.decideOnOffer(0.25, 0), { action: 'accept' })

  const buyer = new DemoAgentRuntime(buyerConfig)
  assert.deepEqual(buyer.decideOnOffer(0.1, 0), { action: 'accept' })
})
