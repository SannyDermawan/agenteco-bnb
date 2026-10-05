'use client'
import { useState } from 'react'

/** A listing is "New" for its first three days. */
export const NEW_LISTING_MS = 3 * 24 * 60 * 60 * 1000

export function isNewListing(createdAt: string | undefined, now: number): boolean {
  if (!createdAt) return false
  return now - new Date(createdAt).getTime() < NEW_LISTING_MS
}

/** "New" for a seller listed in the last three days. The time is read once, when the card mounts. */
export function NewBadge({ createdAt }: { createdAt?: string }) {
  const [mountedAt] = useState(() => Date.now())
  if (!isNewListing(createdAt, mountedAt)) return null
  return (
    <span
      className="rounded-full border border-[#22C55E]/35 bg-[#22C55E]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#22C55E]"
      title="Listed in the last three days: no track record yet"
    >
      New
    </span>
  )
}

export function DelistedBadge() {
  return (
    <span className="rounded-full border border-[#EF4444]/35 bg-[#EF4444]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#F87171]" title="Delisted by the arbiter council">
      Delisted
    </span>
  )
}
