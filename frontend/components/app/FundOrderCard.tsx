'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseUnits } from 'viem'
import { readContract, waitForTransactionReceipt } from 'wagmi/actions'
import { useAccount, useSignMessage, useWriteContract } from 'wagmi'
import { NeumorphicCard } from './NeumorphicCard'
import { wagmiConfig } from '@/lib/web3/config'
import { botChain } from '@/lib/web3/chain'
import { AGENT_ECO_ABI, AGENT_ECO_ADDRESS, ERC20_ABI, USDT_ADDRESS } from '@/lib/web3/abi'
import { EXECUTION_WINDOW_SECONDS, REVIEW_WINDOW_SECONDS } from '@/lib/web3/constants'
import { parseCreatedEscrowId, useUsdtDecimals } from '@/lib/web3/hooks'
import { assertUsdtBalance } from '@/lib/web3/usdtBalance'
import { taskHash } from '@shared/hashes'
import { fundOrder, type ApiOrder } from '@/lib/api/orders'
import { ArrowRightIcon } from './icons'

type Step = 'idle' | 'checking-balance' | 'creating' | 'checking-allowance' | 'approving' | 'funding' | 'linking' | 'done'

const STEP_LABEL: Record<Exclude<Step, 'idle' | 'done'>, string> = {
  'checking-balance': 'Checking USDT balance…',
  creating: 'Creating escrow…',
  'checking-allowance': 'Checking USDT allowance…',
  approving: 'Approving USDT…',
  funding: 'Funding escrow…',
  linking: 'Linking escrow to order…',
}

function Spinner() {
  return <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
}

/** Funds the agreed price from a Negotiation — not the seller's listed price. */
export function FundOrderCard({ order }: { order: ApiOrder }) {
  const router = useRouter()
  const { address, isConnected, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const { data: decimals } = useUsdtDecimals()

  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)

  const seller = order.sellerAgent.walletAddress as `0x${string}` | null
  const onCorrectChain = chainId === botChain.id
  const busy = step !== 'idle' && step !== 'done'
  const isBuyerOwner = !!address && address.toLowerCase() === order.buyerAgent.ownerWallet.toLowerCase()

  async function handleFund() {
    if (!seller || !address || decimals === undefined) return
    setError(null)

    try {
      const amount = parseUnits(order.price, decimals)

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
            capability: order.capability,
            brief: {},
            price: order.price,
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

      setStep('linking')
      await fundOrder(order.id, { address, signMessageAsync }, escrowId.toString())

      setStep('done')
      router.push(`/app/orders/${order.id}`)
    } catch (err) {
      setStep('idle')
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  return (
    <NeumorphicCard className="p-6">
      <h3 className="text-[15px] font-semibold text-[#F5F5F7]">Fund This Order</h3>

      {!seller ? (
        <p className="mt-4 text-[13px] leading-relaxed text-[#8B8D96]">
          The seller agent hasn&apos;t linked an on-chain wallet yet, so this order can&apos;t be funded on-chain.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-3 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-[#8B8D96]">Agreed price</span>
              <span className="text-[#F5F5F7]">{Number(order.price).toFixed(2)} USDT</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-[#8B8D96]">Seller wallet</span>
              <span className="truncate font-mono text-[11.5px] text-[#F5F5F7]" title={seller}>
                {seller}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8B8D96]">Execution window</span>
              <span className="text-[#F5F5F7]">24h</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8B8D96]">Review window</span>
              <span className="text-[#F5F5F7]">48h</span>
            </div>
          </div>

          {!isConnected ? (
            <p className="mt-5 rounded-xl border border-white/[0.06] bg-[#0D0F14] px-3 py-2.5 text-[12.5px] text-[#8B8D96]">
              Connect your wallet from the top bar to fund this order.
            </p>
          ) : !onCorrectChain ? (
            <p className="mt-5 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-2.5 text-[12.5px] text-[#F59E0B]">
              Switch to {botChain.name} from the top bar to continue.
            </p>
          ) : !isBuyerOwner ? (
            <p className="mt-5 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-2.5 text-[12.5px] text-[#F59E0B]">
              Connect the wallet that owns the buyer agent ({order.buyerAgent.name}) to fund this order.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleFund}
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
        </>
      )}
    </NeumorphicCard>
  )
}
