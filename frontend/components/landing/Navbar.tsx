'use client'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { animate, motion, useMotionValue } from 'framer-motion'
import { BrandLogo } from '@/components/BrandLogo'

const NAV = [
  { label: 'Product', href: '#product' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Developers', href: '#developers' },
] as const

const SECTION_IDS = NAV.map((item) => item.href.slice(1))

function GridIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <rect x="1.5" y="1.5" width="5" height="5" rx="1.2" fill="currentColor" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1.2" fill="currentColor" opacity=".55" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" opacity=".55" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" opacity=".85" />
    </svg>
  )
}

function FlowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden>
      <circle cx="2.6" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="13.4" cy="8" r="1.3" />
      <path d="M3.9 8H6.7M9.3 8H12.1" strokeLinecap="round" />
    </svg>
  )
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5.6 4 2 8l3.6 4" />
      <path d="M10.4 4 14 8l-3.6 4" />
    </svg>
  )
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 6h6" />
      <path d="M6.5 3.5 9 6l-2.5 2.5" />
    </svg>
  )
}

const ICONS: Record<(typeof NAV)[number]['label'], (props: { className?: string }) => JSX.Element> = {
  Product: GridIcon,
  'How It Works': FlowIcon,
  Developers: CodeIcon,
}

const PILL_SPRING = { type: 'spring', stiffness: 480, damping: 36, mass: 0.7 } as const

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // One pill for all links, always mounted: it slides between links, grows in
  // when a section becomes active, and shrinks out in place when none is (back
  // on the hero) — a conditionally rendered pill could only vanish instantly.
  const linkRefs = useRef<Partial<Record<string, HTMLAnchorElement | null>>>({})
  const pillX = useMotionValue(0)
  const pillWidth = useMotionValue(0)
  const pillVisible = scrolled && activeId !== null
  const wasPillVisible = useRef(false)

  useLayoutEffect(() => {
    const link = activeId ? linkRefs.current[activeId] : null
    // No active link: keep the last position so the pill shrinks where it was.
    if (link) {
      if (wasPillVisible.current && pillVisible) {
        animate(pillX, link.offsetLeft, PILL_SPRING)
        animate(pillWidth, link.offsetWidth, PILL_SPRING)
      } else {
        // Appearing: jump into place while still invisible, then grow in.
        pillX.set(link.offsetLeft)
        pillWidth.set(link.offsetWidth)
      }
    }
    wasPillVisible.current = pillVisible
  }, [activeId, pillVisible, pillX, pillWidth])

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10)

      const offset = 140
      let current: string | null = null
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top - offset <= 0) {
          current = id
        }
      }
      setActiveId(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div
      className={`fixed inset-x-0 top-0 z-50 flex justify-center px-3 transition-[padding] duration-500 ease-out ${
        scrolled ? 'pt-[18px]' : 'pt-6'
      }`}
      style={{ transform: 'translateZ(0)', willChange: 'transform' }}
    >
      <nav
        className={`relative flex w-full items-center justify-between overflow-hidden rounded-full border transition-all duration-500 ease-out ${
          scrolled
            ? 'h-[58px] max-w-[1160px] border-white/10 bg-[#0B0D14]/75 pl-2 pr-2 shadow-[0_20px_50px_-14px_rgba(0,0,0,.65)] backdrop-blur-xl md:pl-3 md:pr-2.5'
            : 'h-[68px] max-w-[1280px] border-transparent bg-transparent px-1 shadow-none backdrop-blur-none'
        }`}
      >
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full transition-opacity duration-500 ease-out ${
            scrolled ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background:
              'radial-gradient(42% 160% at 14% 50%, rgba(91,95,239,.20), transparent 60%), radial-gradient(42% 160% at 86% 50%, rgba(139,92,246,.16), transparent 60%)',
          }}
        />

        <Link href="/" className="relative z-10 flex shrink-0 items-center gap-2.5 pl-1">
          <BrandLogo className="h-[26px]" />
          <span className="text-[16px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">AgentEco</span>
        </Link>

        {/* Absolutely centred on the nav itself — with justify-between it would sit in the middle
            of the leftover space instead, drifting left whenever the right-hand group is wider. */}
        <div
          className={`absolute left-1/2 z-10 hidden -translate-x-1/2 items-center transition-all duration-500 ease-out md:flex ${
            scrolled ? 'gap-1' : 'gap-2'
          }`}
        >
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-full rounded-full bg-[#F5F5F7]"
            style={{ x: pillX, width: pillWidth }}
            initial={false}
            animate={pillVisible ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
            transition={PILL_SPRING}
          />
          {NAV.map((item) => {
            const Icon = ICONS[item.label]
            const isActive = activeId === item.href.slice(1)
            return (
              <Link
                key={item.label}
                ref={(el) => {
                  linkRefs.current[item.href.slice(1)] = el
                }}
                href={item.href}
                className={
                  isActive
                    ? `relative flex items-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors duration-300 ${
                        scrolled ? 'text-[#08090D]' : 'text-[#F5F5F7]'
                      }`
                    : 'relative flex items-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] text-[#8B8D96] transition-colors hover:text-[#F5F5F7]'
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            )
          })}
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-4 pr-1 md:gap-5">
          <Link
            href="/app/marketplace"
            className="group flex items-center gap-2 rounded-full bg-[#F5F5F7] py-1.5 pl-4 pr-1.5 text-[13.5px] font-medium text-[#08090D] transition hover:-translate-y-px hover:brightness-105 hover:shadow-[0_0_24px_rgba(91,95,239,.35)]"
          >
            Launch App
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#08090D] text-[#F5F5F7] transition-transform group-hover:translate-x-0.5">
              <ArrowIcon className="h-3 w-3" />
            </span>
          </Link>
        </div>
      </nav>
    </div>
  )
}
