'use client'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'
import { NeumorphicCard } from './NeumorphicCard'
import { forgetPendingReason, getDisputeReason, readPendingReason, submitDisputeReason } from '@/lib/api/disputes'
import { useIsArbiter } from '@/lib/web3/hooks'

const DISPUTED = 4 // AgentEco.sol OrderStatus

/**
 * The buyer's reason for a dispute, shown to both parties and the arbiter.
 * While a dispute is open with no reason saved (e.g. the save failed right
 * after the on-chain dispute), the buyer can add it here.
 */
export function DisputeReasonCard({ escrowId, status, buyer }: { escrowId: bigint; status: number; buyer: string }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()
  const isArbiter = useIsArbiter(address)
  const isBuyer = !!address && address.toLowerCase() === buyer.toLowerCase()

  const { data: reason, isPending } = useQuery({
    queryKey: ['disputeReason', escrowId.toString()],
    queryFn: () => getDisputeReason(escrowId.toString()),
    // Picks up a reason saved a moment after the dispute tx confirms.
    refetchInterval: (query) => (status === DISPUTED && !query.state.data ? 10_000 : false),
  })

  const [draft, setDraft] = useState('')
  // Prefill with the exact text the dispute transaction hashed, if this browser sent it.
  useEffect(() => {
    const pending = readPendingReason(escrowId.toString())
    if (pending) setDraft(pending)
  }, [escrowId])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only relevant once a dispute exists (or existed, for the record).
  if (status !== DISPUTED && !reason) return null

  async function handleSave() {
    if (!address) return
    setSaving(true)
    setError(null)
    try {
      await submitDisputeReason({ address, signMessageAsync }, escrowId.toString(), draft.trim())
      forgetPendingReason(escrowId.toString())
      await queryClient.invalidateQueries({ queryKey: ['disputeReason', escrowId.toString()] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your reason.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <NeumorphicCard className="p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[12px] font-medium tracking-[0.1em] text-[#8B8D96]">DISPUTE</h3>
        {status === DISPUTED && (
          <span className="rounded-full border border-[#EF4444]/35 bg-[#EF4444]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#F87171]">
            {isArbiter ? 'Awaiting your decision' : 'Awaiting arbiter'}
          </span>
        )}
      </div>

      {reason ? (
        <>
          <div className="text-[11.5px] text-[#8B8D96]">Buyer&apos;s reason</div>
          <p className="mt-1.5 whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-[#0B0C11] p-3.5 text-[13px] leading-relaxed text-[#F5F5F7]">
            {reason.reason}
          </p>
        </>
      ) : isPending ? (
        <p className="text-[13px] text-[#8B8D96]">Loading…</p>
      ) : isBuyer ? (
        <div className="space-y-2">
          <p className="text-[13px] text-[#8B8D96]">Tell the arbiter what&apos;s wrong — they rule with this as context.</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full resize-none rounded-lg border border-white/[0.08] bg-[#0B0C11] px-3 py-2 text-[13px] text-[#F5F5F7] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || draft.trim().length < 10}
            className="w-full rounded-xl bg-[#5B5FEF] py-2.5 text-[13px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save reason'}
          </button>
          {error && <p className="text-[12px] text-[#EF4444]">{error}</p>}
        </div>
      ) : (
        <p className="text-[13px] text-[#8B8D96]">The buyer hasn&apos;t given a reason for this dispute.</p>
      )}
    </NeumorphicCard>
  )
}
