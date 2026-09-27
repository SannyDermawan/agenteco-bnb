import { GEMINI_API_KEY, GEMINI_MODEL } from '../config.ts'
import { ProviderHttpError, type CompletionRequest, type LLMProvider } from './types.ts'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** "13s" / "1.5s" → seconds. Gemini puts the retry delay in the error body's RetryInfo. */
function parseRetryDelay(body: string): number | undefined {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  return m ? Number(m[1]) : undefined
}

/** Gemini's generateContent API with a JSON response. One model serves every task. */
export const geminiProvider: LLMProvider = {
  name: 'gemini',
  available: () => !!GEMINI_API_KEY,
  modelFor: () => GEMINI_MODEL,
  async complete({ model, system, user, timeoutMs }: CompletionRequest): Promise<string> {
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const body = await res.text()
      const header = Number(res.headers.get('retry-after'))
      throw new ProviderHttpError(
        res.status,
        `Gemini HTTP ${res.status}: ${body.slice(0, 200)}`,
        Number.isFinite(header) && header > 0 ? header : parseRetryDelay(body)
      )
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
    if (!text) throw new Error('Gemini returned no content')
    return text
  },
}
