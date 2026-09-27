'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { NeumorphicCard } from '@/components/app/NeumorphicCard'
import { PageFade } from '@/components/app/PageFade'
import { ArrowRightIcon } from '@/components/app/icons'
import { listDisputeReasons, type ApiDispute } from '@/lib/api/disputes'
import { ArbiterDecision } from '@/components/app/ArbiterDecision'
import { Remaining, useNow } from '@/components/app/DeadlineCountdown'
import { explorerTxUrl, useDisputes, type DisputeSummary } from '@/lib/web3/escrowEvents'
import { useArbiter, useIsArbiter, useUsdtDecimals } from '@/lib/web3/hooks'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

const DISPUTED = 4 // AgentEco.sol OrderStatus

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function waitingFor(since: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function DisputeRow({ d, record, decimals }: { d: DisputeSummary; record?: ApiDispute; decimals?: number }) {
  const open = d.status === DISPUTED
  const now = useNow()
  const overrideDeadline = record?.overrideDeadline ? Math.floor(new Date(record.overrideDeadline).getTime() / 1000) : null
  const amount = decimals !== undefined ? formatUnits(d.amount, decimals) : '…'
  return (
    <NeumorphicCard className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] font-semibold text-[#F5F5F7]">Escrow #{d.escrowId.toString()}</span>
        <span className="text-[13px] text-[#8B8D96]">{amount} {TOKEN_SYMBOL}</span>
        {open ? (
          <span className="rounded-full border border-[#EF4444]/35 bg-[#EF4444]/10 px-2 py-0.5 text-[11px] font-medium text-[#F87171]">
            Waiting {waitingFor(d.raisedAt)}
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-[#8B8D96]">
            {d.resolution
              ? d.resolution.byTimeout
                ? 'Refunded — arbiter deadline passed'
                : d.resolution.releasedToSeller
                  ? 'Released to seller'
                  : 'Refunded to buyer'
              : 'Closed'}
          </span>
        )}
        <Link
          href={`/app/orders/onchain/${d.escrowId}`}
          className={`ml-auto flex items-center gap-1 rounded-xl px-3.5 py-2 text-[13px] font-medium transition ${
            open ? 'bg-[#5B5FEF] text-white hover:brightness-110' : 'border border-white/[0.08] text-[#F5F5F7] hover:border-white/20'
          }`}
        >
          {open ? 'Order details' : 'View'}
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-3">
        <div className="text-[#8B8D96]">
          Buyer <span className="font-mono text-[#4F7CFF]">{truncateAddress(d.buyer)}</span>
        </div>
        <div className="text-[#8B8D96]">
          Seller <span className="font-mono text-[#8B5CF6]">{truncateAddress(d.seller)}</span>
        </div>
        <div className="text-[#8B8D96]">
          Raised {new Date(d.raisedAt).toLocaleString()}{' '}
          {d.raisedTx && (
            <a href={explorerTxUrl(d.raisedTx)} target="_blank" rel="noreferrer" className="text-[#5B5FEF] hover:underline">
              ↗
            </a>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-medium tracking-[0.08em] text-[#8B8D96]">BUYER&apos;S REASON</div>
          <p className="whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-[#0B0C11] p-3 text-[13px] leading-relaxed text-[#F5F5F7]">
            {record?.reason || <span className="text-[#8B8D96]">No reason text — only its hash is on-chain.</span>}
          </p>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium tracking-[0.08em] text-[#8B8D96]">
            SELLER&apos;S RESPONSE{record?.responseSource === 'ai' ? ' · AI' : ''}
          </div>
          <p className="whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-[#0B0C11] p-3 text-[13px] leading-relaxed text-[#F5F5F7]">
            {record?.sellerResponse || <span className="text-[#8B8D96]">No response.</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-[#5B5FEF]/25 bg-[#5B5FEF]/[0.05] p-3">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[11px] font-medium tracking-[0.08em] text-[#8FA9FF]">
          AI RECOMMENDATION
          {record?.recModel && <span className="font-normal normal-case tracking-normal text-[#54565F]">{record.recProvider}/{record.recModel}</span>}
        </div>
        {record?.recVerdict ? (
          <>
            <div className="text-[13px] text-[#F5F5F7]">
              {record.recVerdict === 'seller' ? 'Release to seller' : 'Refund buyer'} ·{' '}
              <span className="text-[#8B8D96]">{record.recConfidence}% confident</span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[#8B8D96]">{record.recRationale}</p>
          </>
        ) : record?.recUnavailable ? (
          <p className="text-[12.5px] text-[#8B8D96]">AI recommendation unavailable — decide manually.</p>
        ) : (
          <p className="text-[12.5px] text-[#8B8D96]">Pending — runs after the seller responds or its window closes.</p>
        )}
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#8B8D96]">
            {overrideDeadline && record?.recVerdict && (
              <span>
                Your override window: <Remaining deadline={overrideDeadline} now={now} />
                {' — then the AI ruling executes if it is confident enough'}
              </span>
            )}
            <span>
              Dispute deadline: <Remaining deadline={Math.floor(d.deadline / 1000)} now={now} /> — then the buyer is refunded
            </span>
          </div>
          <ArbiterDecision escrowId={d.escrowId} dispute={record} />
        </div>
      ) : (
        record?.resolution && (
          <div className="mt-3 text-[12px] text-[#8B8D96]">
            Decided by{' '}
            {record.resolution === 'ai-auto' ? 'the AI arbiter (automatic)' : record.resolution === 'arbiter-manual' ? 'the arbiter' : 'timeout'}
            {record.resolutionTx && (
              <>
                {' '}
                ·{' '}
                <a href={explorerTxUrl(record.resolutionTx)} target="_blank" rel="noreferrer" className="text-[#5B5FEF] hover:underline">
                  tx ↗
                </a>
              </>
            )}
          </div>
        )
      )}
    </NeumorphicCard>
  )
}

/** The arbiter's inbox: every dispute on the contract, open ones (longest waiting) first. */
export default function DisputesPage() {
  const { address, isConnected } = useAccount()
  const { data: arbiter } = useArbiter()
  const isArbiter = useIsArbiter(address)
  const { data: disputes, isPending } = useDisputes(isArbiter)
  const { data: decimals } = useUsdtDecimals()
  const { data: reasons } = useQuery({
    queryKey: ['disputeReasons'],
    queryFn: listDisputeReasons,
    enabled: isArbiter,
    refetchInterval: 5_000,
  })
  const recordByEscrow = new Map((reasons ?? []).map((r) => [r.escrowId, r]))

  const open = disputes?.filter((d) => d.status === DISPUTED) ?? []
  const closed = disputes?.filter((d) => d.status !== DISPUTED) ?? []

  return (
    <PageFade>
      <div className="space-y-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#F5F5F7]">Disputes</h2>
          <p className="mt-1 text-[13.5px] text-[#8B8D96]">
            Escrows a buyer has disputed. The AI arbiter recommends a ruling once the seller has answered; approve it,
            reverse it with your own reasons, or let a confident recommendation execute when your override window ends.
          </p>
        </div>

        {!isConnected ? (
          <NeumorphicCard className="p-6 text-[13.5px] text-[#8B8D96]">
            Connect the arbiter wallet from the top bar to review disputes.
          </NeumorphicCard>
        ) : !isArbiter ? (
          <NeumorphicCard className="p-6 text-[13.5px] leading-relaxed text-[#8B8D96]">
            Only the AgentEco arbiter can resolve disputes
            {arbiter && (
              <>
                {' '}
                — currently <span className="font-mono text-[#F5F5F7]">{truncateAddress(arbiter)}</span>
              </>
            )}
            .
          </NeumorphicCard>
        ) : isPending ? (
          <NeumorphicCard className="p-6 text-[13.5px] text-[#8B8D96]">Reading disputes from the chain…</NeumorphicCard>
        ) : (
          <>
            <section className="space-y-3">
              <h3 className="text-[12px] font-medium tracking-[0.1em] text-[#8B8D96]">OPEN · {open.length}</h3>
              {open.length === 0 ? (
                <NeumorphicCard className="p-6 text-center text-[13.5px] text-[#8B8D96]">
                  No open disputes — nothing is waiting on you.
                </NeumorphicCard>
              ) : (
                open.map((d) => (
                  <DisputeRow key={d.escrowId.toString()} d={d} record={recordByEscrow.get(d.escrowId.toString())} decimals={decimals} />
                ))
              )}
            </section>

            {closed.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-[12px] font-medium tracking-[0.1em] text-[#8B8D96]">RESOLVED · {closed.length}</h3>
                {closed.map((d) => (
                  <DisputeRow key={d.escrowId.toString()} d={d} record={recordByEscrow.get(d.escrowId.toString())} decimals={decimals} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </PageFade>
  )
}
