import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type PublicClient } from 'viem'
import { AI_UNAVAILABLE, NOT_FINANCIAL_ADVICE, executeCapability, type ExecutionContext } from './execute.ts'

const TOKEN = '0x00000000000000000000000000000000000000aa'
const AGENT_ECO = '0x00000000000000000000000000000000000000ee'
const FROM = '0x1111111111111111111111111111111111111111'
const TO = '0x2222222222222222222222222222222222222222'
const HASH = `0x${'ab'.repeat(32)}` as const

/** A public client that knows one ERC-20 transfer transaction. */
const fakeClient = {
  getTransaction: async () => ({ from: FROM, to: TOKEN, value: BigInt(0) }),
  getTransactionReceipt: async () => ({
    status: 'success',
    gasUsed: BigInt(51_000),
    blockNumber: BigInt(123),
    logs: [
      {
        address: TOKEN,
        topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: FROM, to: TO } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [BigInt('1500000000000000000')]),
      },
    ],
  }),
  readContract: async ({ functionName }: { functionName: string }) => (functionName === 'symbol' ? 'mUSDT' : 18),
} as unknown as PublicClient

const noAI: ExecutionContext['llm'] = async () => null
const ctx = (llm: ExecutionContext['llm']): ExecutionContext => ({ publicClient: fakeClient, agentEcoAddress: AGENT_ECO, llm })

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('an invalid brief is never delivered', async () => {
  const out = await executeCapability('translation', { text: '', targetLanguage: 'id' }, ctx(noAI))
  assert.equal(out.deliver, false)
  assert.match((out as { reason: string }).reason, /Invalid brief/)
})

test('translation: AI result delivered with the target language; without AI it is not delivered', async () => {
  const withAI = await executeCapability(
    'translation',
    { text: 'Hello world', targetLanguage: 'id' },
    ctx(async () => ({ data: { translatedText: 'Halo dunia' }, provider: 'groq', model: 'm' }) as never)
  )
  assert.deepEqual(withAI, { deliver: true, result: { translatedText: 'Halo dunia', targetLanguage: 'id' }, ai: { provider: 'groq', model: 'm' } })

  const without = await executeCapability('translation', { text: 'Hello world', targetLanguage: 'id' }, ctx(noAI))
  assert.equal(without.deliver, false)
  assert.match((without as { reason: string }).reason, new RegExp(AI_UNAVAILABLE))
})

test('data_analysis: code computes the stats, the model writes the prose; without AI nothing is delivered', async () => {
  const csv = 'month,sales\n2026-01-01,10\n2026-02-01,30'
  const withAI = await executeCapability(
    'data_analysis',
    { csv },
    ctx(async () => ({ data: { insights: ['Sales averaged 20.'], summary: 'Sales rose from 10 to 30.' }, provider: 'groq', model: 'm' }) as never)
  )
  assert.equal(withAI.deliver, true)
  const result = (withAI as { result: { stats: { numeric: { column: string; mean: number }[] }; insights: string[]; summary: string } }).result
  assert.deepEqual(result.stats.numeric.map((c) => [c.column, c.mean]), [['sales', 20]]) // from code, not the model
  assert.deepEqual(result.insights, ['Sales averaged 20.'])

  // Every provider failed: not even the code-computed statistics go out.
  const without = await executeCapability('data_analysis', { csv }, ctx(noAI))
  assert.equal(without.deliver, false)
  assert.match((without as { reason: string }).reason, new RegExp(AI_UNAVAILABLE))
})

test('data_analysis: a CSV over the row limit is an invalid brief', async () => {
  const csv = ['n', ...Array.from({ length: 201 }, (_, i) => String(i))].join('\n')
  const out = await executeCapability('data_analysis', { csv }, ctx(noAI))
  assert.equal(out.deliver, false)
  assert.match((out as { reason: string }).reason, /limit is 200/)
})

test('crypto_market_brief: live data and the disclaimer come from code; without AI nothing is delivered', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 85000, price_change_percentage_24h_in_currency: 1.2, price_change_percentage_7d_in_currency: -3.4, total_volume: 1, market_cap: 2 },
      ])
    )) as typeof fetch
  const withAI = await executeCapability(
    'crypto_market_brief',
    { coins: ['bitcoin'], horizon: '24h' },
    ctx(async () => ({ data: { brief: 'Bitcoin trades near $85,000, up 1.2% on the day.' }, provider: 'groq', model: 'm' }) as never)
  )
  assert.equal(withAI.deliver, true)
  const result = (withAI as { result: { data: { coins: { symbol: string; priceUsd: number }[] }; brief: string; disclaimer: string } }).result
  assert.deepEqual(result.data.coins.map((c) => [c.symbol, c.priceUsd]), [['BTC', 85000]])
  assert.equal(result.disclaimer, NOT_FINANCIAL_ADVICE)

  const without = await executeCapability('crypto_market_brief', { coins: ['bitcoin'], horizon: '24h' }, ctx(noAI))
  assert.equal(without.deliver, false)
  assert.match((without as { reason: string }).reason, new RegExp(AI_UNAVAILABLE))
})

test('crypto_market_brief: an unknown coin id is an invalid brief', async () => {
  globalThis.fetch = (async () => new Response('[]')) as typeof fetch
  const out = await executeCapability('crypto_market_brief', { coins: ['not-a-coin'], horizon: '7d' }, ctx(noAI))
  assert.equal(out.deliver, false)
  assert.match((out as { reason: string }).reason, /Unknown CoinGecko coin id/)
})

test('tx_explainer: facts decoded by code, explanation from the AI; without AI nothing is delivered', async () => {
  const withAI = await executeCapability(
    'tx_explainer',
    { txHash: HASH },
    ctx(async () => ({ data: { explanation: 'Someone sent 1.5 mUSDT.' }, provider: 'gemini', model: 'g' }) as never)
  )
  assert.equal(withAI.deliver, true)
  const result = (withAI as { result: { facts: { status: string; decodedEvents: { event: string; args: Record<string, string> }[] }; explanation: string } }).result
  assert.equal(result.facts.status, 'success')
  assert.equal(result.facts.decodedEvents[0].event, 'Transfer')
  assert.equal(result.facts.decodedEvents[0].args.amount, '1.5 mUSDT')
  assert.equal(result.explanation, 'Someone sent 1.5 mUSDT.')

  const without = await executeCapability('tx_explainer', { txHash: HASH }, ctx(noAI))
  assert.equal(without.deliver, false)
  assert.match((without as { reason: string }).reason, new RegExp(AI_UNAVAILABLE))
})

test('an AI answer that breaks the output schema is not delivered either', async () => {
  const tooLong = 'x'.repeat(2500) // explanation is capped at 2,000 characters
  const out = await executeCapability(
    'tx_explainer',
    { txHash: HASH },
    ctx(async () => ({ data: { explanation: tooLong }, provider: 'groq', model: 'm' }) as never)
  )
  assert.equal(out.deliver, false)
})
