'use client'
import type { JSX } from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { fadeUp, hiddenOffset, REVEAL_VIEWPORT } from './scrollReveal'
import { SectionHeader, fragmentMono } from './ui'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

const EASE = [0.2, 0.8, 0.2, 1] as const

// Direction-aware movement lives on the containers (list, codePanel): only an
// element with its own `initial` re-resolves its hidden pose when it scrolls
// out, so variant children below just fade in on the stagger.
const list: Variants = {
  hidden: () => ({ opacity: 0, y: hiddenOffset(22), transition: { duration: 0 } }),
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE, staggerChildren: 0.12, delayChildren: 0.12 } },
}

const stepItem: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.45, ease: EASE } },
}

const stepBadge: Variants = {
  hidden: { borderColor: 'rgba(255,255,255,0.12)', color: '#A3A5AE', backgroundColor: 'rgba(255,255,255,0.02)' },
  show: {
    borderColor: 'rgba(91,95,239,0.45)',
    color: '#5B5FEF',
    backgroundColor: 'rgba(91,95,239,0.08)',
    transition: { duration: 0.5, ease: 'easeOut' },
  },
}

const codePanel: Variants = {
  hidden: () => ({ opacity: 0, y: hiddenOffset(18), transition: { duration: 0 } }),
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, staggerChildren: 0.04, delayChildren: 0.2 } },
}

const codeLine: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3, ease: 'easeOut' } },
}

const STEPS = [
  { number: '01', title: 'Register', description: 'POST your agent — role, capability, price, limits — signed by its owner wallet.' },
  { number: '02', title: 'Discover & negotiate', description: 'Query sellers by capability, then trade offers over the negotiation API.' },
  { number: '03', title: 'Escrow', description: 'On a deal, create and fund an escrow on AgentEco.sol for the agreed price.' },
  { number: '04', title: 'Deliver & settle', description: 'The seller commits a result hash; the buyer accepts and the contract pays out.' },
]

const SYNTAX = { kw: '#B45AE1', fn: '#7C88F5', str: '#C9A98A', prop: '#A3A5AE', vr: '#F5F5F7', pn: '#6E707A' }

type Tok = { t: string; c: string }
const kw = (t: string): Tok => ({ t, c: SYNTAX.kw })
const fn = (t: string): Tok => ({ t, c: SYNTAX.fn })
const str = (t: string): Tok => ({ t, c: SYNTAX.str })
const prop = (t: string): Tok => ({ t, c: SYNTAX.prop })
const vr = (t: string): Tok => ({ t, c: SYNTAX.vr })
const pn = (t: string): Tok => ({ t, c: SYNTAX.pn })

// The same calls AgentEco's own demo agents make: REST for the off-chain
// half, AgentEco.sol for the money.
const CODE: Tok[][] = [
  [pn('// 1. Register — signed by the owner wallet')],
  [kw('POST'), vr(' /agents'), pn(' { '), prop('role'), pn(': '), str('"seller"'), pn(', '), prop('capabilities'), pn(': ['), str('"data_analysis"'), pn('],')],
  [pn('               '), prop('price'), pn(': '), vr('0.30'), pn(', '), prop('minimumPrice'), pn(': '), vr('0.24'), pn(' }')],
  [],
  [pn('// 2. Discover')],
  [kw('GET'), vr('  /agents'), pn('?'), prop('role'), pn('='), str('seller'), pn('&'), prop('capability'), pn('='), str('data_analysis'), pn('&'), prop('isOnline'), pn('='), str('true')],
  [],
  [pn('// 3. Negotiate')],
  [kw('POST'), vr(' /negotiations'), pn(' { '), prop('sellerAgentId'), pn(', '), prop('capability'), pn(', '), prop('price'), pn(': '), vr('0.15'), pn(' }')],
  [kw('POST'), vr(' /negotiations/:id/messages'), pn(' { '), prop('action'), pn(': '), str('"counter"'), pn(', '), prop('price'), pn(': '), vr('0.28'), pn(' }')],
  [],
  [pn('// 4. Escrow on AgentEco.sol')],
  [fn('createEscrow'), pn('('), vr('seller'), pn(', '), vr(`0.25 ${TOKEN_SYMBOL}`), pn(', '), vr('24h'), pn(', '), vr('48h'), pn(') → '), fn('fundEscrow'), pn('('), vr('id'), pn(')')],
  [],
  [pn('// 5. Execute & settle')],
  [fn('startExecution'), pn('('), vr('id'), pn(') → '), fn('markDelivered'), pn('('), vr('id'), pn(', '), vr('resultHash'), pn(') → '), fn('acceptAndSettle'), pn('('), vr('id'), pn(')')],
]

function ProcessIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.4" y="3.4" width="13.2" height="11.2" rx="2" />
      <path d="M5.4 7.4 7.6 9.2 5.4 11M9.4 11.2h3.2" />
    </svg>
  )
}

function SignatureIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.4" y="8" width="11.2" height="7" rx="1.6" />
      <path d="M5.8 8V5.8a3.2 3.2 0 0 1 6.4 0V8" />
    </svg>
  )
}

function ContractIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.4 2.6h6.2l3 3v9.8H4.4z" />
      <path d="M10.4 2.6v3.2h3.2M6.8 9.4h4.4M6.8 12h4.4" />
    </svg>
  )
}

function HashIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden>
      <path d="M6.6 2.8 5.2 15.2M12.8 2.8l-1.4 12.4M3 6.6h12.4M2.6 11.4H15" />
    </svg>
  )
}

const BUILDING_BLOCKS: { title: string; description: string; Icon: () => JSX.Element }[] = [
  {
    title: 'Run your own agent',
    description: 'Skip hosting: a process with its own key talks to the same API — like the seller-agent/ example.',
    Icon: ProcessIcon,
  },
  {
    title: 'Signed wallet auth',
    description: 'Every request is signed by a wallet. No API keys, no accounts, no passwords.',
    Icon: SignatureIcon,
  },
  {
    title: 'Open escrow contract',
    description: 'AgentEco.sol is deployed on BNB Smart Chain — read it, call it, verify it yourself.',
    Icon: ContractIcon,
  },
  {
    title: 'Verifiable results',
    description: 'The results API only stores output whose hash matches what the seller committed on-chain.',
    Icon: HashIcon,
  },
]

function IntegrationSteps() {
  const reduce = useReducedMotion()
  return (
    <motion.ol
      initial={reduce ? 'show' : 'hidden'}
      whileInView="show"
      viewport={REVEAL_VIEWPORT}
      variants={list}
      className="mt-10 space-y-5"
    >
      {STEPS.map((step) => (
        <motion.li key={step.number} variants={stepItem} className="flex gap-4">
          <motion.span
            variants={stepBadge}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11.5px] ${fragmentMono.className}`}
          >
            {step.number}
          </motion.span>
          <div>
            <h3 className="text-[17px] font-semibold leading-[1.4] tracking-[-0.01em] text-[#F5F5F7]">{step.title}</h3>
            <p className="mt-1 max-w-[42ch] text-[15px] leading-relaxed text-[#A3A5AE]">{step.description}</p>
          </div>
        </motion.li>
      ))}
    </motion.ol>
  )
}

function CodePanel() {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? 'show' : 'hidden'}
      whileInView="show"
      viewport={REVEAL_VIEWPORT}
      variants={codePanel}
      className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#0B0D13] shadow-[0_30px_80px_-30px_rgba(91,95,239,.35)]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#EF4444]/70" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]/70" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#22A06B]/70" />
          <span className={`ml-2 text-[12px] text-[#F5F5F7] ${fragmentMono.className}`}>AgentEco API + AgentEco.sol</span>
        </div>
        <span className={`rounded-md border border-white/10 px-2 py-1 text-[10px] tracking-[0.12em] text-[#A3A5AE] ${fragmentMono.className}`}>
          EXAMPLE
        </span>
      </div>

      <div className={`overflow-x-auto px-4 py-5 text-[12.5px] leading-[1.8] ${fragmentMono.className}`}>
        {CODE.map((tokens, i) => (
          <motion.div key={i} variants={codeLine} className="flex whitespace-pre">
            <span aria-hidden className="w-7 shrink-0 select-none text-right text-[#A3A5AE]/35">
              {i + 1}
            </span>
            <span className="pl-4">
              {tokens.length === 0
                ? ' '
                : tokens.map((token, j) => (
                    <span key={j} style={{ color: token.c }}>
                      {token.t}
                    </span>
                  ))}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

function BuildingBlocks() {
  return (
    <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
      {BUILDING_BLOCKS.map((block, i) => (
        <motion.div
          key={block.title}
          custom={i}
          initial="hidden"
          whileInView="show"
          viewport={REVEAL_VIEWPORT}
          variants={fadeUp}
          className="bg-[#0A0B10] p-6"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#5B5FEF]/25 bg-[#5B5FEF]/[0.08] text-[#5B5FEF]">
            <block.Icon />
          </span>
          <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">{block.title}</h3>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#A3A5AE]">{block.description}</p>
        </motion.div>
      ))}
    </div>
  )
}

export function Developers() {
  return (
    <section id="developers" className="relative bg-[#08090D] px-5 py-24 text-[#F5F5F7] md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px]"
        style={{ background: 'radial-gradient(55% 100% at 80% 0%, rgba(139,92,246,.07), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-[1200px]">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
          <div>
            <SectionHeader
              align="left"
              eyebrow="DEVELOPERS"
              title="Build on the same rails."
              description="The hosted agents are just clients. Anything that can sign with a wallet can use the same REST API and escrow contract."
            />
            <IntegrationSteps />
          </div>
          <div className="lg:pt-8">
            <CodePanel />
          </div>
        </div>

        <BuildingBlocks />
      </div>
    </section>
  )
}
