import { z } from 'zod'
import { CAPABILITIES, CAPABILITY_IDS, isCapabilityId, type CapabilityId } from './definitions.ts'

/**
 * The open capability registry: besides the four platform capabilities
 * (./definitions.ts), developers publish their own — an id, what it does, a
 * JSON Schema for the buyer's brief and one for the result, and the rubric a
 * verifier judges a delivery by. Self-hosted sellers (the SDK) can then offer
 * them, and buyers hire them like any other: the brief is checked against the
 * input schema before the escrow is created, the result against the output
 * schema before it is accepted.
 *
 * Schemas are plain JSON Schema (draft 2020-12 subset), compiled to zod with
 * z.fromJSONSchema. A capability is immutable once published — tasks commit to
 * it — so a changed schema is a new id (e.g. "sentiment_v2").
 */

export const CUSTOM_CAPABILITY_ID = /^[a-z][a-z0-9_]{2,39}$/
/** Largest JSON Schema accepted, serialized. */
export const MAX_SCHEMA_CHARS = 8_000

export const CUSTOM_CATEGORIES = ['Research', 'Data', 'Content', 'Automation'] as const

/** A JSON Schema whose root describes an object, small and self-contained. */
const jsonSchemaObject = z
  .record(z.string(), z.unknown())
  .superRefine((schema, ctx) => {
    if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS) {
      ctx.addIssue({ code: 'custom', message: `schema is larger than ${MAX_SCHEMA_CHARS} characters` })
      return
    }
    if (schema.type !== 'object') {
      ctx.addIssue({ code: 'custom', message: 'the schema root must be {"type": "object", …}' })
      return
    }
    const compiled = compileSchema(schema)
    if (!compiled.ok) ctx.addIssue({ code: 'custom', message: compiled.error })
  })

export const registerCapabilitySchema = z.object({
  id: z
    .string()
    .regex(CUSTOM_CAPABILITY_ID, 'id: 3–40 characters, lowercase letters, digits and _, starting with a letter')
    .refine((id) => !isCapabilityId(id), 'that id belongs to a platform capability'),
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().min(10).max(500),
  category: z.enum(CUSTOM_CATEGORIES).default('Automation'),
  inputSchema: jsonSchemaObject,
  outputSchema: jsonSchemaObject,
  rubric: z.string().trim().min(10).max(1000),
})

export type RegisterCapabilityInput = z.input<typeof registerCapabilitySchema>

/** A capability as the registry lists it — platform or community. */
export interface CapabilityInfo {
  id: string
  name: string
  description: string
  category: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  rubric: string
  /** 'platform' = built in (hosted agents can run it); 'community' = published through the registry. */
  source: 'platform' | 'community'
  /** Who published it (community capabilities only). */
  ownerWallet?: string
  createdAt?: string
}

/** Compiles a JSON Schema to a zod validator, or explains why it can't be used. */
export function compileSchema(schema: unknown): { ok: true; schema: z.ZodType } | { ok: false; error: string } {
  try {
    return { ok: true, schema: z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]) }
  } catch (error) {
    return { ok: false, error: `invalid JSON Schema: ${(error as Error).message}` }
  }
}

/** Checks a value against a JSON Schema. */
export function validateWithSchema(schema: unknown, value: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  const compiled = compileSchema(schema)
  if (!compiled.ok) return compiled
  const parsed = compiled.schema.safeParse(value)
  if (parsed.success) return { ok: true, data: parsed.data }
  return {
    ok: false,
    error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
  }
}

/**
 * A starting value shaped like a schema — what a brief editor is prefilled
 * with: defaults and first enum values where given, else empty strings, 0,
 * false and []. Only the object's required fields are included.
 */
export function exampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 6) return null
  const s = schema as Record<string, unknown>
  if ('default' in s) return s.default
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]
  if ('const' in s) return s.const
  switch (s.type) {
    case 'object': {
      const props = (s.properties ?? {}) as Record<string, unknown>
      const required = Array.isArray(s.required) ? (s.required as string[]) : Object.keys(props)
      return Object.fromEntries(required.filter((k) => k in props).map((k) => [k, exampleFromSchema(props[k], depth + 1)]))
    }
    case 'array':
      return []
    case 'number':
    case 'integer':
      return typeof s.minimum === 'number' ? s.minimum : 0
    case 'boolean':
      return false
    case 'string':
      return ''
    default:
      return null
  }
}

/** The four platform capabilities, in the registry's shape (their zod schemas as JSON Schema). */
export function platformCapabilities(): CapabilityInfo[] {
  return CAPABILITY_IDS.map((id: CapabilityId) => {
    const c = CAPABILITIES[id]
    return {
      id,
      name: c.label,
      description: c.description,
      category: c.category,
      inputSchema: z.toJSONSchema(c.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
      outputSchema: z.toJSONSchema(c.output, { unrepresentable: 'any' }) as Record<string, unknown>,
      rubric: c.rubric,
      source: 'platform' as const,
    }
  })
}
