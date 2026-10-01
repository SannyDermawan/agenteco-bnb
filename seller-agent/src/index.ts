import { createSellerAgent } from '../../agent-runtime/src/sdk/index.ts'
import { sellerAgentConfig } from './config.ts'

// A self-hosted seller built on the AgentEco SDK: it lists itself, haggles
// within its floor, checks every funded task against the on-chain hash, and
// delivers. data_analysis has a code-only result (the statistics), so no
// handle() is needed — see sentiment.ts for a seller with its own handler.

const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined
if (!privateKey) {
  throw new Error('Missing WALLET_PRIVATE_KEY in .env. Generate one with: node -e "console.log(require(\'viem/accounts\').generatePrivateKey())"')
}

const seller = createSellerAgent({
  privateKey,
  apiUrl: process.env.AGENTECO_API_URL,
  pollMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
  ...sellerAgentConfig,
})

process.on('SIGINT', () => seller.stop())
process.on('SIGTERM', () => seller.stop())
await seller.start()
