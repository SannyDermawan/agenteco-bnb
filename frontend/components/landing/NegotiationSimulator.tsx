'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { simulateNegotiation, type SimResult, type SimRound } from '@/lib/negotiationSim'
import { fadeUp, REVEAL_VIEWPORT } from './scrollReveal'
import { RobotAvatar, formatUsdt, fragmentMono } from './ui'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

const STEP_MS = 650

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  accent,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  accent: string
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-[#A3A5AE]">{label}</span>
        <span className={`text-[15px] text-[#F5F5F7] ${fragmentMono.className}`}>{formatUsdt(value)} {TOKEN_SYMBOL}</span>
      </div>
      {/* Autofill extensions stamp attributes (e.g. fdprocessedid) onto form controls before hydration. */}
      <input
        suppressHydrationWarning
        type="range"
        min={Math.round(min * 100)}
        max={Math.round(max * 100)}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="mt-2 w-full cursor-pointer"
        style={{ accentColor: accent }}
      />
    </label>
  )
}

function Bubble({ round }: { round: SimRound }) {
  const buyer = round.side === 'buyer'
  const text =
    round.action === 'offer'
      ? `Offers ${formatUsdt(round.price)} ${TOKEN_SYMBOL}`
      : round.action === 'counter'
        ? `Counters ${formatUsdt(round.price)} ${TOKEN_SYMBOL}`
        : round.action === 'accept'
          ? `Accepts ${formatUsdt(round.price)} ${TOKEN_SYMBOL}`
          : 'Walks away — out of range'
  const tone =
    round.action === 'accept'
      ? 'border border-[#22A06B]/40 bg-[#22A06B]/10 text-[#22A06B]'
      : round.action === 'reject'
        ? 'border border-[#EF4444]/35 bg-[#EF4444]/10 text-[#F87171]'
        : buyer
          ? 'bg-[#4F7CFF]/12 text-[#F5F5F7]'
          : 'bg-[#8B5CF6]/14 text-[#F5F5F7]'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: buyer ? -14 : 14, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      className={`flex items-end gap-2.5 ${buyer ? '' : 'flex-row-reverse'}`}
    >
      <RobotAvatar role={round.side} size={32} />
      <div className={`rounded-2xl px-3.5 py-2 text-[13.5px] ${buyer ? 'rounded-bl-md' : 'rounded-br-md'} ${tone}`}>{text}</div>
    </motion.div>
  )
}

/**
 * One playback of a negotiation: reveals the rounds one by one, then the
 * outcome. Remounted (via `key`) whenever the inputs change or on Replay, so
 * it always starts from the first round.
 */
function Playback({ result, listedPrice }: { result: SimResult; listedPrice: number }) {
  const reduce = useReducedMotion()
  const rounds = result.kind === 'skipped' ? NO_ROUNDS : result.rounds
  const [shown, setShown] = useState(reduce ? rounds.length : 0)

  useEffect(() => {
    if (reduce) return
    const timers = rounds.map((_, i) => setTimeout(() => setShown(i + 1), 250 + i * STEP_MS))
    return () => timers.forEach(clearTimeout)
  }, [rounds, reduce])

  const finished = shown >= rounds.length

  return (
    <>
      <div className="mt-5 flex-1 space-y-3" aria-live="polite">
        {result.kind === 'skipped' ? (
          <p className="rounded-xl border border-white/10 bg-[#0D0F16] p-4 text-[13.5px] leading-relaxed text-[#A3A5AE]">
            Even the buyer&apos;s opening offer (50% of the seller&apos;s price) is above its max budget, so it never
            opens a negotiation with this seller — it looks for another one instead.
          </p>
        ) : (
          rounds.slice(0, shown).map((r, i) => <Bubble key={i} round={r} />)
        )}
      </div>

      <div className="mt-6 min-h-[64px]">
        {result.kind !== 'skipped' && finished && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${
              result.kind === 'deal' ? 'border-[#22A06B]/35 bg-[#22A06B]/[0.07]' : 'border-white/10 bg-[#0D0F16]'
            }`}
          >
            {result.kind === 'deal' ? (
              <>
                <span className="text-[14px] font-semibold text-[#22A06B]">
                  Deal at <span className={fragmentMono.className}>{formatUsdt(result.price)}</span> {TOKEN_SYMBOL}
                </span>
                <span className="text-[13px] text-[#A3A5AE]">
                  → escrow funded on-chain · {formatUsdt(listedPrice - result.price)} {TOKEN_SYMBOL} under list price
                </span>
              </>
            ) : (
              <span className="text-[13.5px] text-[#A3A5AE]">No deal — their ranges never met, so no money moves.</span>
            )}
            <Link href="/app/create-agent" className="ml-auto text-[13px] font-medium text-[#5B5FEF] hover:underline">
              Run it for real →
            </Link>
          </motion.div>
        )}
      </div>
    </>
  )
}

const NO_ROUNDS: SimRound[] = []

/**
 * Interactive version of the engine hosted agents run (lib/negotiationSim.ts):
 * move the seller's price/floor and the buyer's budget, watch the rounds replay.
 */
export function NegotiationSimulator() {
  const [sellerPrice, setSellerPrice] = useState(0.3)
  const [sellerFloor, setSellerFloor] = useState(0.24)
  const [buyerBudget, setBuyerBudget] = useState(1)
  const [runId, setRunId] = useState(0)

  const floor = Math.min(sellerFloor, sellerPrice)
  const result = useMemo(
    () => simulateNegotiation({ sellerPrice, sellerFloor: floor, buyerBudget }),
    [sellerPrice, floor, buyerBudget]
  )

  return (
    <motion.div
      custom={0}
      initial="hidden"
      whileInView="show"
      viewport={REVEAL_VIEWPORT}
      variants={fadeUp}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0B0C12]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(40% 70% at 0% 0%, rgba(79,124,255,.10), transparent 70%), radial-gradient(40% 70% at 100% 100%, rgba(139,92,246,.10), transparent 70%)',
        }}
      />
      <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="border-b border-white/[0.07] p-6 md:p-8 lg:border-b-0 lg:border-r">
          <div className={`text-[11px] tracking-[0.16em] text-[#5B5FEF] ${fragmentMono.className}`}>TRY THE ENGINE</div>
          <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-[#F5F5F7]">Set the limits. Watch them deal.</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#A3A5AE]">
            This is the exact logic the hosted agents run. The buyer opens at 50% of the seller&apos;s price; each side
            concedes in up to three steps toward its limit.
          </p>

          <div className="mt-7 space-y-6">
            <div className="space-y-4 rounded-2xl border border-[#8B5CF6]/20 bg-[#8B5CF6]/[0.04] p-4">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#F5F5F7]">
                <RobotAvatar role="seller" size={22} /> Seller agent
              </div>
              <Slider label="Listed price" value={sellerPrice} min={0.1} max={1} onChange={setSellerPrice} accent="#8B5CF6" />
              <Slider label="Won't go below" value={floor} min={0.05} max={sellerPrice} onChange={setSellerFloor} accent="#8B5CF6" />
            </div>
            <div className="space-y-4 rounded-2xl border border-[#4F7CFF]/20 bg-[#4F7CFF]/[0.04] p-4">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#F5F5F7]">
                <RobotAvatar role="buyer" size={22} /> Buyer agent
              </div>
              <Slider label="Max budget" value={buyerBudget} min={0.05} max={1.5} onChange={setBuyerBudget} accent="#4F7CFF" />
            </div>
          </div>
        </div>

        <div className="flex min-h-[420px] flex-col p-6 md:p-8">
          <div className="flex items-center justify-between">
            <span className={`text-[11px] tracking-[0.16em] text-[#7C7E87] ${fragmentMono.className}`}>NEGOTIATION</span>
            <button
              suppressHydrationWarning
              type="button"
              onClick={() => setRunId((n) => n + 1)}
              className="rounded-full border border-white/10 px-3 py-1 text-[12px] text-[#A3A5AE] transition hover:border-white/25 hover:text-[#F5F5F7]"
            >
              ↻ Replay
            </button>
          </div>

          <Playback
            key={`${runId}-${sellerPrice}-${floor}-${buyerBudget}`}
            result={result}
            listedPrice={sellerPrice}
          />
        </div>
      </div>
    </motion.div>
  )
}
