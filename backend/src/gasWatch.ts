import { formatEther, parseEther, type Address, type PublicClient } from 'viem'
import { HOSTED_MIN_GAS, LOW_GAS_WARN, NATIVE_SYMBOL } from './network.ts'
import { log } from './log.ts'

// A wallet's balance is re-read at most this often — the host loop runs every
// few seconds per agent, and gas drains slowly.
const CHECK_EVERY_MS = 5 * 60_000
const lastChecked = new Map<string, number>()

/**
 * Logs a warning when a system wallet (keeper, arbiter, a hosted agent) runs
 * low on native gas, so an operator tops it up before transactions start
 * failing. Never throws — a failed balance read must not stop the loop.
 */
export async function warnIfLowGas(
  publicClient: PublicClient,
  address: Address,
  label: string,
  /** 'system' = keeper/arbiter (LOW_GAS_WARN_TBNB); 'hosted' = an agent wallet (HOSTED_MIN_GAS). */
  kind: 'system' | 'hosted' = 'system'
): Promise<void> {
  const key = address.toLowerCase()
  const now = Date.now()
  if (now - (lastChecked.get(key) ?? 0) < CHECK_EVERY_MS) return
  lastChecked.set(key, now)

  try {
    const balance = await publicClient.getBalance({ address })
    const threshold = kind === 'hosted' ? HOSTED_MIN_GAS : LOW_GAS_WARN
    if (balance < parseEther(threshold)) {
      log(
        `WARNING low gas: ${label} ${address} has ${formatEther(balance)} ${NATIVE_SYMBOL} ` +
          `(below ${threshold}). Top it up before its transactions start failing.`
      )
    }
  } catch {
    // Balance read failed (RPC hiccup) — try again next window.
    lastChecked.delete(key)
  }
}
