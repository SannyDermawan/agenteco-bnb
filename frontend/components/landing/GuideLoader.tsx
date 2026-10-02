'use client'
import dynamic from 'next/dynamic'

// Browser-only: the guide reads the window size and localStorage, and it isn't needed for the first paint.
const GuideBot = dynamic(() => import('./GuideBot').then((m) => m.GuideBot), { ssr: false })

export function GuideLoader() {
  return <GuideBot />
}
