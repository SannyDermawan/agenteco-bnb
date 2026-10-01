import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { prisma } from './db.ts'
import { agentsRouter } from './routes/agents.ts'
import { negotiationsRouter } from './routes/negotiations.ts'
import { ordersRouter } from './routes/orders.ts'
import { escrowResultsRouter } from './routes/escrowResults.ts'
import { escrowsRouter } from './routes/escrows.ts'
import { disputesRouter } from './routes/disputes.ts'
import { tasksRouter } from './routes/tasks.ts'
import { capabilitiesRouter } from './routes/capabilities.ts'
import { ratingsRouter, verificationsRouter } from './routes/ratings.ts'
import { aiCallsRouter } from './ai/aiCallLog.ts'
import { log, logError } from './log.ts'
import { createPublicClient } from 'viem'
import { AGENT_ECO_ADDRESS, NETWORK, assertRpcMatchesNetwork, appChain, appTransport } from './network.ts'
import { FRONTEND_ORIGINS } from './origins.ts'

// PORT is what hosting platforms (Railway, Render, …) inject; API_PORT is the local-dev name.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000)

const app = express()
// Railway's edge proxy is the one hop in front of us — trust it for the client IP (rate limits).
app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({ origin: FRONTEND_ORIGINS, maxAge: 600 }))

// Per client IP. Generous overall (the host polls through here for every
// hosted agent); tight on what creates records or reads the chain.
const limitOptions = { standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests — slow down and try again shortly.' } } as const
app.use(rateLimit({ ...limitOptions, windowMs: 60_000, limit: 3000 }))
const chainLimiter = rateLimit({ ...limitOptions, windowMs: 60_000, limit: 120 })
// Every hosted buyer's task comes from the host's single IP, so tasks get more room than agents.
app.post('/agents', rateLimit({ ...limitOptions, windowMs: 10 * 60_000, limit: 30 }))
app.post('/tasks', rateLimit({ ...limitOptions, windowMs: 10 * 60_000, limit: 300 }))
app.post('/capabilities', rateLimit({ ...limitOptions, windowMs: 10 * 60_000, limit: 10 }))
app.use(['/tasks/:id/escrow', '/escrow-results', '/disputes', '/ratings', '/escrows', '/agents/:id/activate'], (req, res, next) =>
  req.method === 'GET' && !req.originalUrl.startsWith('/escrows') ? next() : chainLimiter(req, res, next)
)

app.use(express.json({ limit: '100kb' }))

app.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`
  res.json({ ok: true, db: 'connected' })
})

app.use('/agents', agentsRouter)
app.use('/negotiations', negotiationsRouter)
app.use('/orders', ordersRouter)
app.use('/escrow-results', escrowResultsRouter)
app.use('/escrows', escrowsRouter)
app.use('/disputes', disputesRouter)
app.use('/tasks', tasksRouter)
app.use('/capabilities', capabilitiesRouter)
app.use('/ratings', ratingsRouter)
app.use('/verifications', verificationsRouter)
app.use('/ai-calls', aiCallsRouter)

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Never send stack traces or internals: client errors keep their own
// message (bad JSON, body too large), everything else is a plain 500.
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = typeof error?.status === 'number' ? error.status : 500
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: error.expose ? error.message : 'Bad request' })
    return
  }
  logError('Request failed', error, 'API')
  res.status(500).json({ error: 'Internal server error' })
}
app.use(errorHandler)

// Refuse to serve a mainnet frontend from a testnet RPC (or vice versa).
assertRpcMatchesNetwork(() => createPublicClient({ chain: appChain, transport: appTransport() }).getChainId()).catch((error) => {
  logError('Network check failed', error, 'API')
  process.exit(1)
})

app.listen(PORT, () => {
  log(`AgentEco API listening on http://localhost:${PORT}`, 'API')
  log(`Network: ${appChain.name} (NETWORK=${NETWORK}), contract ${AGENT_ECO_ADDRESS}`, 'API')
  log(`Allowed frontend origins: ${FRONTEND_ORIGINS.join(', ')}`, 'API')
})

process.on('unhandledRejection', (error) => {
  logError('Unhandled rejection', error, 'API')
})
