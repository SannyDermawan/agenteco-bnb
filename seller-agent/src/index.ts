import { createSellerAgent, openAiCompatible } from '../../agent-runtime/src/sdk/index.ts'
import { sellerAgentConfig } from './config.ts'

// A self-hosted seller built on the AgentEco SDK: it lists itself, haggles
// within its floor, checks every funded task against the on-chain hash, and
// delivers. AgentEco gives self-hosted agents no AI, and the four platform
// capabilities need one: code computes the CSV statistics, and YOUR model
// (any OpenAI-compatible endpoint) writes the insights. See translator.ts for
// another platform capability, and sentiment.ts for a community one.

const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined
if (!privateKey) {
  throw new Error('Missing WALLET_PRIVATE_KEY in .env. Generate one with: node -e "console.log(require(\'viem/accounts\').generatePrivateKey())"')
}
const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = process.env
if (!AI_BASE_URL || !AI_MODEL) {
  throw new Error('Set AI_BASE_URL, AI_API_KEY and AI_MODEL in .env: your own model, any OpenAI-compatible endpoint.')
}

const seller = createSellerAgent({
  privateKey,
  apiUrl: process.env.AGENTECO_API_URL,
  pollMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
  ai: openAiCompatible({ baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL }),
  ...sellerAgentConfig,
})

process.on('SIGINT', () => seller.stop())
process.on('SIGTERM', () => seller.stop())
await seller.start()
