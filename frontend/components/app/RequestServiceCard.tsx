'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseUnits } from 'viem'
import { readContract, waitForTransactionReceipt } from 'wagmi/actions'
import { useAccount, useWriteContract } from 'wagmi'
import { NeumorphicCard } from './NeumorphicCard'
import { wagmiConfig } from '@/lib/web3/config'
import { appChain } from '@/lib/web3/chain'
import { AGENT_ECO_ABI, AGENT_ECO_ADDRESS, ERC20_ABI, USDT_ADDRESS } from '@/lib/web3/abi'
import { EXECUTION_WINDOW_SECONDS, REVIEW_WINDOW_SECONDS, formatDuration } from '@/lib/web3/constants'
import { parseCreatedEscrowId, useUsdtDecimals } from '@/lib/web3/hooks'
import { InsufficientTokenError, assertUsdtBalance } from '@/lib/web3/usdtBalance'
import { GetTestTokensCard } from './GetTestTokensCard'
import { taskHash } from '@shared/hashes'
import type { AgentSummary } from '@/lib/agenteco-data'
import { getAgent } from '@/lib/api/agents'
import { ArrowRightIcon } from './icons'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

type Step = 'idle' | 'checking-status' | 'checking-balance' | 'creating' | 'checking-allowance' | 'approving' | 'funding' | 'done'

const STEP_LABEL: Record<Exclude<Step, 'idle' | 'done'>, string> = {
  'checking-status': 'Checking agent availability…',
  'checking-balance': `Checking ${TOKEN_SYMBOL} balance…`,
  creating: 'Creating escrow…',
  'checking-allowance': `Checking ${TOKEN_SYMBOL} allowance…`,
  approving: 'Approving USDT…',
  funding: 'Funding escrow…',
}

function Spinner() {
  return <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
}

export function RequestServiceCard({ agent }: { agent: AgentSummary }) {
  const router = useRouter()
  const { address, isConnected, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { data: decimals } = useUsdtDecimals()

  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  // Set when the wallet lacks the settlement token — shows the test-token card.
  const [needsTokens, setNeedsTokens] = useState(false)

  const seller = agent.walletAddress
  // The contract itself will escrow for any address — "offline" is only
  // enforced here and in the registry, so an offline seller is never hired.
  const [isOfflineNow, setIsOfflineNow] = useState(false)
  const isOffline = agent.status === 'offline' || isOfflineNow
  const onCorrectChain = chainId === appChain.id
  const busy = step !== 'idle' && step !== 'done'

  async function handleRequestService() {
    if (!seller || isOffline || !address || decimals === undefined) return
    setError(null)
    setNeedsTokens(false)

    try {
      // Re-check right before any money moves — this page may have been open
      // since before the seller went offline.
      setStep('checking-status')
      const latest = await getAgent(agent.id)
      if (latest && !latest.isOnline) {
        setStep('idle')
        setIsOfflineNow(true)
        return
      }

      const amount = parseUnits(agent.price.toString(), decimals)

      setStep('checking-balance')
      await assertUsdtBalance(address, amount, decimals)

      setStep('creating')
      const createHash = await writeContractAsync({
        address: AGENT_ECO_ADDRESS,
        abi: AGENT_ECO_ABI,
        functionName: 'createEscrow',
        args: [
          seller,
          amount,
          EXECUTION_WINDOW_SECONDS,
          REVIEW_WINDOW_SECONDS,
          taskHash({
            capability: agent.capabilities[0] ?? '',
            brief: {},
            price: agent.price.toString(),
            buyer: address,
            seller,
            nonce: crypto.randomUUID(),
          }),
        ],
      })
      const createReceipt = await waitForTransactionReceipt(wagmiConfig, { hash: createHash })
      const escrowId = parseCreatedEscrowId(createReceipt)
      if (escrowId === null) throw new Error('Could not read the new escrow id from the transaction receipt.')

      setStep('checking-allowance')
      const allowance = await readContract(wagmiConfig, {
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, AGENT_ECO_ADDRESS],
      })

      if (allowance < amount) {
        setStep('approving')
        const approveHash = await writeContractAsync({
          address: USDT_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [AGENT_ECO_ADDRESS, amount],
        })
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash })
      }

      setStep('funding')
      const fundHash = await writeContractAsync({
        address: AGENT_ECO_ADDRESS,
        abi: AGENT_ECO_ABI,
        functionName: 'fundEscrow',
        args: [escrowId],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash: fundHash })

      setStep('done')
      router.push(`/app/orders/onchain/${escrowId}`)
    } catch (err) {
      setStep('idle')
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setNeedsTokens(err instanceof InsufficientTokenError)
    }
  }

  return (
    <NeumorphicCard className="p-6">
      <h3 className="text-[15px] font-semibold text-[#F5F5F7]">Request Service</h3>

      {!seller ? (
        <p className="mt-4 text-[13px] leading-relaxed text-[#8B8D96]">
          This agent hasn&apos;t linked an on-chain wallet yet, so it can&apos;t be hired directly on-chain.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-3 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-[#8B8D96]">Service</span>
              <span className="text-[#F5F5F7]">{agent.service}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8B8D96]">Price</span>
              <span className="text-[#F5F5F7]">{agent.price.toFixed(2)} {TOKEN_SYMBOL}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-[#8B8D96]">Seller wallet</span>
              <span className="truncate font-mono text-[11.5px] text-[#F5F5F7]" title={seller}>
                {seller}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8B8D96]">Execution window</span>
              <span className="text-[#F5F5F7]">{formatDuration(EXECUTION_WINDOW_SECONDS)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8B8D96]">Review window</span>
              <span className="text-[#F5F5F7]">{formatDuration(REVIEW_WINDOW_SECONDS)}</span>
            </div>
          </div>

          {isOffline ? (
            <p className="mt-5 rounded-xl border border-white/[0.06] bg-[#0D0F14] px-3 py-2.5 text-[12.5px] text-[#8B8D96]">
              This agent is offline and not accepting new requests right now.
            </p>
          ) : !isConnected ? (
            <p className="mt-5 rounded-xl border border-white/[0.06] bg-[#0D0F14] px-3 py-2.5 text-[12.5px] text-[#8B8D96]">
              Connect your wallet from the top bar to request this service.
            </p>
          ) : !onCorrectChain ? (
            <p className="mt-5 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-2.5 text-[12.5px] text-[#F59E0B]">
              Switch to {appChain.name} from the top bar to continue.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleRequestService}
              disabled={busy || decimals === undefined}
              className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#5B5FEF] py-2.5 text-[13.5px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Spinner />
                  {STEP_LABEL[step as Exclude<Step, 'idle' | 'done'>]}
                </>
              ) : (
                <>
                  Create &amp; Fund Escrow
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          )}

          {error && <p className="mt-3 text-[12px] leading-relaxed text-[#EF4444]">{error}</p>}
          {needsTokens && (
            <div className="mt-4">
              <GetTestTokensCard reason="Your wallet does not hold enough test tokens for this. Claim some, then try again." />
            </div>
          )}
        </>
      )}
    </NeumorphicCard>
  )
}
