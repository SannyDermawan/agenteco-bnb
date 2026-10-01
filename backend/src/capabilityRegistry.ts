import { prisma } from './db.ts'
import { isCapabilityId } from '../../agent-runtime/src/shared/capabilities/definitions.ts'
import { platformCapabilities, type CapabilityInfo } from '../../agent-runtime/src/shared/capabilities/custom.ts'

/**
 * Looks capabilities up across the open registry: the four platform ones
 * (built into the code) and community ones (the capabilities table). A
 * published capability never changes, so lookups are cached for good.
 */

const PLATFORM = new Map(platformCapabilities().map((c) => [c.id, c]))
const cache = new Map<string, CapabilityInfo>()

function fromRow(row: {
  id: string
  name: string
  description: string
  category: string
  inputSchema: unknown
  outputSchema: unknown
  rubric: string
  ownerWallet: string
  createdAt: Date
}): CapabilityInfo {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    inputSchema: row.inputSchema as Record<string, unknown>,
    outputSchema: row.outputSchema as Record<string, unknown>,
    rubric: row.rubric,
    source: 'community',
    ownerWallet: row.ownerWallet,
    createdAt: row.createdAt.toISOString(),
  }
}

/** A capability by id, platform or community; null when nobody published it. */
export async function getCapability(id: string): Promise<CapabilityInfo | null> {
  const known = PLATFORM.get(id) ?? cache.get(id)
  if (known) return known
  if (isCapabilityId(id)) return null
  const row = await prisma.capability.findUnique({ where: { id } })
  if (!row) return null
  const info = fromRow(row)
  cache.set(id, info)
  return info
}

/** The ids in `ids` that are neither platform nor published capabilities. */
export async function unknownCapabilities(ids: string[]): Promise<string[]> {
  const unknown: string[] = []
  for (const id of ids) if (!(await getCapability(id))) unknown.push(id)
  return unknown
}

/** Every capability: the platform ones first, then the community's, newest first. */
export async function listCapabilities(): Promise<CapabilityInfo[]> {
  const rows = await prisma.capability.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  return [...PLATFORM.values(), ...rows.map(fromRow)]
}
