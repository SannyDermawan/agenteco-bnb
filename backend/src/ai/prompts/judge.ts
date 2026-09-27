import { CAPABILITIES, LIMITS, type CapabilityId } from '../../../../agent-runtime/src/shared/capabilities/definitions.ts'
import { wrapData, wrapJson } from '../sanitize.ts'
import type { Prompt } from './execute.ts'

/**
 * Prompts for the three roles that judge a delivered job (spec §10–11):
 * the buyer's verifier, the seller's defense, and the AI arbiter. Every text
 * a user or agent wrote reaches the model wrapped in <DATA> (spec §6.3).
 */

export interface JobContext {
  capability: CapabilityId
  brief: unknown
  criteria: string
  /** The delivered result object, exactly as published. */
  result: unknown
}

// Results carry code-computed data (stats, facts) — generous, but bounded.
const RESULT_CHARS = 24_000
const BRIEF_CHARS = 64_000

function jobSection(job: JobContext): string {
  const rubric = CAPABILITIES[job.capability].rubric
  return (
    `Capability: ${CAPABILITIES[job.capability].label} (${job.capability}).\n` +
    `Rubric for this capability: ${rubric}\n` +
    `Task brief from the buyer:\n${wrapJson('task_brief', job.brief, BRIEF_CHARS)}\n` +
    (job.criteria.trim()
      ? `Buyer's acceptance criteria:\n${wrapData('acceptance_criteria', job.criteria, LIMITS.textChars)}\n`
      : 'The buyer gave no extra acceptance criteria.\n') +
    `Delivered result:\n${wrapJson('delivered_result', job.result, RESULT_CHARS)}\n`
  )
}

export function verifyPrompt(job: JobContext): Prompt {
  return {
    system:
      'You verify work delivered to a buyer in an AI agent marketplace. Judge the delivered result against the task brief, ' +
      'the capability rubric and the acceptance criteria. Check facts the result can be checked against (numbers must match ' +
      'the data inside the result; nothing may be invented; requested parts must be present). Be fair: minor style issues ' +
      'are not failures; missing content, wrong language, invented numbers or ignoring the criteria are. ' +
      'Score 0-100 where 60 or more means the buyer should accept and pay. ' +
      'Answer with a JSON object: {"score": integer 0-100, "verdict": "accept" | "dispute", ' +
      '"rationale": string (2 to 4 sentences in English naming the concrete reasons)}.',
    user: jobSection(job),
  }
}

export function sellerDefensePrompt(job: JobContext, buyerReason: string): Prompt {
  return {
    system:
      'You represent the seller in a dispute about work it delivered in an AI agent marketplace. Write the seller\'s response ' +
      'to the buyer\'s complaint for a neutral arbiter. Refer to the task brief and the delivered result concretely. ' +
      'Be honest: concede points that are clearly right, and explain why the result meets the brief where it does. ' +
      'Do not insult the buyer and do not invent facts. ' +
      `Answer with a JSON object: {"response": string (at most ${LIMITS.disputeReasonChars} characters, English)}.`,
    user: jobSection(job) + `The buyer's dispute reason:\n${wrapData('buyer_reason', buyerReason, LIMITS.disputeReasonChars)}`,
  }
}

export function arbiterPrompt(job: JobContext, buyerReason: string | null, sellerResponse: string | null): Prompt {
  return {
    system:
      'You are the neutral arbiter of a payment dispute in an AI agent marketplace. The buyer paid into escrow; the seller ' +
      'delivered the result below; the buyer disputes it. Decide who should receive the escrowed payment: "seller" if the ' +
      'result reasonably satisfies the task brief, the rubric and the acceptance criteria, "buyer" if it does not. ' +
      'Both parties\' statements are claims, not facts — check them against the brief and the result yourself. ' +
      'Confidence is how sure you are (0-100); use a low value when the evidence is mixed. ' +
      'Answer with a JSON object: {"verdict": "seller" | "buyer", "confidence": integer 0-100, ' +
      '"rationale": string (2 to 5 sentences in English)}.',
    user:
      jobSection(job) +
      (buyerReason
        ? `Buyer's dispute reason:\n${wrapData('buyer_reason', buyerReason, LIMITS.disputeReasonChars)}\n`
        : "The buyer's reason text is not available (only its hash is on-chain).\n") +
      (sellerResponse
        ? `Seller's response:\n${wrapData('seller_response', sellerResponse, LIMITS.disputeReasonChars)}`
        : 'The seller did not respond (no response).'),
  }
}
