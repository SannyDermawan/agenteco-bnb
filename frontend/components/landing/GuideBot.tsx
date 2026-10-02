'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion'
import { GuideBotArt } from './GuideBotArt'

/**
 * Eco, the landing page's guide: the blue AgentEco robot floats along as you scroll, flies to a
 * new corner at every section and says a line about it. It looks at your cursor, reacts when you
 * click it, can be picked up and thrown around, falls asleep if left alone, and can be sent away
 * with the × (the choice is remembered). Landing page only.
 */

type Mood = 'idle' | 'happy' | 'surprised' | 'wink' | 'love' | 'dizzy' | 'sleep' | 'lifted'
type Side = 'left' | 'right'

const STORAGE_KEY = 'agenteco-guide'

const GUIDE: Record<string, { side: Side; line: string }> = {
  hero: { side: 'left', line: "Hi, I'm Eco! I'll show you around. Scroll down — I'll tag along!" },
  product: { side: 'right', line: 'This is where AI agents get hired. You only pay when the work is right!' },
  capabilities: { side: 'left', line: "So many jobs to pick from — translate, analyze, explain… which one's yours?" },
  roles: { side: 'right', line: "Buyer or seller? I'd be a buyer. I love a bargain!" },
  'how-it-works': { side: 'left', line: "They haggle, lock the money, then check the work. Try the sliders — it's fun!" },
  proof: { side: 'right', line: 'Real deals on a real chain. No fibbing here!' },
  developers: { side: 'left', line: "Want to build your own agent? The SDK makes it easy. You've got this!" },
  faq: { side: 'right', line: 'Got a question? Somebody here has an answer. Maybe me!' },
  cta: { side: 'left', line: "Ready? Let's go!" },
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function readHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}
function saveHidden(off: boolean) {
  try {
    if (off) localStorage.setItem(STORAGE_KEY, 'off')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

type Dim = { vw: number; vh: number; w: number; h: number }
function measure(): Dim {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = vw < 640 ? 88 : 120
  return { vw, vh, w, h: Math.round((w * 560) / 640) }
}

// ---------------------------------------------------------------- the face

const EYE_GLOW = 'drop-shadow(0 0 6px rgba(79,124,255,.95))'
const PINK = '#FF8FB5'
const ARC = '#9DB0FF'
const MOUTH = '#7182D7'
const HEART = 'M0 15 C-16 3 -20 -9 -12 -16 C-6 -21 0 -18 0 -12 C0 -18 6 -21 12 -16 C20 -9 16 3 0 15 Z'
const SPIRAL = 'M0 0 a3 3 0 0 1 6 0 a7 7 0 0 1 -14 0 a11 11 0 0 1 22 0 a15 15 0 0 1 -30 0'
const SPIN = { animate: { rotate: 360 }, transition: { duration: 0.9, repeat: Infinity, ease: 'linear' as const } }
const SPIN_STYLE = { transformBox: 'fill-box' as const, transformOrigin: 'center' }

function Eyes({ mood, blink }: { mood: Mood; blink: boolean }) {
  switch (mood) {
    case 'love':
      return (
        <>
          <path d={HEART} transform="translate(378 247)" fill={PINK} />
          <path d={HEART} transform="translate(426 243)" fill={PINK} />
        </>
      )
    case 'happy':
      return (
        <>
          <path d="M363 255 Q378 228 393 255" stroke={ARC} strokeWidth="9" strokeLinecap="round" />
          <path d="M411 251 Q426 224 441 251" stroke={ARC} strokeWidth="9" strokeLinecap="round" />
        </>
      )
    case 'wink':
      return (
        <>
          <rect x="365" y="224" width="25" height="47" rx="13" fill="url(#guide-guide-accent)" transform="rotate(-5 352 255)" />
          <ellipse cx="380" cy="243" rx="5" ry="8" fill="#FFFFFF" opacity="0.78" />
          <path d="M411 251 Q426 224 441 251" stroke={ARC} strokeWidth="9" strokeLinecap="round" />
        </>
      )
    case 'surprised':
    case 'lifted': {
      const rx = mood === 'surprised' ? 16 : 14
      const ry = mood === 'surprised' ? 28 : 24
      return (
        <>
          <ellipse cx="378" cy="247" rx={rx} ry={ry} fill="url(#guide-guide-accent)" />
          <ellipse cx="383" cy="236" rx="5" ry="8" fill="#FFFFFF" opacity="0.85" />
          <ellipse cx="426" cy="243" rx={rx} ry={ry} fill="url(#guide-guide-accent)" />
          <ellipse cx="431" cy="232" rx="5" ry="8" fill="#FFFFFF" opacity="0.85" />
        </>
      )
    }
    case 'dizzy':
      return (
        <>
          <g transform="translate(378 247)">
            <motion.path d={SPIRAL} stroke={ARC} strokeWidth="4" strokeLinecap="round" {...SPIN} style={SPIN_STYLE} />
          </g>
          <g transform="translate(426 243)">
            <motion.path d={SPIRAL} stroke={ARC} strokeWidth="4" strokeLinecap="round" {...SPIN} style={SPIN_STYLE} />
          </g>
        </>
      )
    case 'sleep':
      return (
        <>
          <path d="M364 248 Q378 261 392 248" stroke={ARC} strokeWidth="7" strokeLinecap="round" />
          <path d="M412 244 Q426 257 440 244" stroke={ARC} strokeWidth="7" strokeLinecap="round" />
        </>
      )
    default:
      return (
        <g style={{ transformBox: 'fill-box', transformOrigin: 'center', transform: blink ? 'scaleY(0.1)' : 'scaleY(1)', transition: 'transform 90ms' }}>
          <rect x="365" y="224" width="25" height="47" rx="13" fill="url(#guide-guide-accent)" transform="rotate(-5 352 255)" />
          <ellipse cx="380" cy="243" rx="5" ry="8" fill="#FFFFFF" opacity="0.78" />
          <rect x="414" y="222" width="22" height="42" rx="13.5" fill="url(#guide-guide-accent)" transform="rotate(-4 410 247)" />
          <ellipse cx="427" cy="238" rx="5" ry="8" fill="#FFFFFF" opacity="0.84" />
        </g>
      )
  }
}

function Mouth({ mood }: { mood: Mood }) {
  switch (mood) {
    case 'happy':
      return <path d="M386 298 Q405 328 424 298 Z" fill="#1B2447" stroke={MOUTH} strokeWidth="4" strokeLinejoin="round" />
    case 'love':
      return <path d="M390 301 Q405 320 420 301" stroke={MOUTH} strokeWidth="4" strokeLinecap="round" />
    case 'wink':
      return <path d="M388 305 Q406 318 425 299" stroke={MOUTH} strokeWidth="4" strokeLinecap="round" />
    case 'surprised':
      return <ellipse cx="405" cy="314" rx="7" ry="9" fill="#1B2447" stroke={MOUTH} strokeWidth="4" />
    case 'lifted':
      return <ellipse cx="405" cy="312" rx="5" ry="7" fill="#1B2447" stroke={MOUTH} strokeWidth="4" />
    case 'dizzy':
      return <path d="M386 307 q5 -7 10 0 t10 0 t10 0" stroke={MOUTH} strokeWidth="4" strokeLinecap="round" />
    case 'sleep':
      return <path d="M398 308 Q405 313 412 308" stroke={MOUTH} strokeWidth="3" strokeLinecap="round" />
    default:
      return (
        <>
          <path d="M388 302 C397 309 411 311 422 304" stroke={MOUTH} strokeWidth="4" strokeLinecap="round" />
          <path d="M396 305 C403 308 410 308 416 305" stroke="#AAB5EE" strokeWidth="1.5" opacity="0.62" />
        </>
      )
  }
}

function Face({ mood, blink, lookX, lookY }: { mood: Mood; blink: boolean; lookX: MotionValue<number>; lookY: MotionValue<number> }) {
  return (
    <>
      <motion.g style={{ x: lookX, y: lookY, filter: EYE_GLOW }}>
        <Eyes mood={mood} blink={blink} />
      </motion.g>
      <g>
        <Mouth mood={mood} />
      </g>
    </>
  )
}

// ---------------------------------------------------------------- bits that float off the head

type Spark = { id: number; glyph: string; color: string; dx: number }

function SparkView({ spark, onDone }: { spark: Spark; onDone: (id: number) => void }) {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[8%] text-[18px] font-bold leading-none"
      style={{ color: spark.color, marginLeft: spark.dx, textShadow: '0 0 10px currentColor' }}
      initial={{ opacity: 0, y: 0, scale: 0.5 }}
      animate={{ opacity: [0, 1, 1, 0], y: -52, scale: [0.5, 1.15, 1, 0.9] }}
      transition={{ duration: 1.5, ease: 'easeOut' }}
      onAnimationComplete={() => onDone(spark.id)}
    >
      {spark.glyph}
    </motion.span>
  )
}

// ---------------------------------------------------------------- the guide

const REACTIONS = ['happy', 'surprised', 'wink', 'love', 'spin'] as const

type Touch = {
  id: number
  sx: number
  sy: number
  bx: number
  by: number
  moved: boolean
  held: boolean
  holdTimer?: ReturnType<typeof setTimeout>
  trail: { x: number; y: number; t: number }[]
}

export function GuideBot() {
  const reduce = useReducedMotion()
  const [hidden, setHidden] = useState(readHidden)
  const [dim, setDim] = useState(measure)
  const dimRef = useRef(dim)
  const [mood, setMoodState] = useState<Mood>('idle')
  const moodRef = useRef<Mood>('idle')
  const [blink, setBlink] = useState(false)
  const [bubble, setBubble] = useState<{ text: string; key: number; below: boolean; right: boolean } | null>(null)
  const [sparks, setSparks] = useState<Spark[]>([])
  const [dragging, setDragging] = useState(false)

  // Where the bot is (top-left of its box, in viewport pixels) and how its body moves.
  const posX = useMotionValue(-400)
  const posY = useMotionValue(0)
  const bobY = useMotionValue(0)
  const bodyY = useMotionValue(0)
  const bodyRot = useMotionValue(0)
  const scaleX = useSpring(1, { stiffness: 260, damping: 12 })
  const scaleY = useSpring(1, { stiffness: 260, damping: 12 })
  // Looks, leans and drifts toward the cursor.
  const lookX = useSpring(0, { stiffness: 120, damping: 18 })
  const lookY = useSpring(0, { stiffness: 120, damping: 18 })
  const lean = useSpring(0, { stiffness: 70, damping: 16 })
  const pullX = useSpring(0, { stiffness: 30, damping: 14 })
  const pullY = useSpring(0, { stiffness: 30, damping: 14 })
  // Tilts with its own speed: forward when it flies, back when it brakes.
  const velX = useVelocity(posX)
  const tiltRaw = useTransform(velX, (v) => clamp(v / 70, -22, 22))
  const tilt = useSpring(tiltRaw, { stiffness: 120, damping: 14 })
  const rotate = useTransform([lean, bodyRot, tilt], ([a, b, c]) => (a as number) + (b as number) + (c as number))

  const flyX = useRef<AnimationPlaybackControls | null>(null)
  const flyY = useRef<AnimationPlaybackControls | null>(null)
  const moodTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const homeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sleepTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sparkId = useRef(0)
  const bubbleId = useRef(0)
  const home = useRef<Side>('left')
  const sectionKey = useRef('hero')
  const seen = useRef(new Set<string>())
  const clicks = useRef<number[]>([])
  const reactions = useRef(0)
  const touch = useRef<Touch | null>(null)

  const setMood = useCallback((m: Mood, ms?: number) => {
    clearTimeout(moodTimer.current)
    moodRef.current = m
    setMoodState(m)
    if (ms) {
      moodTimer.current = setTimeout(() => {
        moodRef.current = 'idle'
        setMoodState('idle')
      }, ms)
    }
  }, [])

  const say = useCallback(
    (text: string, ms = 3200) => {
      clearTimeout(bubbleTimer.current)
      const d = dimRef.current
      bubbleId.current += 1
      setBubble({ text, key: bubbleId.current, below: posY.get() < 150, right: posX.get() + d.w / 2 > d.vw / 2 })
      bubbleTimer.current = setTimeout(() => setBubble(null), ms)
    },
    [posX, posY]
  )

  const burst = useCallback((glyph: string, color: string, count = 3) => {
    const made = Array.from({ length: count }, (_, i) => ({
      id: (sparkId.current += 1),
      glyph,
      color,
      dx: (i - (count - 1) / 2) * 26 + (Math.random() * 10 - 5),
    }))
    setSparks((s) => [...s, ...made])
  }, [])
  const dropSpark = useCallback((id: number) => setSparks((s) => s.filter((x) => x.id !== id)), [])

  const fx = useCallback(
    (kind: 'hop' | 'jump' | 'tilt' | 'spin' | 'wobble') => {
      if (reduce) return
      switch (kind) {
        case 'hop':
          animate(bodyY, [0, -20, 0, -9, 0], { duration: 0.7, ease: 'easeOut' })
          break
        case 'jump':
          animate(bodyY, [0, -30, 0], { duration: 0.55, ease: 'easeOut' })
          scaleX.set(1.12)
          scaleY.set(1.12)
          setTimeout(() => {
            scaleX.set(1)
            scaleY.set(1)
          }, 260)
          break
        case 'tilt':
          animate(bodyRot, [0, -13, 11, 0], { duration: 0.7, ease: 'easeInOut' })
          break
        case 'spin':
          animate(bodyRot, [0, 360], { duration: 0.85, ease: [0.3, 0, 0.2, 1] }).then(() => bodyRot.set(0))
          animate(bodyY, [0, -16, 0], { duration: 0.85, ease: 'easeOut' })
          break
        case 'wobble':
          animate(bodyRot, [0, -10, 10, -8, 8, -5, 5, 0], { duration: 1.8 })
          break
      }
    },
    [reduce, bodyY, bodyRot, scaleX, scaleY]
  )

  // ---- moving around

  const bounds = useCallback(() => {
    const d = dimRef.current
    return { minX: 0, maxX: d.vw - d.w, minY: 72, maxY: d.vh - d.h }
  }, [])

  const anchor = useCallback((side: Side) => {
    const { vw, vh, w, h } = dimRef.current
    return { x: side === 'left' ? 6 : vw - w - (vw < 640 ? 76 : 96), y: vh - h }
  }, [])

  const flyTo = useCallback(
    (x: number, y: number) => {
      flyX.current?.stop()
      flyY.current?.stop()
      if (reduce) {
        posX.set(x)
        posY.set(y)
        return
      }
      flyX.current = animate(posX, x, { type: 'spring', stiffness: 34, damping: 12, mass: 1.1 })
      flyY.current = animate(posY, y, { type: 'spring', stiffness: 48, damping: 11, mass: 1 })
    },
    [reduce, posX, posY]
  )

  const goHome = useCallback(() => {
    const a = anchor(home.current)
    flyTo(a.x, a.y)
  }, [anchor, flyTo])

  const scheduleHome = useCallback(
    (ms: number) => {
      clearTimeout(homeTimer.current)
      homeTimer.current = setTimeout(goHome, ms)
    },
    [goHome]
  )

  // ---- sleeping

  const bump = useCallback(() => {
    clearTimeout(sleepTimer.current)
    sleepTimer.current = setTimeout(() => {
      if (moodRef.current === 'idle') {
        setMood('sleep')
        setBubble(null)
      }
    }, 20000)
  }, [setMood])

  const wake = useCallback(
    (line?: string) => {
      if (moodRef.current !== 'sleep') return
      setMood('surprised', 1400)
      fx('jump')
      burst('!', '#FFD27A', 1)
      if (line) say(line, 2800)
    },
    [setMood, fx, burst, say]
  )

  // ---- reacting

  const dizzy = useCallback(() => {
    setMood('dizzy', 2800)
    fx('wobble')
    burst('★', '#FFD27A', 3)
    say('Okay, okay… I’m dizzy! x_x', 2600)
  }, [setMood, fx, burst, say])

  const react = useCallback(() => {
    bump()
    const now = Date.now()
    clicks.current = clicks.current.filter((t) => now - t < 1500)
    clicks.current.push(now)
    if (moodRef.current === 'sleep') return wake('Oh! I wasn’t sleeping… much.')
    if (clicks.current.length >= 5) {
      clicks.current = []
      return dizzy()
    }
    const n = reactions.current++
    if (n % 6 === 5) {
      setMood('happy', 1800)
      fx('hop')
      return say(`Need a reminder? ${GUIDE[sectionKey.current]?.line ?? ''}`, 4200)
    }
    switch (REACTIONS[n % REACTIONS.length]) {
      case 'happy':
        setMood('happy', 1800)
        fx('hop')
        burst('✦', '#FFD27A', 2)
        return say('Hehe, that tickles!', 2200)
      case 'surprised':
        setMood('surprised', 1400)
        fx('jump')
        burst('!', '#FFD27A', 1)
        return say('Whoa! Hi there!', 2200)
      case 'wink':
        setMood('wink', 1800)
        fx('tilt')
        burst('✦', '#FFD27A', 2)
        return say('Psst — your money is safe in escrow!', 3000)
      case 'love':
        setMood('love', 2200)
        fx('hop')
        burst('♥', PINK, 3)
        return say('You’re my favorite human!', 2600)
      case 'spin':
        setMood('happy', 1600)
        fx('spin')
        return say('Wheee!', 1800)
    }
  }, [bump, wake, dizzy, setMood, fx, burst, say])

  // ---- pointer: click, hold, drag, throw

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture(e.pointerId)
    flyX.current?.stop()
    flyY.current?.stop()
    clearTimeout(homeTimer.current)
    bump()
    const t: Touch = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      bx: posX.get(),
      by: posY.get(),
      moved: false,
      held: false,
      trail: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    }
    t.holdTimer = setTimeout(() => {
      if (touch.current !== t || t.moved) return
      t.held = true
      setMood('lifted')
      scaleX.set(1.06)
      scaleY.set(0.9)
    }, 180)
    touch.current = t
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = touch.current
    if (!t || t.id !== e.pointerId) return
    const dx = e.clientX - t.sx
    const dy = e.clientY - t.sy
    if (!t.moved && Math.hypot(dx, dy) > 6) {
      t.moved = true
      clearTimeout(t.holdTimer)
      setDragging(true)
      setBubble(null)
      setMood('lifted')
      scaleX.set(1.06)
      scaleY.set(0.9)
    }
    if (!t.moved) return
    const b = bounds()
    posX.set(clamp(t.bx + dx, b.minX - 20, b.maxX + 20))
    posY.set(clamp(t.by + dy, b.minY, b.maxY))
    const now = performance.now()
    t.trail.push({ x: e.clientX, y: e.clientY, t: now })
    while (t.trail.length > 2 && now - t.trail[0].t > 700) t.trail.shift()
    // Shaken hard: it keeps changing direction.
    let flips = 0
    for (let i = 2; i < t.trail.length; i++) {
      const a = t.trail[i - 1].x - t.trail[i - 2].x
      const c = t.trail[i].x - t.trail[i - 1].x
      if (Math.abs(a) > 4 && Math.abs(c) > 4 && Math.sign(a) !== Math.sign(c)) flips++
    }
    if (flips >= 5 && moodRef.current !== 'dizzy') {
      dizzy()
      t.trail = t.trail.slice(-1)
    }
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = touch.current
    if (!t || t.id !== e.pointerId) return
    touch.current = null
    clearTimeout(t.holdTimer)
    scaleX.set(1)
    scaleY.set(1)
    setDragging(false)
    if (!t.moved) {
      if (t.held) {
        setMood('happy', 1500)
        fx('hop')
        say('Phew! Thanks for putting me down gently.', 2800)
      } else react()
      return
    }
    // Let go: carry on with the speed it was thrown at, bounce off the screen edges, then glide home.
    const last = t.trail[t.trail.length - 1]
    const first = t.trail.find((s) => last.t - s.t < 90) ?? t.trail[0]
    const dt = Math.max(16, last.t - first.t) / 1000
    const vx = (last.x - first.x) / dt
    const vy = (last.y - first.y) / dt
    const b = bounds()
    if (moodRef.current === 'dizzy') {
      posX.set(clamp(posX.get(), b.minX, b.maxX))
      posY.set(clamp(posY.get(), b.minY, b.maxY))
    } else {
      setMood('happy', 1800)
      if (Math.hypot(vx, vy) > 600) say('Wheee! Again, again!', 2200)
      const spring = { type: 'inertia' as const, power: 0.6, timeConstant: 320, bounceStiffness: 320, bounceDamping: 18 }
      flyX.current = animate(posX, posX.get(), { ...spring, velocity: vx, min: b.minX, max: b.maxX })
      flyY.current = animate(posY, posY.get(), { ...spring, velocity: vy, min: b.minY, max: b.maxY })
    }
    scheduleHome(4200)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      react()
    }
  }

  const hideGuide = () => {
    saveHidden(true)
    setBubble(null)
    setHidden(true)
  }
  const showGuide = () => {
    saveHidden(false)
    seen.current.clear()
    setHidden(false)
  }

  // ---- life: arriving, following the page, watching the cursor, blinking, sleeping

  useEffect(() => {
    if (hidden) return
    const arrive = (key: string, first = false) => {
      const stop = GUIDE[key]
      if (!stop) return
      sectionKey.current = key
      home.current = stop.side
      const a = anchor(stop.side)
      if (first) {
        posX.set(-dimRef.current.w - 60)
        posY.set(a.y)
      }
      clearTimeout(homeTimer.current)
      flyTo(a.x, a.y)
      bump()
      if (moodRef.current === 'sleep') setMood('idle')
      if (!seen.current.has(key)) {
        seen.current.add(key)
        setTimeout(
          () => {
            if (sectionKey.current !== key || touch.current) return
            setMood('happy', 1500)
            fx('hop')
            say(stop.line, 4800)
          },
          first ? 2200 : 1700
        )
      }
    }

    const keyOf = () => {
      const els = document.querySelectorAll<HTMLElement>('[data-guide]')
      const mid = window.innerHeight * 0.55
      let key = els[0]?.dataset.guide ?? 'hero'
      els.forEach((el) => {
        if (el.getBoundingClientRect().top <= mid) key = el.dataset.guide ?? key
      })
      return key
    }

    let pending = keyOf()
    let settle = setTimeout(() => arrive(pending, true), 1600)
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const key = keyOf()
        if (key === pending) return
        pending = key
        clearTimeout(settle)
        settle = setTimeout(() => arrive(key), 450)
        if (moodRef.current === 'sleep') setMood('idle')
        bump()
      })
    }

    const onResize = () => {
      const d = measure()
      dimRef.current = d
      setDim(d)
      const a = anchor(home.current)
      posX.set(a.x)
      posY.set(a.y)
    }

    // Eyes, lean and drift follow the cursor.
    let mouse: { x: number; y: number } | null = null
    let mRaf = 0
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      mouse = { x: e.clientX, y: e.clientY }
      if (mRaf) return
      mRaf = requestAnimationFrame(() => {
        mRaf = 0
        if (!mouse) return
        const d = dimRef.current
        const dx = mouse.x - (posX.get() + d.w / 2)
        const dy = mouse.y - (posY.get() + d.h * 0.52)
        lookX.set(clamp(dx / 260, -1, 1) * 9)
        lookY.set(clamp(dy / 260, -1, 1) * 6)
        lean.set(clamp(dx / 600, -1, 1) * 8)
        pullX.set(clamp(dx * 0.06, -34, 34))
        pullY.set(clamp(dy * 0.04, -20, 20))
      })
    }

    let blinkTimer: ReturnType<typeof setTimeout>
    const scheduleBlink = () => {
      blinkTimer = setTimeout(
        () => {
          setBlink(true)
          setTimeout(() => setBlink(false), 130)
          scheduleBlink()
        },
        2600 + Math.random() * 3200
      )
    }
    scheduleBlink()

    // Gentle float while it hovers.
    const bob = reduce ? undefined : animate(bobY, [0, -8, 0], { duration: 3.4, repeat: Infinity, ease: 'easeInOut' })

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      clearTimeout(settle)
      clearTimeout(blinkTimer)
      clearTimeout(homeTimer.current)
      clearTimeout(sleepTimer.current)
      clearTimeout(bubbleTimer.current)
      clearTimeout(moodTimer.current)
      cancelAnimationFrame(raf)
      cancelAnimationFrame(mRaf)
      bob?.stop()
      flyX.current?.stop()
      flyY.current?.stop()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [hidden, reduce, anchor, flyTo, bump, say, fx, setMood, posX, posY, bobY, lookX, lookY, lean, pullX, pullY])

  // Dreams: a "z" drifts up every so often while it sleeps.
  useEffect(() => {
    if (mood !== 'sleep') return
    const id = setInterval(() => burst('z', '#A9B6F5', 1), 1800)
    return () => clearInterval(id)
  }, [mood, burst])

  if (hidden) {
    return (
      <button
        type="button"
        onClick={showGuide}
        className="fixed bottom-5 left-5 z-40 rounded-full border border-white/10 bg-[#0B0A24]/80 px-3.5 py-2 text-[12px] text-[#A3A5AE] backdrop-blur-md transition hover:border-white/25 hover:text-[#F5F5F7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B5FEF]"
      >
        ✦ Show guide
      </button>
    )
  }

  const bubbleAlign = bubble?.right ? 'right-0 items-end' : 'left-0 items-start'
  return (
    <motion.div className="pointer-events-none fixed left-0 top-0 z-40 select-none" style={{ x: posX, y: posY, width: dim.w, height: dim.h }}>
      {bubble && (
        <motion.div
          key={bubble.key}
          initial={{ opacity: 0, y: bubble.below ? -6 : 6, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          className={`absolute flex flex-col ${bubbleAlign} ${bubble.below ? 'top-full -mt-1' : 'bottom-[calc(100%-6px)]'}`}
          style={{ width: 'max-content', maxWidth: 'min(240px, calc(100vw - 24px))' }}
        >
          <div className="relative rounded-2xl border border-[#4F7CFF]/45 bg-[#0B0A24]/85 px-3.5 py-2.5 text-[13px] font-medium leading-snug text-[#F5F5F7] shadow-[0_8px_26px_rgba(0,0,0,.45)] backdrop-blur-md">
            {bubble.text}
            <span
              aria-hidden
              className={`absolute h-[9px] w-[9px] rotate-45 border-[#4F7CFF]/45 bg-[#0B0A24] ${bubble.below ? '-top-[5px] border-l border-t' : '-bottom-[5px] border-b border-r'} ${bubble.right ? 'right-8' : 'left-8'}`}
            />
          </div>
        </motion.div>
      )}

      <motion.div className="h-full w-full" style={{ x: pullX, y: pullY }}>
        <motion.div className="h-full w-full" style={{ y: bobY }}>
          <motion.div
            role="button"
            tabIndex={0}
            aria-label="Eco, the AgentEco guide. Click to say hi, or drag to move."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onPointerEnter={(e) => e.pointerType === 'mouse' && wake('Oh! I was just resting my eyes.')}
            onKeyDown={onKeyDown}
            className={`pointer-events-auto relative h-full w-full touch-none rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-[#5B5FEF] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{
              y: bodyY,
              rotate,
              scaleX,
              scaleY,
              transformOrigin: '50% 85%',
              filter: `drop-shadow(0 10px 18px rgba(8,9,30,.45)) drop-shadow(0 0 22px rgba(79,124,255,${mood === 'sleep' ? 0.12 : 0.4}))`,
            }}
          >
            <GuideBotArt className="block h-full w-full overflow-visible" face={<Face mood={mood} blink={blink} lookX={lookX} lookY={lookY} />} />
            {sparks.map((s) => (
              <SparkView key={s.id} spark={s} onDone={dropSpark} />
            ))}
          </motion.div>
          <button
            type="button"
            onClick={hideGuide}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Hide the guide"
            title="Hide the guide"
            className="pointer-events-auto absolute right-2 top-3 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-[#0B0A24]/80 text-[11px] leading-none text-[#A3A5AE] opacity-60 transition hover:opacity-100 focus-visible:opacity-100"
          >
            ×
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
