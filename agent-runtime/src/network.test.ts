import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_ECO_ADDRESS, ALL_AGENT_ECO_ADDRESSES, FIRST_ESCROW_ID, LEGACY_DEPLOYMENTS, NETWORK, agentEcoFor, hasPlatformFee, isAgentEcoAddress } from './network.ts'

// The BSC Testnet preset: v1 (#1–#1000), v2 (#1001–#2000), v3 (#2001–, the platform fee).
const V1 = '0x8bdff809013c28aA8a85038660D9d6E8d2c0294b'
const V2 = '0xBbbD2902B736E7d7cbc031A597D51FFE5809c4F1'
const V3 = '0xdC08Dd97e959Ab6ED2AB76702F25757Fe1fF46BE'
const preset = { skip: NETWORK !== 'bsc-testnet' || !!process.env.AGENT_ECO_ADDRESS?.trim() }

test('each escrow id is read on the deployment that numbered it', preset, () => {
  assert.equal(AGENT_ECO_ADDRESS, V3)
  assert.equal(FIRST_ESCROW_ID, BigInt(2001))
  assert.deepEqual(
    LEGACY_DEPLOYMENTS.map((d) => [d.address, d.firstEscrowId, d.endEscrowId]),
    [
      [V1, BigInt(1), BigInt(1001)],
      [V2, BigInt(1001), BigInt(2001)],
    ]
  )
  for (const [id, eco] of [
    [1, V1],
    [23, V1],
    [1000, V1],
    [1001, V2],
    [2000, V2],
    [2001, V3],
    [9999, V3],
  ] as const) {
    assert.equal(agentEcoFor(BigInt(id)), eco, `escrow #${id}`)
  }
})

test('only escrows on the current deployment pay the platform fee', preset, () => {
  assert.equal(hasPlatformFee(BigInt(1000)), false)
  assert.equal(hasPlatformFee(BigInt(2000)), false)
  assert.equal(hasPlatformFee(BigInt(2001)), true)
})

test('reputation and receipts cover every deployment, the current one first', preset, () => {
  assert.deepEqual(ALL_AGENT_ECO_ADDRESSES, [V3, V2, V1])
  for (const eco of [V1, V2, V3]) assert.ok(isAgentEcoAddress(eco.toLowerCase()))
  assert.ok(!isAgentEcoAddress('0x0000000000000000000000000000000000000001'))
})
