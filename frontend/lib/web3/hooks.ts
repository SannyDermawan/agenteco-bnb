'use client'
import { useCallback } from 'react'
import { useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { decodeEventLog, type TransactionReceipt } from 'viem'
import { AGENT_ECO_ABI, AGENT_ECO_ADDRESS, ERC20_ABI, USDT_ADDRESS } from './abi'
import { summarizeReputation } from './reputation'

const contract = { address: AGENT_ECO_ADDRESS, abi: AGENT_ECO_ABI } as const

// Hosted agents move escrows forward on their own, so an open order page has
// to poll to show it live — until the escrow can't change any more.
const LIVE_POLL_MS = 5000
// AgentEco.sol OrderStatus: SETTLED / REFUNDED — terminal.
const TERMINAL_STATUSES = new Set([5, 6])

// =================================================================
// READS
// =================================================================

export function useEscrowBasic(escrowId?: bigint) {
  return useReadContract({
    ...contract,
    functionName: 'getEscrowBasic',
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: {
      enabled: escrowId !== undefined,
      refetchInterval: (query) => {
        const status = query.state.data?.[3]
        return status !== undefined && TERMINAL_STATUSES.has(Number(status)) ? false : LIVE_POLL_MS
      },
    },
  })
}

export function useEscrowTimestamps(escrowId?: bigint) {
  return useReadContract({
    ...contract,
    functionName: 'getEscrowTimestamps',
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: {
      enabled: escrowId !== undefined,
      // [createdAt, fundedAt, executingAt, deliveredAt, settledAt] — done once settled.
      refetchInterval: (query) => (query.state.data && query.state.data[4] > BigInt(0) ? false : LIVE_POLL_MS),
    },
  })
}

/**
 * The arbiter, read from AgentEco.sol itself rather than hardcoded — so a new
 * deployment (e.g. mainnet) or a setArbiter() change is picked up automatically.
 */
export function useArbiter() {
  return useReadContract({
    ...contract,
    functionName: 'arbiter',
    query: { staleTime: 5 * 60_000 },
  })
}

/** True when `address` is the contract's current arbiter. */
export function useIsArbiter(address?: string) {
  const { data: arbiter } = useArbiter()
  return !!address && !!arbiter && address.toLowerCase() === arbiter.toLowerCase()
}

export function useEscrowWindows(escrowId?: bigint) {
  return useReadContract({
    ...contract,
    functionName: 'getEscrowWindows',
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: { enabled: escrowId !== undefined },
  })
}

export function useResultHash(escrowId?: bigint) {
  return useReadContract({
    ...contract,
    functionName: 'getResultHash',
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: { enabled: escrowId !== undefined },
  })
}

export function useEscrowStatus(escrowId?: bigint) {
  return useReadContract({
    ...contract,
    functionName: 'getEscrowStatus',
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: { enabled: escrowId !== undefined },
  })
}

export function useIsExecutionTimedOut(escrowId?: bigint) {
  return useReadContract({
    ...contract,
    functionName: 'isExecutionTimedOut',
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: { enabled: escrowId !== undefined },
  })
}

export function useIsReviewExpired(escrowId?: bigint) {
  return useReadContract({
    ...contract,
    functionName: 'isReviewExpired',
    args: escrowId !== undefined ? [escrowId] : undefined,
    query: { enabled: escrowId !== undefined },
  })
}

/** Batched (multicall) read — for a dashboard aggregating many orders at once. */
export function useEscrowStatuses(escrowIds: bigint[]) {
  return useReadContracts({
    contracts: escrowIds.map((id) => ({ ...contract, functionName: 'getEscrowStatus' as const, args: [id] as const })),
    query: { enabled: escrowIds.length > 0 },
  })
}

export function useEscrowTimestampsMulti(escrowIds: bigint[]) {
  return useReadContracts({
    contracts: escrowIds.map((id) => ({ ...contract, functionName: 'getEscrowTimestamps' as const, args: [id] as const })),
    query: { enabled: escrowIds.length > 0 },
  })
}

/** On-chain reputation for `address`, as a named summary (see ./reputation.ts). */
export function useReputation(address?: `0x${string}`) {
  return useReadContract({
    ...contract,
    functionName: 'getReputation',
    args: address ? [address] : undefined,
    query: { enabled: !!address, select: summarizeReputation },
  })
}

export function useUsdtBalance(address?: `0x${string}`) {
  return useReadContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
}

export function useUsdtDecimals() {
  return useReadContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'decimals',
  })
}

export function useUsdtAllowance(owner?: `0x${string}`) {
  return useReadContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner ? [owner, AGENT_ECO_ADDRESS] : undefined,
    query: { enabled: !!owner },
  })
}

// =================================================================
// WRITES — shared shape: { write, hash, isPending, isConfirming, isSuccess, error, reset }
// =================================================================

// Actions that take only the escrow id. Dispute actions also carry a hash —
// see useHashedEscrowAction below.
type SimpleEscrowAction =
  | 'startExecution'
  | 'fundEscrow'
  | 'acceptAndSettle'
  | 'refundEscrow'
  | 'claimAcceptTimeout'
  | 'claimExecutionTimeout'
  | 'finalizeAfterReviewWindow'
  | 'claimDisputeTimeout'

type HashedEscrowAction = 'raiseDispute' | 'submitDisputeResponse' | 'resolveDisputeForSeller' | 'resolveDisputeForBuyer'

function useEscrowAction(functionName: SimpleEscrowAction) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const write = useCallback(
    (escrowId: bigint) => {
      writeContract({ ...contract, functionName, args: [escrowId] })
    },
    [writeContract, functionName]
  )

  return { write, hash, isPending, isConfirming, isSuccess, error, reset }
}

/** Dispute actions: (escrowId, keccak256 of the off-chain text or rationale object). */
function useHashedEscrowAction(functionName: HashedEscrowAction) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const write = useCallback(
    (escrowId: bigint, textOrRationaleHash: `0x${string}`) => {
      writeContract({ ...contract, functionName, args: [escrowId, textOrRationaleHash] })
    },
    [writeContract, functionName]
  )

  return { write, hash, isPending, isConfirming, isSuccess, error, reset }
}

export function useStartExecution() {
  return useEscrowAction('startExecution')
}

export function useFundEscrow() {
  return useEscrowAction('fundEscrow')
}

export function useAcceptAndSettle() {
  return useEscrowAction('acceptAndSettle')
}

export function useRaiseDispute() {
  return useHashedEscrowAction('raiseDispute')
}

export function useSubmitDisputeResponse() {
  return useHashedEscrowAction('submitDisputeResponse')
}

export function useClaimAcceptTimeout() {
  return useEscrowAction('claimAcceptTimeout')
}

export function useClaimDisputeTimeout() {
  return useEscrowAction('claimDisputeTimeout')
}

export function useRefundEscrow() {
  return useEscrowAction('refundEscrow')
}

export function useClaimExecutionTimeout() {
  return useEscrowAction('claimExecutionTimeout')
}

export function useFinalizeAfterReviewWindow() {
  return useEscrowAction('finalizeAfterReviewWindow')
}

export function useResolveDisputeForSeller() {
  return useHashedEscrowAction('resolveDisputeForSeller')
}

export function useResolveDisputeForBuyer() {
  return useHashedEscrowAction('resolveDisputeForBuyer')
}

export function useMarkDelivered() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const write = useCallback(
    (escrowId: bigint, resultHash: `0x${string}`) => {
      writeContract({ ...contract, functionName: 'markDelivered', args: [escrowId, resultHash] })
    },
    [writeContract]
  )

  return { write, hash, isPending, isConfirming, isSuccess, error, reset }
}

export function useApproveUsdt() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const write = useCallback(
    (amount: bigint) => {
      writeContract({ address: USDT_ADDRESS, abi: ERC20_ABI, functionName: 'approve', args: [AGENT_ECO_ADDRESS, amount] })
    },
    [writeContract]
  )

  return { write, hash, isPending, isConfirming, isSuccess, error, reset }
}

/**
 * createEscrow doesn't hand back its return value directly (that's only
 * possible for a plain eth_call, not a state-changing tx) — the new
 * escrowId has to be read out of the EscrowCreated event once the
 * transaction is mined, via the receipt this hook already waits for.
 */
export function useCreateEscrow() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const write = useCallback(
    (seller: `0x${string}`, amount: bigint, executionWindow: bigint, reviewWindow: bigint, taskHash: `0x${string}`) => {
      writeContract({
        ...contract,
        functionName: 'createEscrow',
        args: [seller, amount, executionWindow, reviewWindow, taskHash],
      })
    },
    [writeContract]
  )

  const escrowId = receipt ? parseCreatedEscrowId(receipt) : null

  return { write, hash, isPending, isConfirming, isSuccess, escrowId, error, reset }
}

export function parseCreatedEscrowId(receipt: TransactionReceipt): bigint | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== AGENT_ECO_ADDRESS.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: AGENT_ECO_ABI, data: log.data, topics: log.topics })
      if (decoded.eventName === 'EscrowCreated') {
        return (decoded.args as { escrowId: bigint }).escrowId
      }
    } catch {
      continue
    }
  }
  return null
}
