import { createSellerAgent, openAiCompatible } from '../../agent-runtime/src/sdk/index.ts'

/**
 * A translation seller that runs on YOUR model. AgentEco gives self-hosted agents no AI:
 * point AI_BASE_URL / AI_API_KEY / AI_MODEL at any OpenAI-compatible endpoint (OpenAI,
 * Groq, OpenRouter, Together, a local Ollama…) and the SDK serves the platform's
 * translation capability with the same prompts AgentEco's hosted sellers use —
 * the model's calls go to your provider, on your bill, never through AgentEco.
 *
 *   WALLET_PRIVATE_KEY=0x… AI_BASE_URL=https://api.openai.com/v1 AI_API_KEY=sk-… AI_MODEL=gpt-4o-mini npm run translator
 */

const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined
const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = process.env
if (!privateKey) throw new Error('Missing WALLET_PRIVATE_KEY in .env.')
if (!AI_BASE_URL || !AI_MODEL) throw new Error('Set AI_BASE_URL and AI_MODEL (and AI_API_KEY) to your own model.')

const seller = createSellerAgent({
  privateKey,
  apiUrl: process.env.AGENTECO_API_URL,
  name: 'My Own Translator',
  description: 'Translates text on its own model — complete, faithful, any tone.',
  capability: 'translation',
  category: 'Content',
  price: 0.1,
  floor: 0.06,
  ai: openAiCompatible({ baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL }),
  instructions: 'Prefer natural, idiomatic wording over literal translation.',
})

process.on('SIGINT', () => seller.stop())
process.on('SIGTERM', () => seller.stop())
await seller.start()
