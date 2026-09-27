import type { Hex, PublicClient } from 'viem'
import {
  CAPABILITIES,
  type CapabilityId,
  type CryptoBriefInput,
  type DataAnalysisInput,
  type TranslationInput,
  type TxExplainerInput,
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
 * Runs one job (spec §7): code does the deterministic part (validation, CSV
 * statistics, CoinGecko data, decoded transaction facts), the AI interprets it,
 * and the result is checked against the capability's output schema before it
 * is delivered. When the AI is unavailable, data_analysis, crypto_market_brief
 * and tx_explainer deliver the code-only result marked "AI unavailable";
 * translation does not deliver at all.
 */
export async function executeCapability(capability: CapabilityId, brief: unknown, ctx: ExecutionContext): Promise<ExecutionOutcome> {
  const llm = ctx.llm ?? callLLM
  const parsed = CAPABILITIES[capability].input.safeParse(brief)
  if (!parsed.success) {
    return { deliver: false, reason: `Invalid brief: ${parsed.error.issues.map((i) => i.message).join('; ')}` }
  }

  try {
    let result: unknown
    let ai: LLMResult<unknown> | null = null

    switch (capability) {
      case 'translation': {
        const input = parsed.data as TranslationInput
        const p = translationPrompt(input, ctx.criteria, ctx.customInstructions)
        const out = await llm({ task: 'execute', ...p, schema: translationExecution, agentId: ctx.agentId })
        if (!out) return { deliver: false, reason: `${AI_UNAVAILABLE}: translation needs the model, so it was not delivered.` }
        ai = out
        result = { translatedText: out.data.translatedText, targetLanguage: input.targetLanguage, ...(out.data.notes && { notes: out.data.notes }) }
        break
      }
      case 'data_analysis': {
        const input = parsed.data as DataAnalysisInput
        const stats = computeStats(input.csv)
        const p = dataAnalysisPrompt(input, stats, ctx.criteria, ctx.customInstructions)
        const out = await llm({ task: 'execute', ...p, schema: dataAnalysisExecution, agentId: ctx.agentId })
        ai = out
        result = out
          ? { stats, insights: out.data.insights, summary: out.data.summary }
          : { stats, insights: [], summary: `${AI_UNAVAILABLE} — these are the computed statistics only.` }
        break
      }
      case 'crypto_market_brief': {
        const input = parsed.data as CryptoBriefInput
        const data = await fetchCoinMarkets(input.coins)
        const p = cryptoBriefPrompt(input, data, ctx.criteria, ctx.customInstructions)
        const out = await llm({ task: 'execute', ...p, schema: cryptoBriefExecution, agentId: ctx.agentId })
        ai = out
        result = { data, brief: out ? out.data.brief : `${AI_UNAVAILABLE} — this is the market data only.`, disclaimer: NOT_FINANCIAL_ADVICE }
        break
      }
      case 'tx_explainer': {
        const input = parsed.data as TxExplainerInput
        const facts = await buildTxFacts(ctx.publicClient, input.txHash as Hex, ctx.agentEcoAddress)
        const p = txExplainerPrompt(facts, ctx.criteria, ctx.customInstructions)
        const out = await llm({ task: 'execute', ...p, schema: txExplainerExecution, agentId: ctx.agentId })
        ai = out
        result = { facts, explanation: out ? out.data.explanation : `${AI_UNAVAILABLE} — these are the decoded facts only.` }
        break
      }
    }

    const checked = CAPABILITIES[capability].output.safeParse(result)
    if (!checked.success) {
      return { deliver: false, reason: `Result failed the ${capability} output schema: ${checked.error.issues[0]?.message}` }
    }
    return { deliver: true, result: checked.data, ai: ai ? { provider: ai.provider, model: ai.model } : null }
  } catch (error) {
    if (error instanceof InvalidInputError) return { deliver: false, reason: `Invalid brief: ${error.message}` }
    throw error
  }
}
