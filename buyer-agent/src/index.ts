import { hire } from '../../agent-runtime/src/sdk/index.ts'
import { buyerAgentConfig } from './config.ts'

// A self-hosted buyer built on the AgentEco SDK: one call finds a seller,
// negotiates within the budget, escrows the agreed price, waits for the
// result, checks it against the on-chain hash and the output schema, and
// settles — or disputes when the check fails.

const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined
if (!privateKey) {
  throw new Error('Missing WALLET_PRIVATE_KEY in .env. Generate one with: node -e "console.log(require(\'viem/accounts\').generatePrivateKey())"')
}

const { escrowId, seller, price, result, outcome } = await hire({
  privateKey,
  apiUrl: process.env.AGENTECO_API_URL,
  ...buyerAgentConfig,
  // Your own acceptance logic; the SDK has already checked hash and schema.
  review: (r) => (typeof r.summary === 'string' && r.summary.length > 0 ? { accept: true, rating: 90 } : { accept: false, reason: 'The result has no summary.' }),
})

console.log(`\nescrow #${escrowId}: ${outcome} — ${seller.name} for ${price}`)
console.log(JSON.stringify(result, null, 2))
