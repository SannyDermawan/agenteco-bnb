import { GROQ_API_KEY, GROQ_MODELS, type LLMTask } from '../config.ts'
import { ProviderHttpError, type CompletionRequest, type LLMProvider } from './types.ts'

const URL = 'https://api.groq.com/openai/v1/chat/completions'

// Light reasoning for the quick, frequent calls; more for the ones that judge.
const REASONING_EFFORT: Record<LLMTask, 'low' | 'medium'> = {
  negotiation: 'low',
  seller_defense: 'low',
  execute: 'medium',
  verify: 'medium',
  arbiter: 'medium',
}

/** Groq's OpenAI-compatible chat API in JSON mode. */
export const groqProvider: LLMProvider = {
  name: 'groq',
  available: () => !!GROQ_API_KEY,
  modelFor: (task) => GROQ_MODELS[task],
  async complete({ task, model, system, user, timeoutMs }: CompletionRequest): Promise<string> {
    const reasoningModel = /gpt-oss|qwen/i.test(model)
    const res = await fetch(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        // Reasoning stays out of the response; JSON mode keeps content clean.
        ...(reasoningModel && { reasoning_effort: REASONING_EFFORT[task], include_reasoning: false }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'))
      throw new ProviderHttpError(
        res.status,
        `Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
      )
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('Groq returned no content')
    return content
  },
}
