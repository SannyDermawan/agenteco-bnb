import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideKeeperAction, FLAG_FOR_STATUS, ORDER_STATUS } from './decide.ts'

const ALL_TRUE = { acceptTimedOut: true, executionTimedOut: true, reviewExpired: true, disputeTimedOut: true }

test('claims the accept timeout when FUNDED and the seller never started', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.FUNDED, { acceptTimedOut: true }), 'claimAcceptTimeout')
})

test('does nothing when FUNDED but still within the accept window', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.FUNDED, { acceptTimedOut: false }), null)
})

test('claims execution timeout when EXECUTING and the deadline has passed', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.EXECUTING, { executionTimedOut: true }), 'claimExecutionTimeout')
})

test('does nothing when EXECUTING but still within the execution window', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.EXECUTING, { executionTimedOut: false }), null)
})

test('finalizes when DELIVERED and the review window has expired', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.DELIVERED, { reviewExpired: true }), 'finalizeAfterReviewWindow')
})

test('does nothing when DELIVERED but still within the review window', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.DELIVERED, { reviewExpired: false }), null)
})

test('claims the dispute timeout when DISPUTED and the arbiter missed the deadline', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.DISPUTED, { disputeTimedOut: true }), 'claimDisputeTimeout')
})

test('does nothing when DISPUTED but the arbiter still has time', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.DISPUTED, { disputeTimedOut: false }), null)
})

test('a flag only counts for its own status', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.FUNDED, { executionTimedOut: true, reviewExpired: true }), null)
  assert.equal(decideKeeperAction(ORDER_STATUS.DISPUTED, { reviewExpired: true }), null)
})

test('never acts on CREATED or final statuses, even if every flag is true', () => {
  assert.equal(decideKeeperAction(ORDER_STATUS.CREATED, ALL_TRUE), null)
  assert.equal(decideKeeperAction(ORDER_STATUS.SETTLED, ALL_TRUE), null)
  assert.equal(decideKeeperAction(ORDER_STATUS.REFUNDED, ALL_TRUE), null)
})

test('every non-final status except CREATED has a flag to watch', () => {
  for (const s of [ORDER_STATUS.FUNDED, ORDER_STATUS.EXECUTING, ORDER_STATUS.DELIVERED, ORDER_STATUS.DISPUTED]) {
    assert.ok(FLAG_FOR_STATUS[s], `status ${s} has no timeout flag`)
  }
  assert.equal(FLAG_FOR_STATUS[ORDER_STATUS.CREATED], undefined)
})
