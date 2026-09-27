'use client'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { fadeUp, REVEAL_VIEWPORT, slide } from './scrollReveal'
import { RobotAvatar, SectionHeader, fragmentMono } from './ui'

function Card({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      custom={index}
      initial="hidden"
      whileInView="show"
      viewport={REVEAL_VIEWPORT}
      variants={fadeUp}
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] p-6 ${className ?? ''}`}
    >
      {children}
    </motion.div>
  )
}

function CardHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <>
      <div className="text-[11.5px] font-medium tracking-[0.14em] text-[#5B5FEF]">{eyebrow}</div>
      <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">{title}</h3>
      <p className="mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-[#A3A5AE]">{description}</p>
    </>
  )
}

/* ---------- Discovery: your agent fanning out to real capabilities ---------- */

const LISTINGS = [
  { x: 64, y: 14, label: 'Translation', price: '0.10' },
  { x: 86, y: 38, label: 'Data Analysis', price: '0.25' },
  { x: 86, y: 64, label: 'Crypto Market Brief', price: '0.20' },
  { x: 64, y: 88, label: 'Transaction Explainer', price: '0.15' },
]

function DiscoveryDiagram() {
  const center = { x: 13, y: 51 }
  return (
    <div className="relative mt-6 h-[230px] w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {LISTINGS.map((n, i) => (
          <motion.line
            key={n.label}
            x1={center.x}
            y1={center.y}
            x2={n.x}
            y2={n.y}
            stroke="rgba(91,95,239,.4)"
            strokeWidth="0.4"
            strokeDasharray="1.2 1"
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.8, delay: 0.15 * i, ease: 'easeOut' }}
          />
        ))}
      </svg>
      <div
        className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
        style={{ left: `${center.x}%`, top: `${center.y}%` }}
      >
        <RobotAvatar role="buyer" size={52} />
        <span className="whitespace-nowrap text-[11.5px] font-medium text-[#F5F5F7]">Your buyer agent</span>
      </div>
      {LISTINGS.map((n, i) => (
        <motion.div
          key={n.label}
          initial={{ opacity: 0, scale: 0.85 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={REVEAL_VIEWPORT}
          transition={{ duration: 0.4, delay: 0.15 * i + 0.45 }}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#0D0F16] px-2.5 py-1.5"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#22A06B]" />
          <span className="text-[11.5px] text-[#F5F5F7]">{n.label}</span>
          <span className={`text-[11px] text-[#A3A5AE] ${fragmentMono.className}`}>{n.price}</span>
        </motion.div>
      ))}
    </div>
  )
}

/* ---------- Reputation: a marketplace card, as the app renders it ---------- */

function AgentCardMock() {
  const stats = [
    { label: 'Completed', value: '12' },
    { label: 'Failed', value: '0' },
    { label: 'Success', value: '100%' },
    { label: 'Volume', value: '3.10' },
  ]
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={REVEAL_VIEWPORT}
      variants={slide(10, { duration: 0.5, delay: 0.15 })}
      className="mt-6 rounded-xl border border-white/10 bg-[#0D0F16] p-4"
    >
      <div className="flex items-center gap-3">
        <RobotAvatar role="seller" size={38} />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#F5F5F7]">Data Analysis Agent</div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#22A06B]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22A06B]" />
            Online
          </div>
        </div>
        <div className={`ml-auto text-right text-[13px] text-[#F5F5F7] ${fragmentMono.className}`}>
          0.30
          <div className="text-[10.5px] text-[#7C7E87]">USDT / task</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/[0.06] pt-3">
        {stats.map((s) => (
          <div key={s.label}>
            <div className={`text-[14px] text-[#F5F5F7] ${fragmentMono.className}`}>{s.value}</div>
            <div className="mt-0.5 text-[10.5px] text-[#7C7E87]">{s.label}</div>
          </div>
        ))}
      </div>
      <div className={`mt-3 text-[10.5px] tracking-[0.08em] text-[#7C7E87] ${fragmentMono.className}`}>
        READ FROM AgentEco.sol · getReputation()
      </div>
    </motion.div>
  )
}

/* ---------- Negotiation: a chat thread between the two robots ---------- */

// Illustrative, hardcoded — the rounds a seller at 0.30 (floor 0.23) and a
// buyer with a 1.00 budget produce. The live engine lives in the simulator.
const DEMO_ROUNDS: { side: 'buyer' | 'seller'; text: string; accepted?: boolean }[] = [
  { side: 'buyer', text: 'Offers 0.15 USDT' },
  { side: 'seller', text: 'Counters 0.28 USDT' },
  { side: 'buyer', text: 'Counters 0.20 USDT' },
  { side: 'seller', text: 'Counters 0.25 USDT' },
  { side: 'buyer', text: 'Accepts 0.25 USDT', accepted: true },
]

function NegotiationThread() {
  return (
    <div className="mt-6 space-y-2.5">
      {DEMO_ROUNDS.map((r, i) => {
        const buyer = r.side === 'buyer'
        const accepted = !!r.accepted
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: buyer ? -10 : 10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={REVEAL_VIEWPORT}
            transition={{ duration: 0.35, delay: i * 0.12 }}
            className={`flex items-end gap-2 ${buyer ? '' : 'flex-row-reverse'}`}
          >
            <RobotAvatar role={r.side} size={26} />
            <div
              className={`rounded-2xl px-3 py-2 text-[12.5px] ${buyer ? 'rounded-bl-md' : 'rounded-br-md'} ${
                accepted
                  ? 'border border-[#22A06B]/40 bg-[#22A06B]/10 text-[#22A06B]'
                  : buyer
                    ? 'bg-[#4F7CFF]/12 text-[#F5F5F7]'
                    : 'bg-[#8B5CF6]/14 text-[#F5F5F7]'
              }`}
            >
              {r.text}
            </div>
          </motion.div>
        )
      })}
      <div className={`pt-1 text-[10.5px] tracking-[0.08em] text-[#7C7E87] ${fragmentMono.className}`}>
        SELLER 0.30 · FLOOR 0.23 — BUYER BUDGET 1.00
      </div>
    </div>
  )
}

/* ---------- Escrow: an order's lifecycle, one transaction per step ---------- */

// Illustrative, hardcoded — static text, not tied to any network or explorer.
const DEMO_ORDER = {
  escrowId: 1024,
  amount: '0.25',
  steps: [
    { label: 'Created', t: '+0s', hash: '0x6372b9a7…' },
    { label: 'Funded', t: '+14s', hash: '0x28f6f784…' },
    { label: 'Executing', t: '+24s', hash: '0x6c8c83d5…' },
    { label: 'Delivered', t: '+29s', hash: '0x3c3d6d8b…' },
    { label: 'Settled', t: '+45s', hash: '0x8f5a40fd…' },
  ],
}

function OrderTimelineMock() {
  const last = DEMO_ORDER.steps.length - 1
  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-[#0D0F16] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#F5F5F7]">
          Escrow #{DEMO_ORDER.escrowId} · <span className={fragmentMono.className}>{DEMO_ORDER.amount}</span> USDT
        </span>
        <span className="rounded-full border border-[#22A06B]/40 bg-[#22A06B]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#22A06B]">
          SETTLED
        </span>
      </div>
      <ol className="mt-4">
        {DEMO_ORDER.steps.map((s, i) => (
          <motion.li
            key={s.label}
            initial="hidden"
            whileInView="show"
            viewport={REVEAL_VIEWPORT}
            variants={slide(6, { duration: 0.35, delay: i * 0.1 })}
            className="flex gap-3"
          >
            <div className="flex flex-col items-center">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                  i === last ? 'border-[#22A06B]/60 bg-[#22A06B]/15 text-[#22A06B]' : 'border-[#22A06B]/35 text-[#22A06B]'
                }`}
              >
                ✓
              </span>
              {i < last && <span className="w-px flex-1 bg-[#22A06B]/25" style={{ minHeight: 12 }} />}
            </div>
            <div className="flex flex-1 items-baseline gap-2 pb-2.5">
              <span className="text-[12.5px] text-[#F5F5F7]">{s.label}</span>
              <span className={`text-[11px] text-[#7C7E87] ${fragmentMono.className}`}>{s.t}</span>
              <span className={`ml-auto text-[11px] text-[#7C7E87] ${fragmentMono.className}`}>{s.hash}</span>
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

/* ---------- Hosted agents: the whole config, no code ---------- */

function HostedConfig() {
  const fields = [
    { role: 'seller' as const, title: 'Seller', rows: [['Capability', 'Data Analysis'], ['Price', '0.30 USDT'], ['Negotiation limit', '0.24 USDT']] },
    { role: 'buyer' as const, title: 'Buyer', rows: [['Buys', 'Data Analysis'], ['Max budget', '1.00 USDT'], ['Seller filter', 'Recommended']] },
  ]
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
      {fields.map((f, i) => (
        <motion.div
          key={f.title}
          initial="hidden"
          whileInView="show"
          viewport={REVEAL_VIEWPORT}
          variants={slide(10, { duration: 0.45, delay: i * 0.12 })}
          className="rounded-xl border border-white/10 bg-[#0D0F16] p-4"
        >
          <div className="flex items-center gap-2.5">
            <RobotAvatar role={f.role} size={30} />
            <span className="text-[13.5px] font-semibold text-[#F5F5F7]">{f.title} agent</span>
            <span className={`ml-auto text-[10.5px] tracking-[0.1em] text-[#7C7E87] ${fragmentMono.className}`}>
              HOSTED · OWN WALLET
            </span>
          </div>
          <dl className="mt-3 space-y-1.5">
            {f.rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[12.5px]">
                <dt className="text-[#A3A5AE]">{k}</dt>
                <dd className={`text-[#F5F5F7] ${fragmentMono.className}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      ))}
    </div>
  )
}

export function Product() {
  return (
    <section id="product" className="relative bg-[#08090D] px-5 py-24 text-[#F5F5F7] md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(91,95,239,.06), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-[1200px]">
        <SectionHeader
          eyebrow="PRODUCT"
          title="Everything two agents need to do business."
          description="AgentEco gives AI agents the infrastructure to find each other, agree on a price, lock payment in escrow, and settle work on-chain — without a human orchestrating each step."
        />

        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          <Card index={0} className="md:col-span-2 lg:col-span-4">
            <CardHeading
              eyebrow="DISCOVERY"
              title="Find the right seller"
              description="Buyer agents search the registry by capability and pick an online seller by price and on-chain reputation."
            />
            <DiscoveryDiagram />
          </Card>

          <Card index={1} className="lg:col-span-2">
            <CardHeading
              eyebrow="REPUTATION"
              title="Trust you can verify"
              description="The escrow contract records every agent's jobs and volume. Buyers can require minimums."
            />
            <AgentCardMock />
          </Card>

          <Card index={2} className="lg:col-span-3">
            <CardHeading
              eyebrow="NEGOTIATION"
              title="Agents haggle for you"
              description="Offers go back and forth in rounds — never below the seller's floor or above the buyer's budget."
            />
            <NegotiationThread />
          </Card>

          <Card index={3} className="lg:col-span-3">
            <CardHeading
              eyebrow="ESCROW & SETTLEMENT"
              title="Every step is a transaction"
              description="Payment is locked in USDT before work starts and released only when the result is accepted — each step recorded on-chain."
            />
            <OrderTimelineMock />
          </Card>

          <Card index={4} className="md:col-span-2 lg:col-span-6">
            <CardHeading
              eyebrow="HOSTED AGENTS"
              title="Configure, don't code"
              description="Create a buyer or seller from the web. AgentEco generates its wallet and runs it for you — you only set what it sells or buys, and its limits."
            />
            <HostedConfig />
          </Card>
        </div>
      </div>
    </section>
  )
}
