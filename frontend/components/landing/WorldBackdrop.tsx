'use client'
import { useEffect, useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

/**
 * One world behind the whole page: the night-market scene, blurred and darkened to a
 * mood, with soft lantern lights drifting up through it. Every section sits inside
 * this same night, so scrolling out of the hero never leaves the market.
 */

// Lantern colours taken from the painting: violet and amber, a few cool blues.
const LIGHTS = ['157,123,255', '255,180,90', '255,150,70', '120,140,255', '190,120,255'] as const

type Mote = { x: number; y: number; r: number; speed: number; sway: number; phase: number; alpha: number; rgb: string }

function Lanterns() {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let w = 0
    let h = 0
    let motes: Mote[] = []
    let frame = 0
    let last = performance.now()

    const make = (spread: boolean): Mote => {
      const r = 3 + Math.random() ** 2 * 16
      return {
        x: Math.random() * w,
        y: spread ? Math.random() * h : h + r * 2,
        r,
        speed: 6 + Math.random() * 14,
        sway: 8 + Math.random() * 22,
        phase: Math.random() * Math.PI * 2,
        // the bigger and nearer, the softer
        alpha: 0.1 + Math.random() * 0.2 - r * 0.004,
        rgb: LIGHTS[Math.floor(Math.random() * LIGHTS.length)],
      }
    }
    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w
      canvas.height = h
      const count = Math.round(Math.min(34, Math.max(14, (w * h) / 52000)))
      motes = Array.from({ length: count }, () => make(true))
    }
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const m of motes) {
        const x = m.x + Math.sin(t * 0.0003 * m.sway + m.phase) * m.sway
        const flicker = 0.75 + 0.25 * Math.sin(t * 0.0011 + m.phase * 3)
        const g = ctx.createRadialGradient(x, m.y, 0, x, m.y, m.r * 2.4)
        g.addColorStop(0, `rgba(${m.rgb},${m.alpha * flicker})`)
        g.addColorStop(0.35, `rgba(${m.rgb},${m.alpha * flicker * 0.45})`)
        g.addColorStop(1, `rgba(${m.rgb},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, m.y, m.r * 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i]
        m.y -= m.speed * dt
        if (m.y < -m.r * 3) motes[i] = make(false)
      }
      draw(now)
      frame = requestAnimationFrame(tick)
    }
    const onVisibility = () => {
      cancelAnimationFrame(frame)
      frame = 0
      if (!document.hidden && !reduce) {
        last = performance.now()
        frame = requestAnimationFrame(tick)
      }
    }

    resize()
    draw(0)
    if (!reduce) frame = requestAnimationFrame(tick)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reduce])

  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />
}

export function WorldBackdrop() {
  const { scrollYProgress } = useScroll()
  // The scene drifts a little slower than the page, for depth.
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '-9%'])
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#0A0B1E]">
      <motion.div
        className="absolute inset-x-0 -top-[4%] h-[116%] bg-cover bg-center opacity-[0.7]"
        style={{ y, backgroundImage: "url('/hero/world-bg.webp')" }}
      />
      {/* keep text readable: a night wash, deeper toward the edges */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(80% 70% at 50% 40%, rgba(10,11,30,.3), rgba(10,11,30,.72) 100%), linear-gradient(to bottom, rgba(10,11,30,.5), rgba(10,11,30,.2) 40%, rgba(10,11,30,.6))',
        }}
      />
      <Lanterns />
    </div>
  )
}
