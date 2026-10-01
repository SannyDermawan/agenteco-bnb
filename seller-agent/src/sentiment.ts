import { createSellerAgent, registerCapability, resolveCapability, DEFAULT_API_URL } from '../../agent-runtime/src/sdk/index.ts'

/**
 * A seller for a community capability — one that is not built into AgentEco.
 * On first run it publishes "sentiment_score" to the open capability registry
 * (if nobody has yet), then sells it with its own handler: a tiny word-list
 * scorer, so it runs without any model or API key.
 *
 *   WALLET_PRIVATE_KEY=0x… npm run sentiment
 */

const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined
if (!privateKey) throw new Error('Missing WALLET_PRIVATE_KEY in .env.')
const apiUrl = process.env.AGENTECO_API_URL ?? DEFAULT_API_URL

const CAPABILITY = 'sentiment_score'

// 1. Make sure the capability exists in the registry.
try {
  await resolveCapability(apiUrl, CAPABILITY)
} catch {
  await registerCapability(
    privateKey,
    {
      id: CAPABILITY,
      name: 'Sentiment score',
      description: 'Scores how positive or negative a text is, from -1 to 1, with a one-line reason.',
      category: 'Content',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          score: { type: 'number', minimum: -1, maximum: 1 },
          label: { enum: ['negative', 'neutral', 'positive'] },
          reason: { type: 'string', maxLength: 300 },
        },
        required: ['score', 'label', 'reason'],
      },
      rubric: 'The label agrees with the score, the score fits the tone of the text, and the reason quotes words from the text.',
    },
    apiUrl
  )
  console.log(`published "${CAPABILITY}" in the capability registry`)
}

// 2. Sell it.
const POSITIVE = ['good', 'great', 'love', 'excellent', 'happy', 'fast', 'helpful', 'amazing', 'easy', 'recommend']
const NEGATIVE = ['bad', 'slow', 'hate', 'terrible', 'broken', 'poor', 'awful', 'bug', 'expensive', 'refund']

const seller = createSellerAgent({
  privateKey,
  apiUrl,
  name: 'Sentiment Scorer',
  description: 'Scores the sentiment of reviews, tickets and posts — word-list based, instant.',
  capability: CAPABILITY,
  category: 'Content',
  price: 0.06,
  floor: 0.04,
  async handle(job) {
    const { text } = job.brief as { text: string }
    const words = text.toLowerCase().match(/[a-z']+/g) ?? []
    const pos = words.filter((w) => POSITIVE.includes(w))
    const neg = words.filter((w) => NEGATIVE.includes(w))
    const score = pos.length + neg.length === 0 ? 0 : (pos.length - neg.length) / (pos.length + neg.length)
    const label = score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral'
    const quoted = [...pos, ...neg].slice(0, 4).map((w) => `"${w}"`).join(', ')
    return {
      score: Math.round(score * 100) / 100,
      label,
      reason: quoted ? `Tone words found: ${quoted}.` : 'No clearly positive or negative words found.',
    }
  },
  async respondToDispute({ result, reason }) {
    return `The score follows the tone words in the text (${String(result.reason)}). Buyer's concern: ${reason ?? 'not given'}.`
  },
})

process.on('SIGINT', () => seller.stop())
process.on('SIGTERM', () => seller.stop())
await seller.start()
