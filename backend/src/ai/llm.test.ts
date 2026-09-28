import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { callLLM, setLLMRecorder, type LLMEvent } from './llm.ts'
import { ProviderHttpError, type LLMProvider } from './providers/types.ts'

const schema = z.object({ answer: z.number() })
const req = { task: 'execute' as const, system: 'sys', user: 'user', schema }

/** A provider that plays back scripted replies (strings) or throws (errors). */
function fake(name: string, script: (string | Error)[], available = true) {
  const calls: string[] = []
  const provider: LLMProvider = {
    name,
    available: () => available,
    modelFor: () => `${name}-model`,
    async complete({ user }) {
      calls.push(user)
      const next = script.shift()
      if (next === undefined) throw new Error('script exhausted')
      if (next instanceof Error) throw next
      return next
    },
  }
  return { provider, calls }
}

const noSleep = { sleep: async () => {}, maxWaitSeconds: 10, timeoutMs: 1000, takeSlot: () => true }

test('returns the first provider that answers valid JSON, with provider and model', async () => {
  const groq = fake('groq', ['{"answer": 42}'])
  const gemini = fake('gemini', ['{"answer": 1}'])
  const out = await callLLM(req, { ...noSleep, providers: [groq.provider, gemini.provider] })
  assert.deepEqual(out, { data: { answer: 42 }, provider: 'groq', model: 'groq-model' })
  assert.equal(gemini.calls.length, 0)
})

test('skips providers without an API key', async () => {
  const groq = fake('groq', ['{"answer": 1}'], false)
  const gemini = fake('gemini', ['{"answer": 2}'])
  const out = await callLLM(req, { ...noSleep, providers: [groq.provider, gemini.provider] })
  assert.equal(out?.provider, 'gemini')
  assert.equal(groq.calls.length, 0)
})

test('an invalid answer gets one retry quoting the error, then the next provider', async () => {
  const groq = fake('groq', ['{"answer": "nope"}', 'not json at all'])
  const gemini = fake('gemini', ['{"answer": 7}'])
  const out = await callLLM(req, { ...noSleep, providers: [groq.provider, gemini.provider] })
  assert.equal(groq.calls.length, 2)
  assert.match(groq.calls[1], /previous answer was rejected: answer:/)
  assert.deepEqual(out?.data, { answer: 7 })
  assert.equal(out?.provider, 'gemini')
})

test('a retry that succeeds stays on the same provider', async () => {
  const groq = fake('groq', ['{"wrong": true}', '{"answer": 3}'])
  const out = await callLLM(req, { ...noSleep, providers: [groq.provider] })
  assert.deepEqual(out?.data, { answer: 3 })
})

test('JSON inside a code fence is accepted', async () => {
  const groq = fake('groq', ['```json\n{"answer": 5}\n```'])
  const out = await callLLM(req, { ...noSleep, providers: [groq.provider] })
  assert.deepEqual(out?.data, { answer: 5 })
})

test('429 with a short retry-after waits, then retries the same provider', async () => {
  const slept: number[] = []
  const groq = fake('groq', [new ProviderHttpError(429, 'slow down', 3), '{"answer": 9}'])
  const gemini = fake('gemini', ['{"answer": 1}'])
  const out = await callLLM(req, { ...noSleep, sleep: async (ms) => void slept.push(ms), providers: [groq.provider, gemini.provider] })
  assert.deepEqual(slept, [3000])
  assert.equal(out?.provider, 'groq')
  assert.equal(gemini.calls.length, 0)
})

test('429 with a long retry-after moves straight to the next provider', async () => {
  const slept: number[] = []
  const groq = fake('groq', [new ProviderHttpError(429, 'come back later', 60)])
  const gemini = fake('gemini', ['{"answer": 4}'])
  const out = await callLLM(req, { ...noSleep, sleep: async (ms) => void slept.push(ms), providers: [groq.provider, gemini.provider] })
  assert.deepEqual(slept, [])
  assert.equal(out?.provider, 'gemini')
})

test('a second 429 after waiting once moves on instead of waiting again', async () => {
  const slept: number[] = []
  const groq = fake('groq', [new ProviderHttpError(429, 'x', 2), new ProviderHttpError(429, 'x', 2)])
  const gemini = fake('gemini', ['{"answer": 6}'])
  const out = await callLLM(req, { ...noSleep, sleep: async (ms) => void slept.push(ms), providers: [groq.provider, gemini.provider] })
  assert.deepEqual(slept, [2000])
  assert.equal(out?.provider, 'gemini')
})

test('server errors and timeouts fall through to the next provider', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const groq = fake('groq', [new ProviderHttpError(503, 'down')])
  const gemini = fake('gemini', [timeout])
  const out = await callLLM(req, { ...noSleep, providers: [groq.provider, gemini.provider] })
  assert.equal(out, null)
})

test('returns null when no provider is configured', async () => {
  const out = await callLLM(req, { ...noSleep, providers: [fake('groq', [], false).provider, fake('gemini', [], false).provider] })
  assert.equal(out, null)
})

test('an agent over its hourly budget gets null without calling any provider', async () => {
  const groq = fake('groq', ['{"answer": 1}'])
  const out = await callLLM({ ...req, agentId: 'a1' }, { ...noSleep, takeSlot: () => false, providers: [groq.provider] })
  assert.equal(out, null)
  assert.equal(groq.calls.length, 0)
})

test('the system prompt always carries the <DATA> security rules', async () => {
  let seen = ''
  const spy: LLMProvider = {
    name: 'spy',
    available: () => true,
    modelFor: () => 'm',
    async complete({ system }) {
      seen = system
      return '{"answer": 1}'
    },
  }
  await callLLM(req, { ...noSleep, providers: [spy] })
  assert.match(seen, /^sys/)
  assert.match(seen, /untrusted data/)
})

test('records every attempt: a 429 on groq, then ok on gemini; and a final fallback', async () => {
  const events: LLMEvent[] = []
  setLLMRecorder((e) => events.push(e))
  try {
    const groq = fake('groq', [new ProviderHttpError(429, 'rate limited', 60)])
    const gemini = fake('gemini', ['{"answer": 7}'])
    await callLLM(req, { ...noSleep, providers: [groq.provider, gemini.provider] })
    assert.deepEqual(
      events.map((e) => [e.provider, e.outcome]),
      [
        ['groq', 'rate_limited'],
        ['gemini', 'ok'],
      ]
    )

    events.length = 0
    const down = fake('groq', [new Error('boom')])
    assert.equal(await callLLM(req, { ...noSleep, providers: [down.provider] }), null)
    assert.deepEqual(
      events.map((e) => [e.provider, e.outcome]),
      [
        ['groq', 'error'],
        ['none', 'fallback'],
      ]
    )
  } finally {
    setLLMRecorder(null)
  }
})
