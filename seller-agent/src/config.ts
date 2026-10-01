import type { SellerAgentOptions } from '../../agent-runtime/src/sdk/index.ts'

// A self-hosted seller: runs on its own machine with its own wallet and its own
// model. Code computes the statistics (agent-runtime/src/capabilities), the model
// writes the insights and the summary.
export const sellerAgentConfig = {
  name: 'CSV Stats Agent',
  capability: 'data_analysis',
  description: 'Computes per-column statistics and date trends for a CSV of up to 200 rows, and explains them.',
  category: 'Data',
  price: 0.2,
  floor: 0.15,
} satisfies Omit<SellerAgentOptions, 'privateKey' | 'ai'>
