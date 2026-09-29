import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { READ_SESSION_STATEMENT } from '../../agent-runtime/src/shared/session.ts'
import { verifyReadSession } from './session.ts'

const account = privateKeyToAccount(generatePrivateKey())
const other = privateKeyToAccount(generatePrivateKey())
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)
const HOUR = 60 * 60 * 1000
const rules = { domains: ['agenteco-bnb.vercel.app'], chainId: 97, now: NOW }

async function session(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}, signer = account) {
  const message = createSiweMessage({
    domain: 'agenteco-bnb.vercel.app',
    address: account.address,
    statement: READ_SESSION_STATEMENT,
    uri: 'https://agenteco-bnb.vercel.app',
    version: '1',
    chainId: 97,
    nonce: 'abcdefgh12345678',
    issuedAt: new Date(NOW - HOUR),
    expirationTime: new Date(NOW + HOUR),
    ...overrides,
  })
  const signature = await signer.signMessage({ message })
  return Buffer.from(JSON.stringify({ message, signature })).toString('base64')
}

test('a valid session proves its wallet', async () => {
  const result = await verifyReadSession(await session(), rules)
  assert.deepEqual(result, { ok: true, wallet: account.address })
})

test('a session signed by another key is rejected', async () => {
  const result = await verifyReadSession(await session({}, other), rules)
  assert.equal(result.ok, false)
})

test('a session for another website is rejected', async () => {
  const result = await verifyReadSession(await session({ domain: 'evil.example', uri: 'https://evil.example' }), rules)
  assert.deepEqual(result, { ok: false, error: 'Session was signed for another website' })
})

test('a session for another chain is rejected', async () => {
  const result = await verifyReadSession(await session({ chainId: 56 }), rules)
  assert.equal(result.ok, false)
})

test('a sign-in message for something else (other statement) is rejected', async () => {
  const result = await verifyReadSession(await session({ statement: 'Sign in to some other app.' }), rules)
  assert.deepEqual(result, { ok: false, error: 'Unexpected session statement' })
})

test('an expired session is rejected', async () => {
  const result = await verifyReadSession(await session({ issuedAt: new Date(NOW - 3 * HOUR), expirationTime: new Date(NOW - HOUR) }), rules)
  assert.deepEqual(result, { ok: false, error: 'Session expired — sign in again' })
})

test('a session without an expiry, or living over 24 h, is rejected', async () => {
  assert.equal((await verifyReadSession(await session({ expirationTime: undefined }), rules)).ok, false)
  const long = await session({ issuedAt: new Date(NOW - HOUR), expirationTime: new Date(NOW + 30 * HOUR) })
  assert.deepEqual(await verifyReadSession(long, rules), { ok: false, error: 'Session lasts too long' })
})

test('garbage is rejected, never thrown', async () => {
  assert.equal((await verifyReadSession('not base64 json', rules)).ok, false)
  assert.equal((await verifyReadSession(Buffer.from('{"message":1}').toString('base64'), rules)).ok, false)
  assert.equal((await verifyReadSession('x'.repeat(5000), rules)).ok, false)
})
