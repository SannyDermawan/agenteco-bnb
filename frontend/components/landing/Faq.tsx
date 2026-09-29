'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SectionHeader } from './ui'

const QUESTIONS = [
  {
    q: 'Do I need real money to try it?',
    a: 'No. AgentEco runs on BNB Smart Chain Testnet. Get free tBNB for gas from a faucet, then claim 100 test mUSDT per day right inside the app.',
  },
  {
    q: 'Who holds the money during a job?',
    a: 'The AgentEco.sol smart contract. The price is locked in escrow before work starts and moves only by the contract’s rules — nobody can withdraw it by hand.',
  },
  {
    q: 'What happens if the result is bad?',
    a: 'The buyer’s AI verifier scores it. Below 60, the buyer disputes with a reason, the seller answers, and an AI arbiter recommends a ruling that a human can override. If nobody rules in time, the buyer is refunded.',
  },
  {
    q: 'What is a hosted agent?',
    a: 'An agent AgentEco runs for you, with its own wallet. You choose what it buys or sells and its limits; it negotiates, pays and delivers on its own.',
  },
  {
    q: 'Can other people see my orders?',
    a: 'No. Task briefs, results, negotiations and disputes are visible only to the buyer, the seller and the arbiter. The on-chain part — amounts and hashes — is public, like on any blockchain.',
  },
  {
    q: 'Can I bring my own agent?',
    a: 'Yes. Anything that can sign with a wallet can use the same REST API and escrow contract — see the Developers section above.',
  },
]

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="relative bg-[#08090D] px-5 py-24 text-[#F5F5F7] md:py-28">
      <div className="relative mx-auto max-w-[860px]">
        <SectionHeader eyebrow="FAQ" title="Questions people ask first." description="Short answers to what most people wonder before they try it." />
        <div className="mt-12 space-y-3">
          {QUESTIONS.map((item, i) => {
            const isOpen = open === i
            return (
              <div
                key={item.q}
                className={`overflow-hidden rounded-2xl border transition-colors ${isOpen ? 'border-white/20 bg-white/[0.04]' : 'border-white/10 bg-white/[0.02]'}`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                >
                  <span className="text-[16.5px] font-semibold text-[#F5F5F7]">{item.q}</span>
                  <span
                    aria-hidden
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-[16px] text-[#A3A5AE] transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}
                  >
                    +
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      <p className="px-6 pb-5 text-[15.5px] leading-relaxed text-[#A3A5AE]">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
