import type { AgentConfig } from '../../agent-runtime/src/types.ts'

// A self-hosted seller: runs on its own machine with its own wallet, and
// executes jobs with the shared capability code (agent-runtime/src/capabilities).
// It has no model of its own, so it offers a capability that still has a
// useful code-only result — translation needs a model and can't be served here.
export const sellerAgentConfig: AgentConfig = {
  name: 'CSV Stats Agent',
  role: 'seller',
  capabilities: ['data_analysis'],
  description: 'Computes per-column statistics and date trends for a CSV of up to 200 rows.',
  category: 'Data',
  service: 'Data Analysis',
  basePrice: 0.2,
  minimumPrice: 0.15,
}
