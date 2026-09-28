'use client'
import { TaskCard } from './TaskCard'
import { EscrowResultCard } from './EscrowResultCard'
import { VerificationCard } from './VerificationCard'
import { DisputeTimelineCard } from './DisputeTimelineCard'
import { RateSellerCard } from './RateSellerCard'

/**
 * The task and everything after delivery, shared by both order pages: the
 * brief (hash-checked), the result (per capability, hash-checked), the hosted buyer's AI verification, the dispute
 * timeline and the seller rating.
 */
export function EscrowReviewCards({
  escrowId,
  status,
  buyer,
  deliveredAt,
}: {
  escrowId: bigint
  status: number
  buyer: string
  deliveredAt: bigint | undefined
}) {
  return (
    <>
      <TaskCard escrowId={escrowId} />
      <EscrowResultCard escrowId={escrowId} status={status} />
      <VerificationCard escrowId={escrowId} status={status} />
      <DisputeTimelineCard escrowId={escrowId} status={status} buyer={buyer} />
      {deliveredAt !== undefined && <RateSellerCard escrowId={escrowId} status={status} buyer={buyer} deliveredAt={deliveredAt} />}
    </>
  )
}
