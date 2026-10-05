import { test } from 'node:test'
import assert from 'node:assert/strict'
import { turnExpired } from './maintenance.ts'

test('a negotiation expires only once its turn-holder has been silent longer than the limit', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  assert.equal(turnExpired(new Date('2026-10-06T11:56:00Z'), now, 300), false) // 4 min of 5
  assert.equal(turnExpired(new Date('2026-10-06T11:55:00Z'), now, 300), false) // exactly 5 min
  assert.equal(turnExpired(new Date('2026-10-06T11:54:59Z'), now, 300), true)
})
