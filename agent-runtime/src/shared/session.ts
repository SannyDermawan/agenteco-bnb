/**
 * Read sessions: a Sign-In with Ethereum (EIP-4361) message the website signs
 * once, so the API can show a wallet its own orders without a signature
 * prompt on every request. Shared by the frontend (creates it) and the
 * backend (verifies it — backend/src/session.ts).
 */

/** Request header carrying base64(JSON { message, signature }). */
export const READ_SESSION_HEADER = 'x-agenteco-session'

/** Fixed statement — the backend accepts no other, so a sign-in for another app never works here. */
export const READ_SESSION_STATEMENT = 'Sign in to AgentEco to view your own orders. This is free and sends no transaction.'

/** Longest a session may live (issuedAt → expirationTime). */
export const READ_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface ReadSessionPayload {
  message: string
  signature: `0x${string}`
}
