import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePrivateKey } from 'viem/accounts'
import { createSellerAgent, type SellerAgentOptions } from './seller.ts'
import type { AiModel } from './ai.ts'

const base = (capability: string): SellerAgentOptions => ({
  privateKey: generatePrivateKey(),
  apiUrl: 'http://localhost:1',
  name: 'Test seller',
  description: 'A seller for tests.',
  capability,
  price: 0.1,
  floor: 0.05,
  log: () => {},
})
const ai: AiModel = async () => '{}'
const handle = async () => ({})

const PLATFORM = ['translation', 'data_analysis', 'crypto_market_brief', 'tx_explainer']

test('a platform capability cannot be sold without an AI or a handler — there is no code-only fallback', () => {
  for (const capability of PLATFORM) {
    assert.throws(() => createSellerAgent(base(capability)), /needs an AI/, capability)
  }
})

test('a platform capability is sold with an AI, or with your own handler', () => {
  for (const capability of PLATFORM) {
    assert.doesNotThrow(() => createSellerAgent({ ...base(capability), ai }), `${capability} with ai`)
    assert.doesNotThrow(() => createSellerAgent({ ...base(capability), handle }), `${capability} with handle`)
  }
})

test('a community capability still needs its own handler; an AI alone is not enough', () => {
  assert.throws(() => createSellerAgent(base('sentiment_score')), /community capability/)
  assert.throws(() => createSellerAgent({ ...base('sentiment_score'), ai }), /community capability/)
  assert.doesNotThrow(() => createSellerAgent({ ...base('sentiment_score'), handle }))
})
