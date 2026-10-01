import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePrivateKey } from 'viem/accounts'
import { MAX_ATTEMPTS, createSellerAgent, retryDecision, type SellerAgentOptions } from './seller.ts'
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

test('a failing job pauses longer each time, then is dropped', () => {
  // 5 s, 10 s, 20 s, 40 s: about 75 s of retries — a briefly rate-limited model recovers, a dead one costs 5 calls.
  assert.deepEqual(
    [1, 2, 3, 4].map((n) => retryDecision(n, false)),
    [5_000, 10_000, 20_000, 40_000].map((waitMs) => ({ giveUp: false, waitMs }))
  )
  assert.deepEqual(retryDecision(MAX_ATTEMPTS, false), { giveUp: true })
})

test('once the on-chain deadline for the step has passed, the job is dropped at once', () => {
  assert.deepEqual(retryDecision(1, true), { giveUp: true })
})
