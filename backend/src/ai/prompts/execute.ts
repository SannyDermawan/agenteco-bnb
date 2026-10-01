// The execution prompts live in agent-runtime (shared with the SDK, so a self-hosted seller
// can run them on its own model).
export {
  cryptoBriefPrompt,
  dataAnalysisPrompt,
  translationPrompt,
  txExplainerPrompt,
  type Prompt,
} from '../../../../agent-runtime/src/shared/ai/prompts.ts'
