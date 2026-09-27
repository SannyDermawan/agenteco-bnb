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
} from '../../../agent-runtime/src/shared/capabilities/definitions.ts'
import { InvalidInputError, computeStats } from '../../../agent-runtime/src/capabilities/dataAnalysis.ts'
import { fetchCoinMarkets } from '../../../agent-runtime/src/capabilities/cryptoMarket.ts'
import { buildTxFacts } from '../../../agent-runtime/src/capabilities/txFacts.ts'
import { callLLM, type LLMRequest, type LLMResult } from '../ai/llm.ts'
import { cryptoBriefPrompt, dataAnalysisPrompt, translationPrompt, txExplainerPrompt } from '../ai/prompts/execute.ts'
import {
  cryptoBriefExecution,
  dataAnalysisExecution,
  translationExecution,
  txExplainerExecution,
} from '../ai/schemas.ts'

export const AI_UNAVAILABLE = 'AI unavailable'
export const NOT_FINANCIAL_ADVICE =
  'This brief summarises public market data for information only. It is not financial advice.'

export interface ExecutionContext {
  /** Hosted seller id — AI calls count against its hourly budget. */
  agentId?: string
  customInstructions?: string | null
  criteria?: string | null
  publicClient: PublicClient
  agentEcoAddress: string
  /** Injected in tests. */
  llm?: <T>(req: LLMRequest<T>) => Promise<LLMResult<T> | null>
}

/** A validated brief plus its code-computed data, ready for the model. */
export type PreparedJob =
  | { capability: 'translation'; input: TranslationInput }
  | { capability: 'data_analysis'; input: DataAnalysisInput; stats: DataStats }
  | { capability: 'crypto_market_brief'; input: CryptoBriefInput; data: CryptoBriefOutput['data'] }
  | { capability: 'tx_explainer'; input: TxExplainerInput; facts: TxFacts }

export type ExecutionOutcome =
  /** Deliver this result; `ai` is null when the AI part fell back. */
  | { deliver: true; result: unknown; ai: { provider: string; model: string } | null }
  /**
   * Do not deliver. Before startExecution (invalid brief) the accept timeout
   * refunds the buyer; after it (translation without AI) the execution
   * timeout does.
   */
  | { deliver: false; reason: string }

/**
 * Step 1, before the seller accepts the job on-chain: validate the brief and
 * run the fast, deterministic part (CSV statistics, CoinGecko data, decoded
 * transaction facts). Any failure here is an invalid input — the seller must
 * not call startExecution, so the accept timeout refunds the buyer (spec §7).
 */
export async function prepareJob(
  capability: CapabilityId,
  brief: unknown,
  ctx: Pick<ExecutionContext, 'publicClient' | 'agentEcoAddress'>
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
 * Step 2, after startExecution: the model interprets the prepared data, and
 * the result is checked against the capability's output schema before it is
 * delivered. Without AI, data_analysis, crypto_market_brief and tx_explainer
 * deliver the code-only result marked "AI unavailable"; translation is not
 * delivered at all (spec §7).
 */
export async function runJob(job: PreparedJob, ctx: ExecutionContext): Promise<ExecutionOutcome> {
  const llm = ctx.llm ?? callLLM
  let result: unknown
  let ai: LLMResult<unknown> | null = null

  switch (job.capability) {
    case 'translation': {
      const p = translationPrompt(job.input, ctx.criteria, ctx.customInstructions)
      const out = await llm({ task: 'execute', ...p, schema: translationExecution, agentId: ctx.agentId })
      if (!out) return { deliver: false, reason: `${AI_UNAVAILABLE}: translation needs the model, so it was not delivered.` }
      ai = out
      result = { translatedText: out.data.translatedText, targetLanguage: job.input.targetLanguage, ...(out.data.notes && { notes: out.data.notes }) }
      break
    }
    case 'data_analysis': {
      const p = dataAnalysisPrompt(job.input, job.stats, ctx.criteria, ctx.customInstructions)
      const out = await llm({ task: 'execute', ...p, schema: dataAnalysisExecution, agentId: ctx.agentId })
      ai = out
      result = out
        ? { stats: job.stats, insights: out.data.insights, summary: out.data.summary }
        : { stats: job.stats, insights: [], summary: `${AI_UNAVAILABLE} — these are the computed statistics only.` }
      break
    }
    case 'crypto_market_brief': {
      const p = cryptoBriefPrompt(job.input, job.data, ctx.criteria, ctx.customInstructions)
      const out = await llm({ task: 'execute', ...p, schema: cryptoBriefExecution, agentId: ctx.agentId })
      ai = out
      result = { data: job.data, brief: out ? out.data.brief : `${AI_UNAVAILABLE} — this is the market data only.`, disclaimer: NOT_FINANCIAL_ADVICE }
      break
    }
    case 'tx_explainer': {
      const p = txExplainerPrompt(job.facts, ctx.criteria, ctx.customInstructions)
      const out = await llm({ task: 'execute', ...p, schema: txExplainerExecution, agentId: ctx.agentId })
      ai = out
      result = { facts: job.facts, explanation: out ? out.data.explanation : `${AI_UNAVAILABLE} — these are the decoded facts only.` }
      break
    }
  }

  const checked = CAPABILITIES[job.capability].output.safeParse(result)
  if (!checked.success) {
    return { deliver: false, reason: `Result failed the ${job.capability} output schema: ${checked.error.issues[0]?.message}` }
  }
  return { deliver: true, result: checked.data, ai: ai ? { provider: ai.provider, model: ai.model } : null }
}

/** prepareJob + runJob in one go — for callers with no on-chain step in between. */
export async function executeCapability(capability: CapabilityId, brief: unknown, ctx: ExecutionContext): Promise<ExecutionOutcome> {
  const prepared = await prepareJob(capability, brief, ctx)
  if (!prepared.ok) return { deliver: false, reason: prepared.reason }
  return runJob(prepared.job, ctx)
}
