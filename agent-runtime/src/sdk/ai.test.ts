import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askJson, defendWithAi, openAiCompatible, runPlatformJob, scoreWithAi, type AiModel } from './ai.ts'
import { verification } from '../shared/ai/schemas.ts'
import type { PreparedJob } from '../capabilities/prepare.ts'

const STATS = { rows: 2, columns: ['visitors'], numeric: [{ column: 'visitors', count: 2, mean: 10, median: 10, min: 5, max: 15, stddev: 5 }], trends: [] }
const job = (): PreparedJob => ({ capability: 'data_analysis', input: { csv: 'visitors\n5\n15', question: 'Is it growing?' }, stats: STATS }) as PreparedJob

/** A scripted model: answers in order, remembers what it was asked. */
function scripted(...answers: (string | Error)[]) {
  const calls: { system: string; user: string }[] = []
  const ai: AiModel = async (prompt) => {
    calls.push(prompt)
    const next = answers.shift()
    if (next instanceof Error) throw next
    return next ?? '{}'
  }
  return { ai, calls }
}

test('askJson accepts a valid answer, tolerates a code fence, and appends the security rules', async () => {
  const { ai, calls } = scripted('```json\n{"score": 80, "verdict": "accept", "rationale": "Fine."}\n```')
  const out = await askJson(ai, { system: 'judge', user: 'the work' }, verification)
  assert.equal(out?.score, 80)
  assert.match(calls[0].system, /untrusted data/)
})

test('askJson retries once quoting the problem, then gives up with null', async () => {
  const retry = scripted('not json', '{"score": 50, "verdict": "accept", "rationale": "ok"}')
  assert.equal((await askJson(retry.ai, { system: 's', user: 'u' }, verification))?.score, 50)
  assert.match(retry.calls[1].user, /previous answer was rejected/)

  const never = scripted('nope', '{"score": "high"}')
  assert.equal(await askJson(never.ai, { system: 's', user: 'u' }, verification), null)
})

test('askJson returns null (not a throw) when the model itself fails', async () => {
  const down = scripted(new Error('HTTP 503'))
  const logs: string[] = []
  assert.equal(await askJson(down.ai, { system: 's', user: 'u' }, verification, (m) => logs.push(m)), null)
  assert.match(logs[0], /503/)
})

test('runPlatformJob puts the model\'s prose around the code-computed stats and checks the schema', async () => {
  const { ai, calls } = scripted('{"insights": ["Visitors average 10."], "summary": "Visitors went from 5 to 15."}')
  const result = await runPlatformJob(job(), ai, { criteria: 'Quote the mean.', instructions: 'Be brief.' })
  assert.deepEqual(result?.insights, ['Visitors average 10.'])
  assert.equal((result?.stats as { rows: number }).rows, 2) // from code, not the model
  assert.match(calls[0].user, /Quote the mean/)
  assert.match(calls[0].system, /Be brief/)

  const bad = scripted('{"insights": [], "summary": ""}', '{"insights": [], "summary": ""}')
  assert.equal(await runPlatformJob(job(), bad.ai), null)
})

test('a seller\'s defence and a buyer\'s verifier run on the model they are given', async () => {
  const ctx = { capability: 'sentiment_score', label: 'Sentiment score', rubric: 'Label matches the score.', brief: { text: 'great' }, criteria: '', result: { score: 1, label: 'positive' } }
  const d = scripted('{"response": "The label matches the score."}')
  assert.equal(await defendWithAi(d.ai, ctx, 'It is wrong.'), 'The label matches the score.')
  assert.match(d.calls[0].user, /Label matches the score/) // a community capability is judged by its own rubric

  const low = scripted('{"score": 41, "verdict": "dispute", "rationale": "Label wrong."}')
  assert.deepEqual(await scoreWithAi(low.ai, ctx), { score: 41, accept: false, rationale: 'Label wrong.' })
  const high = scripted('{"score": 60, "verdict": "dispute", "rationale": "Borderline."}')
  assert.equal((await scoreWithAi(high.ai, ctx))?.accept, true) // the code decides, at 60
})

test('openAiCompatible posts a chat-completions request and returns the message text', async () => {
  const real = globalThis.fetch
  let seen: { url: string; headers: Record<string, string>; body: { model: string; messages: { role: string }[] } } | null = null
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }), { status: 200 })
  }) as never
  try {
    const ai = openAiCompatible({ baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'm1' })
    assert.equal(await ai({ system: 's', user: 'u' }), '{"ok": true}')
    assert.equal(seen!.url, 'https://api.example.com/v1/chat/completions')
    assert.equal(seen!.headers.Authorization, 'Bearer sk-test')
    assert.deepEqual(seen!.body.messages.map((m) => m.role), ['system', 'user'])

    globalThis.fetch = (async () => new Response('busy', { status: 503 })) as never
    await assert.rejects(ai({ system: 's', user: 'u' }), /503/)
  } finally {
    globalThis.fetch = real
  }
})
