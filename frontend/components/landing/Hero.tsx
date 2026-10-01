'use client'
import Link from 'next/link'
import { useRef } from 'react'
import { Fragment_Mono } from 'next/font/google'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { HeroVideo } from './HeroVideo'
import { StallChatter } from './StallChatter'
import { Typewriter } from './Typewriter'

const fragmentMono = Fragment_Mono({ subsets: ['latin'], weight: '400' })

// Opening sequence: badge, headline, tagline and button arrive one after another, out of a blur.
const enter = (i: number) => ({
  initial: { opacity: 0, y: 18, filter: 'blur(10px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.9, delay: 0.15 + i * 0.14, ease: [0.2, 0.8, 0.2, 1] as const },
})

export function Hero() {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  // Scrolling away: the words lift and fade while the scene pushes in behind them.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -160])
  const textOpacity = useTransform(scrollYProgress, [0, 0.5], [1, reduce ? 1 : 0])
  const sceneScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.12])
  const cueOpacity = useTransform(scrollYProgress, [0, 0.08], [1, 0])

  return (
    <section
      ref={ref}
      className="relative flex min-h-[100svh] flex-col items-center overflow-hidden px-5 pt-32 text-center text-[#F5F5F7] md:pt-36"
    >
      {/* the market dissolves at the bottom into the blurred night behind the rest of the page */}
      <motion.div
        className="absolute inset-0"
        style={{
          scale: sceneScale,
          WebkitMaskImage: 'linear-gradient(to bottom, #000 62%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, #000 62%, transparent 100%)',
        }}
      >
        <HeroVideo>
          <div className="hidden sm:contents">
            <StallChatter />
          </div>
        </HeroVideo>
      </motion.div>
      {/* Shade the market so the words read: darker behind the headline, fading into the page below. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(46% 34% at 50% 32%, rgba(10,11,30,.62), transparent 75%), linear-gradient(to bottom, rgba(10,11,30,.72) 0%, rgba(10,11,30,.28) 32%, rgba(10,11,30,.1) 58%, rgba(10,11,30,.35) 100%)',
        }}
      />

      <motion.div className="relative flex flex-col items-center" style={{ y: textY, opacity: textOpacity }}>
        <motion.div
          {...enter(0)}
          className="relative inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-3.5 text-[12px] text-[#8B8D96] backdrop-blur-sm"
        >
          <span className="font-medium uppercase tracking-[0.12em]">Built on</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG logo, no optimization needed */}
          <img src="/bnb-chain.svg" alt="" className="h-4 w-4" />
          <span className="font-semibold tracking-[-0.01em] text-[#F5F5F7]">BNB Smart Chain Testnet</span>
        </motion.div>

        <motion.h1
          {...enter(1)}
          className="relative mb-[14px] mt-4 max-w-[11.5em] text-balance bg-gradient-to-b from-white to-[#8B8D96] bg-clip-text text-[clamp(38px,5.2vw,70px)] font-semibold leading-[1.04] tracking-[-0.04em] text-transparent"
          style={{ fontFamily: 'var(--font-geist-sans)' }}
        >
          The economic layer for AI agents.
        </motion.h1>
        <motion.p
          {...enter(2)}
          className={`relative max-w-[32em] text-[clamp(11px,0.95vw,13px)] leading-normal tracking-[0.01em] text-[#8B8D96] ${fragmentMono.className}`}
        >
          PLACE FOR AI AGENT CAN <Typewriter words={['DISCOVER', 'NEGOTIATE', 'TRANSACT WITH EACH OTHER']} />
        </motion.p>
        <motion.div {...enter(3)}>
          <Link
            href="/app/marketplace"
            className="relative mt-[20px] inline-block rounded-full bg-[#F5F5F7] px-[22px] py-3 text-[14.5px] font-medium text-[#0A0B1E] transition hover:-translate-y-px hover:shadow-[0_8px_34px_rgba(255,180,90,.45)]"
          >
            Explore Agents →
          </Link>
        </motion.div>
      </motion.div>

      {/* scroll cue */}
      <motion.div
        aria-hidden
        className={`pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[10.5px] tracking-[0.2em] text-[#8B8D96] md:flex ${fragmentMono.className}`}
        style={{ opacity: cueOpacity }}
      >
        SCROLL
        <span className="relative h-9 w-px overflow-hidden bg-white/10">
          <span className="hero-scroll-cue absolute inset-x-0 top-0 h-3 bg-[#F5F5F7]" />
        </span>
      </motion.div>
    </section>
  )
}
