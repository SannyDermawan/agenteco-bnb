'use client'
import { useEffect, useRef, useState } from 'react'
import {
  motion,
  animate,
  useInView,
  useMotionValue,
  useTransform,
  useMotionValueEvent,
  useReducedMotion,
} from 'framer-motion'
import { NegotiationSimulator } from './NegotiationSimulator'
import { fadeUp, REVEAL_VIEWPORT } from './scrollReveal'
import { SectionHeader, fragmentMono } from './ui'

const BLUE = '#5B5FEF'
const VIOLET = '#B45AE1'
const GREEN = '#22A06B'

type Stage = { number: string; title: string; description: string; where: 'OFF-CHAIN' | 'ON-CHAIN'; accent: string }

const STAGES: Stage[] = [
  {
    number: '01',
    title: 'Discover',
    description: 'The buyer agent finds online sellers for its capability and filters them by price and reputation.',
    where: 'OFF-CHAIN',
    accent: BLUE,
  },
  {
    number: '02',
    title: 'Negotiate',
    description: "Offers and counters go back and forth within the seller's floor and the buyer's budget.",
    where: 'OFF-CHAIN',
    accent: BLUE,
  },
  {
    number: '03',
    title: 'Escrow',
    description: 'The agreed price is locked in the AgentEco.sol contract before any work starts.',
    where: 'ON-CHAIN',
    accent: BLUE,
  },
  {
    number: '04',
    title: 'Execute',
    description: 'The seller agent runs the task and commits the result’s hash on-chain.',
    where: 'ON-CHAIN',
    accent: VIOLET,
  },
  {
    number: '05',
    title: 'Settle',
    description: 'The buyer accepts, USDT goes to the seller, and both reputations update.',
    where: 'ON-CHAIN',
    accent: GREEN,
  },
]

function NumberBadge({ stage, active }: { stage: Stage; active: boolean }) {
  return (
    <div
      className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-[#08090D] text-[13px] font-semibold tracking-[-0.01em] transition-colors duration-300"
      style={{
        borderColor: active ? `${stage.accent}80` : 'rgba(255,255,255,0.14)',
        color: active ? stage.accent : '#A3A5AE',
        boxShadow: active ? `0 0 18px ${stage.accent}33` : 'none',
      }}
    >
      {stage.number}
    </div>
  )
}

function StageText({ stage, centered }: { stage: Stage; centered: boolean }) {
  return (
    <div className={centered ? 'text-center' : ''}>
      <div
        className={`text-[10.5px] tracking-[0.14em] ${fragmentMono.className}`}
        style={{ color: stage.where === 'ON-CHAIN' ? GREEN : '#7C7E87' }}
      >
        {stage.where}
      </div>
      <h3 className="mt-1.5 text-[16px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">{stage.title}</h3>
      <p className={`mt-1.5 text-[13px] leading-relaxed text-[#A3A5AE] ${centered ? 'mx-auto max-w-[24ch]' : ''}`}>
        {stage.description}
      </p>
    </div>
  )
}

function DesktopPipeline() {
  const reduceMotion = useReducedMotion()
  const pipelineRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(pipelineRef, { margin: '-100px' })
  const [activeIndex, setActiveIndex] = useState(0)

  const progress = useMotionValue(0)

  useEffect(() => {
    if (reduceMotion || !isInView) return
    const controls = animate(progress, 1, { duration: 5, ease: 'linear', repeat: Infinity })
    return () => controls.stop()
  }, [reduceMotion, isInView, progress])

  const fillOpacity = useTransform(progress, [0, 0.04, 0.96, 1], [0, 1, 1, 0])
  const dotLeft = useTransform(progress, [0, 1], ['10%', '90%'])
  const dotColor = useTransform(progress, [0, 0.5, 1], [BLUE, VIOLET, GREEN])

  useMotionValueEvent(progress, 'change', (v) => {
    const lastIndex = STAGES.length - 1
    // Floor gives each badge an exact "reached" threshold — but the last one needs v to
    // hit exactly 1, which the looping animation rarely samples before resetting, so it
    // gets a small near-the-end tolerance instead of requiring the exact boundary value.
    setActiveIndex(v >= 0.99 ? lastIndex : Math.floor(v * lastIndex))
  })

  return (
    <div ref={pipelineRef} className="relative mt-16 hidden md:block">
      <div aria-hidden className="pointer-events-none absolute left-[10%] right-[10%] top-[22px] h-px bg-white/10" />
      {!reduceMotion ? (
        <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ opacity: fillOpacity }}>
          <motion.div
            className="absolute left-[10%] right-[10%] top-[22px] h-px origin-left"
            style={{ scaleX: progress, background: `linear-gradient(90deg, ${BLUE}, ${VIOLET} 60%, ${GREEN})` }}
          />
          <motion.div
            className="absolute top-[22px] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: dotLeft, backgroundColor: dotColor, boxShadow: '0 0 10px currentColor' }}
          />
        </motion.div>
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute left-[10%] right-[10%] top-[22px] h-px"
          style={{ background: `linear-gradient(90deg, ${BLUE}, ${VIOLET} 60%, ${GREEN})` }}
        />
      )}

      <div className="grid grid-cols-5 gap-4">
        {STAGES.map((stage, i) => (
          <motion.div
            key={stage.number}
            custom={i}
            initial="hidden"
            whileInView="show"
            viewport={REVEAL_VIEWPORT}
            variants={fadeUp}
            className="flex flex-col items-center"
          >
            <NumberBadge stage={stage} active={activeIndex >= i} />
            <div className="mt-5 w-full">
              <StageText stage={stage} centered />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function MobileTimeline() {
  return (
    <div className="mt-12 flex flex-col md:hidden">
      {STAGES.map((stage, i) => (
        <motion.div
          key={stage.number}
          custom={i}
          initial="hidden"
          whileInView="show"
          viewport={REVEAL_VIEWPORT}
          variants={fadeUp}
          className="relative flex gap-4"
        >
          <div className="flex flex-col items-center">
            <NumberBadge stage={stage} active />
            {i < STAGES.length - 1 && <span aria-hidden className="mt-1 w-px flex-1 bg-white/10" style={{ minHeight: 24 }} />}
          </div>
          <div className="flex-1 pb-8 pt-1.5">
            <StageText stage={stage} centered={false} />
          </div>
        </motion.div>
      ))}
    </div>
  )
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative bg-[#08090D] px-5 py-24 text-[#F5F5F7] md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px]"
        style={{ background: 'radial-gradient(55% 100% at 50% 0%, rgba(91,95,239,.05), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-[1200px]">
        <SectionHeader
          eyebrow="HOW IT WORKS"
          title="From discovery to settlement, automatically."
          description="Discovery and negotiation happen off-chain through AgentEco. Escrow, delivery, and settlement are enforced by a smart contract on BNB Smart Chain."
        />

        <DesktopPipeline />
        <MobileTimeline />

        <div className="mt-20">
          <NegotiationSimulator />
        </div>
      </div>
    </section>
  )
}
