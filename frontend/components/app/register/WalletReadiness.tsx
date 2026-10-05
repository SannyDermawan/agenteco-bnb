'use client'
import { useState } from 'react'
import { formatEther, formatUnits, parseEther, parseUnits } from 'viem'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { useAccount, useBalance, useSendTransaction, useWriteContract } from 'wagmi'
import { wagmiConfig } from '@/lib/web3/config'
import { appChain } from '@/lib/web3/chain'
import { ERC20_ABI, USDT_ADDRESS } from '@/lib/web3/abi'
import { useUsdtBalance, useUsdtDecimals } from '@/lib/web3/hooks'
import { GAS_FAUCETS, MIN_NATIVE_BALANCE, NATIVE_SYMBOL, TOKEN_SYMBOL } from '@/lib/web3/network'
import { FIELD_CLASS } from '../FormField'

/**
 * Live balances of an agent's own wallet, and buttons to top it up from the
 * connected wallet: tBNB for gas (every agent) and mUSDT to spend (buyers).
 * Only public addresses are involved; the agent's key never comes near the page.
 */
export function WalletReadiness({ address, needsToken }: { address: `0x${string}`; needsToken: boolean }) {
  const native = useBalance({ address, query: { refetchInterval: 8000 } })
  const token = useUsdtBalance(address)
  const { data: decimals } = useUsdtDecimals()
  const gas = native.data ? Number(formatEther(native.data.value)) : null
  const spendable = token.data !== undefined && decimals !== undefined ? Number(formatUnits(token.data as bigint, decimals)) : null
  const gasOk = gas !== null && gas >= MIN_NATIVE_BALANCE
  const tokenOk = !needsToken || (spendable !== null && spendable > 0)

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0B0C11]/60 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
        <span className={gasOk ? 'text-[#22C55E]' : 'text-[#F59E0B]'}>
          {gasOk ? '✓' : '•'} {gas === null ? '…' : gas.toFixed(4)} {NATIVE_SYMBOL} for gas {gasOk ? '' : `(needs ${MIN_NATIVE_BALANCE}+)`}
        </span>
        {needsToken && (
          <span className={tokenOk ? 'text-[#22C55E]' : 'text-[#F59E0B]'}>
            {tokenOk ? '✓' : '•'} {spendable === null ? '…' : spendable.toFixed(2)} {TOKEN_SYMBOL} to spend
          </span>
        )}
        {gasOk && tokenOk && <span className="font-medium text-[#22C55E]">Ready</span>}
      </div>
      <TopUp to={address} needsToken={needsToken} onDone={() => (native.refetch(), token.refetch())} />
      {!gasOk && (
        <p className="mt-2 text-[12px] text-[#8B8D96]">
          Or from a faucet:{' '}
          {GAS_FAUCETS.map((f, i) => (
            <span key={f.url}>
              {i > 0 && ' · '}
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[#8E91FF] hover:underline">
                {f.label} ↗
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

function TopUp({ to, needsToken, onDone }: { to: `0x${string}`; needsToken: boolean; onDone: () => void }) {
  const { isConnected, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync } = useSendTransaction()
  const { data: decimals } = useUsdtDecimals()
  const [gasAmount, setGasAmount] = useState('0.01')
  const [tokenAmount, setTokenAmount] = useState('1')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!isConnected) return <p className="mt-2 text-[12px] text-[#8B8D96]">Connect your wallet to send it {NATIVE_SYMBOL}{needsToken ? ` or ${TOKEN_SYMBOL}` : ''} from here.</p>
  if (chainId !== appChain.id) return <p className="mt-2 text-[12px] text-[#F59E0B]">Switch to {appChain.name} from the top bar to top it up from here.</p>

  async function send(kind: 'gas' | 'token') {
    setError(null)
    try {
      setBusy(kind)
      const hash =
        kind === 'gas'
          ? await sendTransactionAsync({ to, value: parseEther(gasAmount) })
          : await writeContractAsync({ address: USDT_ADDRESS, abi: ERC20_ABI, functionName: 'transfer', args: [to, parseUnits(tokenAmount, decimals ?? 18)] })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'The transfer failed.')
    } finally {
      setBusy(null)
    }
  }

  const button = 'rounded-lg border border-white/[0.08] bg-[#11141B] px-3 py-1.5 text-[12px] text-[#F5F5F7] transition hover:border-[#5B5FEF]/40 disabled:opacity-50'
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[#8B8D96]">
      <span>Top up from your wallet:</span>
      <input value={gasAmount} onChange={(e) => setGasAmount(e.target.value)} aria-label={`${NATIVE_SYMBOL} to send`} className={`${FIELD_CLASS} !w-20 !px-2 !py-1 !text-[12px]`} />
      <button type="button" disabled={!!busy || !(Number(gasAmount) > 0)} onClick={() => send('gas')} className={button}>
        {busy === 'gas' ? 'Sending…' : `Send ${NATIVE_SYMBOL}`}
      </button>
      {needsToken && (
        <>
          <input value={tokenAmount} onChange={(e) => setTokenAmount(e.target.value)} aria-label={`${TOKEN_SYMBOL} to send`} className={`${FIELD_CLASS} !w-20 !px-2 !py-1 !text-[12px]`} />
          <button type="button" disabled={!!busy || !(Number(tokenAmount) > 0) || decimals === undefined} onClick={() => send('token')} className={button}>
            {busy === 'token' ? 'Sending…' : `Send ${TOKEN_SYMBOL}`}
          </button>
        </>
      )}
      {error && <span className="w-full text-[#EF4444]">{error}</span>}
    </div>
  )
}
