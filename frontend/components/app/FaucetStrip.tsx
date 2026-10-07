'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatUnits, parseEther, parseUnits } from 'viem'
import { useAccount, useBalance, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from '@/lib/web3/config'
import { appChain } from '@/lib/web3/chain'
import { MOCK_USDT_ABI, USDT_ADDRESS } from '@/lib/web3/abi'
import { useUsdtBalance, useUsdtDecimals } from '@/lib/web3/hooks'
import { GAS_FAUCETS, MIN_NATIVE_BALANCE, NATIVE_SYMBOL, TOKEN_HAS_FAUCET, TOKEN_SYMBOL } from '@/lib/web3/network'

/** Below this much of the settlement token the strip offers the faucet. */
const LOW_TOKEN_BALANCE = 5
const DISMISS_KEY = 'agenteco:faucet-strip-dismissed'

const BUTTON =
  'rounded-lg bg-[#5B5FEF] px-3 py-1 text-[12px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * App-wide strip for a first-time visitor: this is a testnet, so a wallet needs
 * test tokens before it can hire anyone. Shows only while the wallet is short
 * of gas or of mUSDT, and claims the mUSDT faucet in place. Disappears by
 * itself once the balances are enough, or when dismissed for the session.
 */
export function FaucetStrip() {
  const pathname = usePathname()
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { data: decimals } = useUsdtDecimals()
  const native = useBalance({ address, chainId: appChain.id, query: { enabled: !!address } })
  const token = useUsdtBalance(address)
  const nextClaim = useReadContract({
    address: USDT_ADDRESS,
    abi: MOCK_USDT_ABI,
    functionName: 'nextClaimAt',
    args: address ? [address] : undefined,
    query: { enabled: !!address && TOKEN_HAS_FAUCET },
  })

  const [dismissed, setDismissed] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!TOKEN_HAS_FAUCET || dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {}
  }

  async function handleClaim() {
    setError(null)
    setClaiming(true)
    try {
      const hash = await writeContractAsync({ address: USDT_ADDRESS, abi: MOCK_USDT_ABI, functionName: 'faucet' })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      await Promise.all([token.refetch(), native.refetch(), nextClaim.refetch()])
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'Claim failed. Please try again.')
    } finally {
      setClaiming(false)
    }
  }

  let message: React.ReactNode = null
  let action: React.ReactNode = null

  if (!isConnected) {
    const onDashboard = pathname === '/app/dashboard'
    message = (
      <>
        <span className="font-medium text-[#C9CBFF]">This is a testnet.</span> 1. Connect your wallet.{' '}
        {onDashboard
          ? `2. Claim free test tokens (${NATIVE_SYMBOL} for gas + 100 ${TOKEN_SYMBOL}) in the card below.`
          : `2. Claim free test tokens (${NATIVE_SYMBOL} for gas + 100 ${TOKEN_SYMBOL}) on your Dashboard.`}
      </>
    )
    if (!onDashboard) {
      action = (
        <Link href="/app/dashboard" className={BUTTON}>
          Open Dashboard →
        </Link>
      )
    }
  } else if (chainId !== appChain.id) {
    message = <>Your wallet is on another network. AgentEco runs on {appChain.name}.</>
    action = (
      <button type="button" className={BUTTON} disabled={isSwitching} onClick={() => switchChain({ chainId: appChain.id })}>
        {isSwitching ? 'Switching…' : `Switch to ${appChain.name}`}
      </button>
    )
  } else if (native.data === undefined || token.data === undefined || decimals === undefined) {
    return null
  } else if (native.data.value < parseEther(String(MIN_NATIVE_BALANCE))) {
    message = (
      <>
        <span className="font-medium text-[#C9CBFF]">You need {NATIVE_SYMBOL} for gas</span> before you can do anything on a
        testnet. Get some free from a faucet, then claim {TOKEN_SYMBOL} here.
      </>
    )
    if (GAS_FAUCETS[0]) {
      action = (
        <a href={GAS_FAUCETS[0].url} target="_blank" rel="noopener noreferrer" className={BUTTON}>
          Get {NATIVE_SYMBOL} ↗
        </a>
      )
    }
  } else if (token.data < parseUnits(String(LOW_TOKEN_BALANCE), decimals)) {
    const nextClaimAtMs = nextClaim.data ? Number(nextClaim.data) * 1000 : 0
    if (nextClaimAtMs > now) return null // already claimed today; nothing the strip can do
    message = (
      <>
        <span className="font-medium text-[#C9CBFF]">Get free test tokens.</span> You hold{' '}
        {Number(formatUnits(token.data, decimals)).toFixed(2)} {TOKEN_SYMBOL}. Claim 100 to hire agents on {appChain.name}.
      </>
    )
    action = (
      <button type="button" className={BUTTON} disabled={claiming} onClick={handleClaim}>
        {claiming ? 'Claiming…' : `Claim 100 ${TOKEN_SYMBOL}`}
      </button>
    )
  } else {
    return null
  }

  return (
    <div className="border-b border-[#5B5FEF]/25 bg-[#5B5FEF]/[0.08] px-4 py-2 text-[12px] text-[#A9ACD9] md:px-7">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center">
        <span>{message}</span>
        {action}
        {error && <span className="text-[#EF4444]">{error}</span>}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="ml-1 rounded px-1.5 text-[14px] leading-none text-[#8B8D96] transition hover:text-[#F5F5F7]"
        >
          ×
        </button>
      </div>
    </div>
  )
}
