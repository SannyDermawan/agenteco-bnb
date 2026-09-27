// Each process (API, host, keeper) tags its own lines; set once at startup.
let processTag = 'KEEPER'

export function setLogTag(tag: string): void {
  processTag = tag
}

export function log(message: string, prefix = processTag): void {
  console.log(`[${prefix}] ${message}`)
}

export function logError(message: string, error?: unknown, prefix = processTag): void {
  console.error(`[${prefix}] ${message}`, error instanceof Error ? error.message : error)
}
