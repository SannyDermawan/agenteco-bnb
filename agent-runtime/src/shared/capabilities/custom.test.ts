import { test } from 'node:test'
import assert from 'node:assert/strict'
import { platformCapabilities, rankScore, registerCapabilitySchema, validateWithSchema } from './custom.ts'

const sentiment = {
  id: 'sentiment',
  name: 'Sentiment score',
  description: 'Scores how positive or negative a text is.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 2000 } }, required: ['text'], additionalProperties: false },
  outputSchema: {
    type: 'object',
    properties: { score: { type: 'number', minimum: -1, maximum: 1 }, label: { enum: ['negative', 'neutral', 'positive'] } },
    required: ['score', 'label'],
  },
  rubric: 'The label agrees with the score and with the tone of the text.',
}

test('a well-formed community capability registers', () => {
  const parsed = registerCapabilitySchema.safeParse(sentiment)
  assert.ok(parsed.success)
  assert.equal(parsed.data.category, 'Automation')
})

test('platform ids, bad ids, non-object roots and broken schemas are refused', () => {
  const issues = (input: unknown) => {
    const r = registerCapabilitySchema.safeParse(input)
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
  }
  assert.deepEqual(issues({ ...sentiment, id: 'translation' }), ['id'])
  assert.deepEqual(issues({ ...sentiment, id: 'Bad Id' }), ['id'])
  assert.deepEqual(issues({ ...sentiment, inputSchema: { type: 'string' } }), ['inputSchema'])
  assert.deepEqual(issues({ ...sentiment, outputSchema: { type: 'object', properties: { a: { type: 'banana' } } } }), ['outputSchema'])
  assert.deepEqual(issues({ ...sentiment, inputSchema: { type: 'object', $ref: 'https://evil.example/schema.json' } }), ['inputSchema'])
  const huge = { type: 'object', description: 'x'.repeat(9000) }
  assert.deepEqual(issues({ ...sentiment, inputSchema: huge }), ['inputSchema'])
})

test('briefs and results are checked against the published schemas', () => {
  assert.ok(validateWithSchema(sentiment.inputSchema, { text: 'great product' }).ok)
  const missing = validateWithSchema(sentiment.inputSchema, {})
  assert.equal(missing.ok, false)
  const extra = validateWithSchema(sentiment.inputSchema, { text: 'hi', other: 1 })
  assert.equal(extra.ok, false)
  assert.ok(validateWithSchema(sentiment.outputSchema, { score: 0.8, label: 'positive' }).ok)
  const outOfRange = validateWithSchema(sentiment.outputSchema, { score: 3, label: 'positive' })
  assert.equal(outOfRange.ok, false)
  if (!outOfRange.ok) assert.match(outOfRange.error, /score/)
})

test('platform capabilities are listed with schemas their own briefs pass', () => {
  const platform = platformCapabilities()
  assert.deepEqual(
    platform.map((c) => c.id),
    ['translation', 'data_analysis', 'crypto_market_brief', 'tx_explainer']
  )
  const dataAnalysis = platform.find((c) => c.id === 'data_analysis')!
  assert.equal(dataAnalysis.source, 'platform')
  assert.ok(validateWithSchema(dataAnalysis.inputSchema, { csv: 'a,b\n1,2', question: 'Is b bigger?' }).ok)
})

test('examples must fit the schemas they ship with', () => {
  const issues = (examples: unknown) => {
    const r = registerCapabilitySchema.safeParse({ ...sentiment, examples })
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
  }
  const good = { title: 'A happy review', input: { text: 'Great product' }, output: { score: 0.9, label: 'positive', reason: 'great' } }
  assert.deepEqual(issues([good]), [])
  assert.equal(registerCapabilitySchema.parse(sentiment).examples.length, 0) // optional
  assert.deepEqual(issues([{ ...good, input: { text: 5 } }]), ['examples.0.input'])
  assert.deepEqual(issues([{ ...good, output: { score: 9, label: 'positive', reason: 'x' } }]), ['examples.0.output'])
  assert.deepEqual(issues(Array(6).fill(good)), ['examples'])
})

test('ranking: rated well, rarely disputed, used and available beats the rest', () => {
  const stat = (o: Partial<Parameters<typeof rankScore>[0]>) => ({ sellers: 1, onlineSellers: 1, hires: 0, delivered: 0, disputes: 0, ratings: 0, avgRating: null, disputeRatePct: null, ...o })
  const score = (o: Partial<Parameters<typeof rankScore>[0]>, ratingSum = 0) => rankScore(stat(o), ratingSum)

  const proven = score({ hires: 20, delivered: 20, ratings: 20 }, 20 * 92)
  const brandNew = score({})
  const lucky = score({ hires: 1, delivered: 1, ratings: 1 }, 100) // one 100 does not top a proven 92
  const disputed = score({ hires: 20, delivered: 20, disputes: 10, ratings: 20 }, 20 * 92)
  const nobodySelling = score({ hires: 20, delivered: 20, ratings: 20, onlineSellers: 0 }, 20 * 92)
  assert.ok(proven > lucky, 'a proven 92 beats one lucky 100')
  assert.ok(lucky > brandNew, 'any good evidence beats none')
  assert.ok(proven > disputed, 'disputes cost points')
  assert.ok(proven > nobodySelling + 20, 'a capability nobody sells right now sinks')
  assert.ok(score({ hires: 3, ratings: 3, delivered: 3 }, 3 * 40) < brandNew, 'poorly rated is below untested')
})
