import type { Hex, PublicClient } from 'viem'
import {
  CAPABILITIES,
  type CapabilityId,
  type CryptoBriefInput,
  type CryptoBriefOutput,
  type DataAnalysisInput,
  type DataStats,
  type TranslationInput,
  type TxExplainerInput,
  type TxFacts,
} from '../shared/capabilities/definitions.ts'
import { InvalidInputError, computeStats } from './dataAnalysis.ts'
import { fetchCoinMarkets } from './cryptoMarket.ts'
import { buildTxFacts } from './txFacts.ts'

/**
 * The code half of every capability (spec §7), shared by the hosted seller
 * (backend/src/capabilities/execute.ts adds the model on top) and the
 * standalone seller-agent (which may run without any model at all).
 */

export const AI_UNAVAILABLE = 'AI unavailable'
export const NOT_FINANCIAL_ADVICE =
  'This brief summarises public market data for information only. It is not financial advice.'

/** A validated brief plus its code-computed data, ready for the model. */
export type PreparedJob =
  | { capability: 'translation'; input: TranslationInput }
  | { capability: 'data_analysis'; input: DataAnalysisInput; stats: DataStats }
  | { capability: 'crypto_market_brief'; input: CryptoBriefInput; data: CryptoBriefOutput['data'] }
  | { capability: 'tx_explainer'; input: TxExplainerInput; facts: TxFacts }

export interface PrepareContext {
  publicClient: PublicClient
  agentEcoAddress: string
}

/**
 * Before the seller accepts the job on-chain: validate the brief and run the
 * fast, deterministic part (CSV statistics, CoinGecko data, decoded
 * transaction facts). Any failure here is an invalid input — the seller must
 * not call startExecution, so the accept timeout refunds the buyer (spec §7).
 * Network failures (RPC, CoinGecko) are thrown, not reported as invalid.
 */
export async function prepareJob(
  capability: CapabilityId,
  brief: unknown,
  ctx: PrepareContext
): Promise<{ ok: true; job: PreparedJob } | { ok: false; reason: string }> {
  const parsed = CAPABILITIES[capability].input.safeParse(brief)
  if (!parsed.success) {
    return { ok: false, reason: `Invalid brief: ${parsed.error.issues.map((i) => i.message).join('; ')}` }
  }
  try {
    switch (capability) {
      case 'translation':
        return { ok: true, job: { capability, input: parsed.data as TranslationInput } }
      case 'data_analysis': {
        const input = parsed.data as DataAnalysisInput
        return { ok: true, job: { capability, input, stats: computeStats(input.csv) } }
      }
      case 'crypto_market_brief': {
        const input = parsed.data as CryptoBriefInput
        return { ok: true, job: { capability, input, data: await fetchCoinMarkets(input.coins) } }
      }
      case 'tx_explainer': {
        const input = parsed.data as TxExplainerInput
        return { ok: true, job: { capability, input, facts: await buildTxFacts(ctx.publicClient, input.txHash as Hex, ctx.agentEcoAddress) } }
      }
    }
  } catch (error) {
    if (error instanceof InvalidInputError) return { ok: false, reason: `Invalid brief: ${error.message}` }
    throw error
  }
}

/**
 * The result a seller delivers when no model is available: only the data the
 * code computed, with the prose field marked "AI unavailable". Translation has
 * no code-only result — it must not be delivered (null).
 */
export function codeOnlyResult(job: PreparedJob): Record<string, unknown> | null {
  switch (job.capability) {
    case 'translation':
      return null
    case 'data_analysis':
      return { stats: job.stats, insights: [], summary: `${AI_UNAVAILABLE} — these are the computed statistics only.` }
    case 'crypto_market_brief':
      return { data: job.data, brief: `${AI_UNAVAILABLE} — this is the market data only.`, disclaimer: NOT_FINANCIAL_ADVICE }
    case 'tx_explainer':
      return { facts: job.facts, explanation: `${AI_UNAVAILABLE} — these are the decoded facts only.` }
  }
}
