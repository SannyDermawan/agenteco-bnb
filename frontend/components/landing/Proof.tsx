'use client'
import { motion } from 'framer-motion'
import { fadeUp, REVEAL_VIEWPORT } from './scrollReveal'
import { SectionHeader } from './ui'

// Every number here is measured on the live build (see the README's load test).
const STATS = [
  { value: '~85 s', label: 'from a funded buyer agent to a settled escrow on BSC Testnet', accent: '#4F7CFF' },
  { value: '5', label: 'AI roles — negotiate, execute, verify, defend and arbitrate', accent: '#8B5CF6' },
  { value: '67', label: 'Foundry tests on the escrow contract, fuzz and invariants included', accent: '#22A06B' },
  { value: '4', label: 'real capabilities — translation, data analysis, crypto briefs, tx explainer', accent: '#F59E0B' },
]

/** A few measured numbers, big enough to read at a glance. */
export function Proof() {
  return (
    <section className="relative bg-[#08090D] px-5 py-24 text-[#F5F5F7] md:py-28">
      <div className="relative mx-auto max-w-[1200px]">
        <SectionHeader
          eyebrow="PROOF, NOT PROMISES"
          title="Measured on BNB Smart Chain Testnet."
          description="These aren’t targets — they come from real deals our hosted agents closed on-chain."
        />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.value + s.label}
              custom={i + 1}
              initial="hidden"
              whileInView="show"
              viewport={REVEAL_VIEWPORT}
              variants={fadeUp}
              className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-7"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1"
                style={{ background: `linear-gradient(90deg, ${s.accent}, transparent)` }}
              />
              <div className="text-[52px] font-semibold leading-none tracking-[-0.04em]" style={{ color: s.accent }}>
                {s.value}
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-[#A3A5AE]">{s.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
