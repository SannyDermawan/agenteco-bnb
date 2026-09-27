import { z } from 'zod'

/**
 * Every AI output is validated against one of these before anything acts on
 * it (spec §6.2). Deterministic guardrails then clamp or override the result —
 * the AI decides, code and contract guarantee.
 */

export const negotiationDecision = z.object({
  action: z.enum(['counter', 'accept', 'reject']),
  price: z.number().nonnegative(),
  reason: z.string().max(280),
})

// Execution — only the parts the model writes; code supplies the numbers.
export const translationExecution = z.object({
  translatedText: z.string().min(1),
  notes: z.string().max(500).optional(),
})

export const dataAnalysisExecution = z.object({
  insights: z.array(z.string().max(400)).max(8),
  summary: z.string().min(1).max(1200),
})

export const cryptoBriefExecution = z.object({
  brief: z.string().min(1).max(2000),
})

export const txExplainerExecution = z.object({
  explanation: z.string().min(1).max(2000),
})

export const verification = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.enum(['accept', 'dispute']),
  rationale: z.string().min(1).max(1000),
})

export const sellerDefense = z.object({
  response: z.string().min(1).max(1000),
})

export const arbiterRecommendation = z.object({
  verdict: z.enum(['seller', 'buyer']),
  confidence: z.number().int().min(0).max(100),
  rationale: z.string().min(1).max(1000),
})

export type NegotiationDecision = z.infer<typeof negotiationDecision>
export type Verification = z.infer<typeof verification>
export type SellerDefense = z.infer<typeof sellerDefense>
export type ArbiterRecommendation = z.infer<typeof arbiterRecommendation>
