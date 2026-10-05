'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { readContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { rationaleHash, type RationaleInput } from '@shared/hashes'
import { wagmiConfig } from '@/lib/web3/config'
import { AGENT_ECO_ABI, ARBITER_COUNCIL_ABI, agentEcoFor } from '@/lib/web3/abi'
import { useArbiterCouncil } from '@/lib/web3/hooks'
import { submitDisputeResolution, type ApiDispute } from '@/lib/api/disputes'

const MIN_RATIONALE = 10
const MAX_RATIONALE = 1000

type Verdict = 'seller' | 'buyer'
const opposite = (v: Verdict): Verdict => (v === 'seller' ? 'buyer' : 'seller')
const label = (v: Verdict) => (v === 'seller' ? 'Release to seller' : 'Refund buyer')

/**
 * The human arbiter's ruling (spec §11 step 4), signed from the arbiter
 * wallet in the browser: Approve executes the AI recommendation as written;
 * Reverse rules the other way with the arbiter's own reasons. Either commits
 * rationaleHash(verdict, confidence, rationale, "arbiter-manual") on-chain,
 * then posts the rationale so anyone can re-hash it.
 *
 * When the arbiter is an ArbiterCouncil (from AgentEco v2), the ruling is this
 * member's vote: it executes when it reaches the council's ruling threshold,
 * otherwise it waits for another member to vote the same ruling. Each
 * deployment has its own council; the escrow's own deployment decides.
 */
export function ArbiterDecision({ escrowId, dispute }: { escrowId: bigint; dispute: ApiDispute | undefined }) {
  const queryClient = useQueryClient()
  const rec = dispute?.recVerdict && dispute.recRationale && dispute.recConfidence !== null ? dispute : null
  const [mode, setMode] = useState<'idle' | 'reverse' | 'manual'>('idle')
  const [text, setText] = useState('')
  const [manualVerdict, setManualVerdict] = useState<Verdict>('buyer')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // The arbiter of the deployment holding this escrow: v3's or v2's council, or v1's wallet.
  const council = useArbiterCouncil(escrowId)

  async function rule(input: RationaleInput) {
    setError(null)
    setNote(null)
    try {
      setBusy(council ? 'Confirm your council vote in your wallet…' : 'Confirm the ruling in your wallet…')
      const toSeller = input.verdict === 'seller'
      const hash = council
        ? await writeContract(wagmiConfig, {
            address: council.address,
            abi: ARBITER_COUNCIL_ABI,
            functionName: 'voteRuling',
            args: [escrowId, toSeller, rationaleHash(input)],
          })
        : await writeContract(wagmiConfig, {
            address: agentEcoFor(escrowId),
            abi: AGENT_ECO_ABI,
            functionName: toSeller ? 'resolveDisputeForSeller' : 'resolveDisputeForBuyer',
            args: [escrowId, rationaleHash(input)],
          })
      setBusy('Waiting for the transaction…')
      await waitForTransactionReceipt(wagmiConfig, { hash })
      if (council) {
        const status = await readContract(wagmiConfig, { address: agentEcoFor(escrowId), abi: AGENT_ECO_ABI, functionName: 'getEscrowStatus', args: [escrowId] })
        if (Number(status) === 4) {
          // Still DISPUTED: the vote is in, the ruling needs more members.
          setNote(`Your vote is recorded. The ruling executes once ${council.rulingThreshold} council members vote for it.`)
          setMode('idle')
          return
        }
      }
      setBusy('Publishing the rationale…')
      await submitDisputeResolution(escrowId.toString(), input, hash)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['disputes'] }),
        queryClient.invalidateQueries({ queryKey: ['disputeReasons'] }),
        queryClient.invalidateQueries({ queryKey: ['disputeReason', escrowId.toString()] }),
      ])
      setMode('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'The ruling failed.')
    } finally {
      setBusy(null)
    }
  }

  const typed = text.trim()
  const textOk = typed.length >= MIN_RATIONALE && typed.length <= MAX_RATIONALE
  const btn =
    'rounded-xl px-3.5 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="space-y-2.5">
      {rec && mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              rule({ verdict: rec.recVerdict!, confidence: rec.recConfidence!, rationale: rec.recRationale!, decidedBy: 'arbiter-manual' })
            }
            className={`${btn} bg-[#5B5FEF] text-white hover:brightness-110`}
          >
            Approve · {label(rec.recVerdict!)}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => setMode('reverse')}
            className={`${btn} border border-white/[0.1] text-[#F5F5F7] hover:border-white/25`}
          >
            Reverse · {label(opposite(rec.recVerdict!))}
          </button>
        </div>
      )}
      {!rec && mode === 'idle' && (
        <button type="button" disabled={!!busy} onClick={() => setMode('manual')} className={`${btn} bg-[#5B5FEF] text-white hover:brightness-110`}>
          Decide manually
        </button>
      )}

      {mode !== 'idle' && (
        <div className="space-y-2 rounded-xl border border-white/[0.08] bg-[#0B0C11] p-3">
          {mode === 'manual' && (
            <div className="flex gap-2">
              {(['seller', 'buyer'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setManualVerdict(v)}
                  className={`${btn} flex-1 border ${
                    manualVerdict === v ? 'border-[#5B5FEF]/50 bg-[#5B5FEF]/10 text-[#F5F5F7]' : 'border-white/[0.08] text-[#8B8D96]'
                  }`}
                >
                  {label(v)}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={MAX_RATIONALE}
            placeholder="Why? Both parties and the judges read this; its hash goes on-chain."
            className="w-full resize-none rounded-lg border border-white/[0.08] bg-[#11141B] px-3 py-2 text-[13px] text-[#F5F5F7] placeholder:text-[#54565F] focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!textOk || !!busy}
              onClick={() =>
                rule({
                  verdict: mode === 'reverse' ? opposite(rec!.recVerdict!) : manualVerdict,
                  // A human ruling is not a probability estimate.
                  confidence: 100,
                  rationale: typed,
                  decidedBy: 'arbiter-manual',
                })
              }
              className={`${btn} bg-[#5B5FEF] text-white hover:brightness-110`}
            >
              {mode === 'reverse' ? label(opposite(rec!.recVerdict!)) : label(manualVerdict)}
            </button>
            <button type="button" disabled={!!busy} onClick={() => setMode('idle')} className={`${btn} text-[#8B8D96] hover:text-[#F5F5F7]`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {busy && <p className="text-[12px] text-[#8B8D96]">{busy}</p>}
      {note && <p className="text-[12px] text-[#A3A5AE]">{note}</p>}
      {error && <p className="text-[12px] text-[#EF4444]">{error}</p>}
    </div>
  )
}
