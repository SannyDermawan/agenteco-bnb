'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { NegotiationEntry } from '@/lib/agenteco-data'
import { getTaskByEscrow } from '@/lib/api/tasks'
import { explorerTxUrl, useEscrowTxHashes } from '@/lib/web3/escrowEvents'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

const SIDE_STYLE = {
  buyer: { bubble: 'border-[#4F7CFF]/30 bg-[#4F7CFF]/10', text: 'text-[#4F7CFF]', avatar: 'bg-[#4F7CFF]/20 text-[#8FA9FF]' },
  seller: { bubble: 'border-[#8B5CF6]/30 bg-[#8B5CF6]/10', text: 'text-[#8B5CF6]', avatar: 'bg-[#8B5CF6]/20 text-[#B79BFA]' },
} as const

const ACTION_LABEL: Record<NegotiationEntry['action'], string> = {
  offer: 'Offer',
  counter: 'Counter-offer',
  accept: 'Accepted',
  reject: 'Rejected',
}

function Badge({ children, tone }: { children: string; tone: 'amber' | 'grey' }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${
        tone === 'amber' ? 'border-[#F59E0B]/35 bg-[#F59E0B]/10 text-[#F59E0B]' : 'border-white/10 bg-white/[0.04] text-[#8B8D96]'
      }`}
    >
      {children}
    </span>
  )
}

/**
 * The agent ↔ agent price chat (spec §9): who spoke, the price as the main
 * text, the model's reason in small dim type, and badges when a guardrail
 * adjusted the move or no model was involved.
 */
export function NegotiationTimeline({ entries }: { entries: NegotiationEntry[] }) {
  return (
    <div className="space-y-3">
      {entries.map((e, i) => {
        const style = SIDE_STYLE[e.side]
        const isBuyer = e.side === 'buyer'
        return (
          <div key={i} className={`flex items-end gap-2 ${isBuyer ? 'flex-row-reverse' : ''}`}>
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${style.avatar}`}
              aria-hidden
            >
              {e.who.trim().charAt(0).toUpperCase() || '?'}
            </div>
            <div className={`min-w-0 max-w-[78%] rounded-xl border px-3.5 py-2.5 ${style.bubble}`}>
              <div className={`mb-1 text-[10.5px] font-medium tracking-[0.04em] ${style.text}`}>
                {isBuyer ? 'Buyer' : 'Seller'} · {e.who}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 text-[#F5F5F7]">
                {e.price !== null && (
                  <span className="text-[15px] font-semibold">
                    {e.price.toFixed(2)} {TOKEN_SYMBOL}
                  </span>
                )}
                <span className="text-[11.5px] text-[#8B8D96]">{ACTION_LABEL[e.action]}</span>
              </div>
              {e.reason && <p className="mt-1 break-words text-[11.5px] leading-snug text-[#8B8D96]">{e.reason}</p>}
              {(e.adjusted || e.source === 'rule') && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {e.adjusted && <Badge tone="amber">Adjusted to limit</Badge>}
                  {e.source === 'rule' && <Badge tone="grey">Rule-based</Badge>}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

/**
 * Shown under the chat once both sides accept: the final price, the escrow
 * transaction on the explorer, and the taskHash the escrow commits to.
 */
export function NegotiationDealCard({ price, escrowId }: { price: number; escrowId: bigint | null }) {
  const txHashes = useEscrowTxHashes(escrowId ?? undefined)
  const task = useQuery({
    queryKey: ['taskByEscrow', escrowId?.toString()],
    queryFn: () => getTaskByEscrow(escrowId!.toString()),
    enabled: escrowId !== null,
    refetchInterval: (query) => (query.state.data ? false : 10_000),
  })
  const [copied, setCopied] = useState(false)
  const createTx = txHashes.data?.steps[0]
  const taskHash = task.data?.taskHash

  async function copyTaskHash() {
    if (!taskHash) return
    try {
      await navigator.clipboard.writeText(taskHash)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="mt-4 rounded-xl border border-[#22C55E]/25 bg-[#22C55E]/[0.06] p-3.5 text-[12.5px]">
      <div className="mb-2 text-[10.5px] font-medium tracking-[0.1em] text-[#22C55E]">DEAL AGREED</div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#8B8D96]">Final price</span>
          <span className="font-semibold text-[#F5F5F7]">
            {price.toFixed(2)} {TOKEN_SYMBOL}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#8B8D96]">Escrow</span>
          {escrowId === null ? (
            <span className="text-[#8B8D96]">Waiting for the buyer to fund…</span>
          ) : createTx ? (
            <a href={explorerTxUrl(createTx)} target="_blank" rel="noreferrer" className="text-[#8FA9FF] hover:underline">
              #{escrowId.toString()} · {shortHash(createTx)} ↗
            </a>
          ) : (
            <span className="text-[#F5F5F7]">#{escrowId.toString()}</span>
          )}
        </div>
        {escrowId !== null && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#8B8D96]">Task hash</span>
            {taskHash ? (
              <button type="button" onClick={copyTaskHash} title={taskHash} className="font-mono text-[11.5px] text-[#F5F5F7] hover:text-white">
                {copied ? 'Copied' : shortHash(taskHash)}
              </button>
            ) : (
              <span className="text-[#8B8D96]">{task.isPending ? 'Loading…' : 'Not linked yet'}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
