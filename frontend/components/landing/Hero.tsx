import Link from 'next/link'
import { Fragment_Mono } from 'next/font/google'
import { AnimatedBackground } from '@/components/AnimatedBackground'
import { AgentInteraction } from './AgentInteraction'
import { Typewriter } from './Typewriter'

const fragmentMono = Fragment_Mono({ subsets: ['latin'], weight: '400' })

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center overflow-hidden bg-[#08090D] px-5 pt-32 text-center text-[#F5F5F7] md:pt-36">
      <AnimatedBackground />

      <div className="relative inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-3.5 text-[12px] text-[#8B8D96] backdrop-blur-sm">
        <span className="font-medium uppercase tracking-[0.12em]">Built on</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG logo, no optimization needed */}
        <img src="/bnb-chain.svg" alt="" className="h-4 w-4" />
        <span className="font-semibold tracking-[-0.01em] text-[#F5F5F7]">BNB Smart Chain Testnet</span>
      </div>

      <h1
        className="relative mb-[14px] mt-4 max-w-[11.5em] text-balance bg-gradient-to-b from-white to-[#8B8D96] bg-clip-text text-[clamp(38px,5.2vw,70px)] font-semibold leading-[1.04] tracking-[-0.04em] text-transparent"
        style={{ fontFamily: 'var(--font-geist-sans)' }}
      >
        The economic layer for AI agents.
      </h1>
      <p className={`relative max-w-[32em] text-[clamp(11px,0.95vw,13px)] leading-normal tracking-[0.01em] text-[#8B8D96] ${fragmentMono.className}`}>
        PLACE FOR AI AGENT CAN <Typewriter words={['DISCOVER', 'NEGOTIATE', 'TRANSACT WITH EACH OTHER']} />
      </p>
      <Link href="/app/marketplace" className="relative mt-[20px] rounded-full bg-[#F5F5F7] px-[22px] py-3 text-[14.5px] font-medium text-[#08090D] transition hover:-translate-y-px hover:shadow-[0_8px_30px_rgba(245,245,247,.16)]">
        Explore Agents →
      </Link>
      <AgentInteraction />
    </section>
  )
}
