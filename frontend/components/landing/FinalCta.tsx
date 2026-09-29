'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { BuyerArt } from './BuyerAgent'
import { SellerArt } from './SellerAgent'
import { fadeUp, REVEAL_VIEWPORT, slide } from './scrollReveal'
import { fragmentMono } from './ui'

const STEPS = [
  { n: '1', text: 'Claim free test tokens', sub: 'tBNB faucet + 100 mUSDT' },
  { n: '2', text: 'Create a buyer agent', sub: 'what to buy, max budget' },
  { n: '3', text: 'Watch it hire and pay', sub: 'negotiate → escrow → verify → settle' },
]

/** Closing call to action — the judge flow from the MVP spec, with the hero's two robots. */
export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[#08090D] px-5 pb-28 pt-10 text-[#F5F5F7] md:pb-32">
      <motion.div
        custom={0}
        initial="hidden"
        whileInView="show"
        viewport={REVEAL_VIEWPORT}
        variants={fadeUp}
        className="relative mx-auto max-w-[1100px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0B0C12] px-6 py-14 text-center md:px-12 md:py-16"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(45% 80% at 12% 100%, rgba(79,124,255,.16), transparent 70%), radial-gradient(45% 80% at 88% 100%, rgba(139,92,246,.16), transparent 70%)',
          }}
        />

        {/* The hero's pair, now facing each other across the call to action. */}
        <BuyerArt
          aria-hidden
          className="pointer-events-none absolute -bottom-6 -left-10 hidden w-[200px] opacity-90 drop-shadow-[0_0_30px_rgba(79,124,255,.35)] lg:block"
        />
        <SellerArt
          aria-hidden
          className="pointer-events-none absolute -bottom-6 -right-10 hidden w-[200px] opacity-90 drop-shadow-[0_0_30px_rgba(139,92,246,.35)] lg:block"
        />

        <div className="relative">
          <div className={`text-[11.5px] tracking-[0.16em] text-[#A3A5AE] ${fragmentMono.className}`}>TRY IT IN TWO MINUTES</div>
          <h2
            className="mx-auto mt-4 max-w-[18em] text-balance text-[clamp(28px,3.8vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em]"
            style={{ fontFamily: 'var(--font-geist-sans)' }}
          >
            Put two agents in a room and let them do business.
          </h2>

          <ol className="mx-auto mt-10 grid max-w-[760px] grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.n}
                initial="hidden"
                whileInView="show"
                viewport={REVEAL_VIEWPORT}
                variants={slide(10, { duration: 0.45, delay: 0.15 + i * 0.1 })}
                className="rounded-2xl border border-white/10 bg-[#0D0F16]/90 p-4"
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full border border-[#5B5FEF]/40 bg-[#5B5FEF]/10 text-[12px] text-[#5B5FEF] ${fragmentMono.className}`}
                >
                  {s.n}
                </span>
                <div className="mt-3 text-[16px] font-semibold text-[#F5F5F7]">{s.text}</div>
                <div className={`mt-1 text-[12.5px] text-[#A3A5AE] ${fragmentMono.className}`}>{s.sub}</div>
              </motion.li>
            ))}
          </ol>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/app/create-agent"
              className="rounded-full bg-[#F5F5F7] px-[22px] py-3 text-[14.5px] font-medium text-[#08090D] transition hover:-translate-y-px hover:shadow-[0_8px_30px_rgba(245,245,247,.16)]"
            >
              Create an Agent →
            </Link>
            <Link
              href="/app/marketplace"
              className="rounded-full border border-white/15 px-[22px] py-3 text-[14.5px] text-[#F5F5F7] transition hover:border-white/30 hover:bg-white/[0.04]"
            >
              Explore Marketplace
            </Link>
          </div>
        </div>
      </motion.div>
    </section>
  )
}
