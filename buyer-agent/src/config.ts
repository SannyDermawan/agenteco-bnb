import type { AgentConfig } from '../../agent-runtime/src/types.ts'

// A self-hosted buyer: hires a data_analysis seller for the brief below. The
// brief must match that capability's input schema
// (agent-runtime/src/shared/capabilities/definitions.ts) — it is what the
// seller executes and what the escrow's taskHash commits to.
export const buyerAgentConfig: AgentConfig = {
  name: 'Agent D',
  role: 'buyer',
  capabilities: ['data_analysis'],
  description: 'Demo buyer agent — discovers services and negotiates on your behalf.',
  basePrice: 0.15,
  maxBudget: 1,
  taskBrief: {
    csv: 'date,visitors,signups\n2026-09-01,120,8\n2026-09-02,135,11\n2026-09-03,128,9\n2026-09-04,160,14\n2026-09-05,172,15',
    question: 'Are signups growing faster than visitors?',
  },
  acceptanceCriteria: 'Report mean and max for every numeric column, and answer the question.',
}
