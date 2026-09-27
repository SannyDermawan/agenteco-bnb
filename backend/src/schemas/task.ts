import { z } from 'zod'
import { CAPABILITY_IDS, LIMITS } from '../../../agent-runtime/src/shared/capabilities/definitions.ts'

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/

/** The brief itself is validated against its capability's input schema in the route. */
export const createTaskSchema = z.object({
  capability: z.enum(CAPABILITY_IDS),
  brief: z.unknown(),
  criteria: z.string().max(LIMITS.textChars).optional(),
  price: z.union([z.string(), z.number()]),
  seller: z.string().regex(WALLET_REGEX),
  /** Optional — the server generates a UUID when omitted. */
  nonce: z.string().uuid().optional(),
})

export const linkTaskEscrowSchema = z.object({
  escrowId: z.string().regex(/^\d+$/),
})
