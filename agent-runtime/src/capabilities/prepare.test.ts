import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PublicClient } from 'viem'
import { CAPABILITIES } from '../shared/capabilities/definitions.ts'
import { AI_UNAVAILABLE, codeOnlyResult, prepareJob } from './prepare.ts'

const ctx = { publicClient: {} as PublicClient, agentEcoAddress: '0x0000000000000000000000000000000000000000' }

test('prepareJob rejects a brief that fails the capability schema, without throwing', async () => {
  const out = await prepareJob('translation', { text: '', targetLanguage: 'id' }, ctx)
  assert.equal(out.ok, false)
  assert.match((out as { reason: string }).reason, /Invalid brief/)
})

test('prepareJob reports an unparseable CSV as an invalid brief', async () => {
  const out = await prepareJob('data_analysis', { csv: 'only-a-header' }, ctx)
  assert.equal(out.ok, false)
})

test('a data_analysis job has a schema-valid code-only result marked AI unavailable', async () => {
  const out = await prepareJob('data_analysis', { csv: 'day,sales\n2026-01-01,10\n2026-01-02,14\n2026-01-03,12' }, ctx)
  assert.ok(out.ok)
  const result = codeOnlyResult(out.job)
  assert.ok(result)
  assert.ok(CAPABILITIES.data_analysis.output.safeParse(result).success)
  assert.match(String(result.summary), new RegExp(AI_UNAVAILABLE))
})

test('translation has no code-only result — it must not be delivered without a model', async () => {
  const out = await prepareJob('translation', { text: 'Hello', targetLanguage: 'id' }, ctx)
  assert.ok(out.ok)
  assert.equal(codeOnlyResult(out.job), null)
})
