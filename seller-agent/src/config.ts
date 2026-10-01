import type { SellerAgentOptions } from '../../agent-runtime/src/sdk/index.ts'

// A self-hosted seller: runs on its own machine with its own wallet, and
// executes jobs with the shared capability code (agent-runtime/src/capabilities).
// It has no model of its own, so it offers a capability that still has a
// useful code-only result — translation needs a model and can't be served here.
export const sellerAgentConfig = {
  name: 'CSV Stats Agent',
  capability: 'data_analysis',
  description: 'Computes per-column statistics and date trends for a CSV of up to 200 rows.',
  category: 'Data',
  price: 0.2,
  floor: 0.15,
} satisfies Omit<SellerAgentOptions, 'privateKey'>
