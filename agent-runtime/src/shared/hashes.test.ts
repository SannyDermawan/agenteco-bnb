import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRationalePreimage,
  buildTaskPreimage,
  canonicalize,
  normalizePrice,
  rationaleHash,
  resultHash,
  taskHash,
  textHash,
} from './hashes.ts'

// Fixed vectors, cross-checked with Foundry's `cast keccak` (an independent
// keccak implementation). The frontend imports this same module, so backend
// and frontend produce identical hashes by construction.
const TASK = {
  capability: 'translation',
  brief: { tone: 'casual', text: 'Hello world', targetLanguage: 'id' }, // keys deliberately unsorted
  criteria: 'Keep it short',
  price: '0.250',
  buyer: '0xAbC0000000000000000000000000000000000001',
  seller: '0xDEF0000000000000000000000000000000000002',
  nonce: '11111111-2222-4333-8444-555555555555',
}

test('task preimage has a fixed key order, canonical brief, normalized price and lowercase addresses', () => {
  assert.equal(
    buildTaskPreimage(TASK),
    '{"v":1,"capability":"translation","brief":{"targetLanguage":"id","text":"Hello world","tone":"casual"},"criteria":"Keep it short","price":"0.25","buyer":"0xabc0000000000000000000000000000000000001","seller":"0xdef0000000000000000000000000000000000002","nonce":"11111111-2222-4333-8444-555555555555"}'
  )
})

test('taskHash vector', () => {
  assert.equal(taskHash(TASK), '0x1fdc9767110bfcdefba6d5ee31edfb9f5dc91be61b10336481c309a4a53fe27e')
})

test('taskHash does not depend on brief key order or price formatting', () => {
  const reordered = { ...TASK, brief: { targetLanguage: 'id', tone: 'casual', text: 'Hello world' }, price: 0.25 }
  assert.equal(taskHash(reordered), taskHash(TASK))
})

test('missing criteria hashes as an empty string', () => {
  assert.equal(taskHash({ ...TASK, criteria: undefined }), taskHash({ ...TASK, criteria: '' }))
  assert.notEqual(taskHash({ ...TASK, criteria: '' }), taskHash(TASK))
})

test('textHash vector (dispute reason / seller response)', () => {
  assert.equal(
    textHash('The translation skipped the second paragraph.'),
    '0x4dc6dc018fbc23e335936d325540c8ab3595ed2f640019abd1fd8830067e6eff'
  )
})

test('rationale preimage and hash vector', () => {
  const r = { verdict: 'buyer', confidence: 82, rationale: 'The second paragraph is missing.', decidedBy: 'ai-auto' } as const
  assert.equal(
    buildRationalePreimage(r),
    '{"v":1,"verdict":"buyer","confidence":82,"rationale":"The second paragraph is missing.","decidedBy":"ai-auto"}'
  )
  assert.equal(rationaleHash(r), '0x9f4024aa57aae3c7285026f3e2c4d23d29521b642008f8c2c6eadc993fc374df')
})

test('resultHash keeps the existing JSON.stringify convention', () => {
  assert.equal(
    resultHash({ translatedText: 'Halo dunia', targetLanguage: 'id' }),
    '0x445dc3874dc6f8384729100d32d143b5ec15276248225c8fd757d3c49000c78d'
  )
})

test('canonicalize sorts nested keys and drops undefined', () => {
  assert.deepEqual(JSON.stringify(canonicalize({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })), '{"a":{"d":[{"y":2,"z":1}]},"b":1}')
})

test('normalizePrice', () => {
  assert.equal(normalizePrice('0.250'), '0.25')
  assert.equal(normalizePrice('1.0'), '1')
  assert.equal(normalizePrice('001.5'), '1.5')
  assert.equal(normalizePrice(0.1), '0.1')
  assert.throws(() => normalizePrice('1e-3'))
  assert.throws(() => normalizePrice('-1'))
})
