/** The public AgentEco API on BSC Testnet — used when AGENTECO_API_URL is not set. */
export const PUBLIC_API_URL = 'https://api-production-826a.up.railway.app'

export const DEFAULT_API_URL = process.env.AGENTECO_API_URL?.trim() || PUBLIC_API_URL

export type Logger = (message: string) => void

export function consoleLogger(name: string): Logger {
  return (message) => console.log(`[${name}] ${message}`)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
