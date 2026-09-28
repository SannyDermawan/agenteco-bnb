import cors from 'cors'
import express from 'express'
import { prisma } from './db.ts'
import { agentsRouter } from './routes/agents.ts'
import { negotiationsRouter } from './routes/negotiations.ts'
import { ordersRouter } from './routes/orders.ts'
import { escrowResultsRouter } from './routes/escrowResults.ts'
import { disputesRouter } from './routes/disputes.ts'
import { tasksRouter } from './routes/tasks.ts'
import { ratingsRouter, verificationsRouter } from './routes/ratings.ts'
import { aiCallsRouter } from './ai/aiCallLog.ts'
import { log, logError } from './log.ts'
import { createPublicClient } from 'viem'
import { AGENT_ECO_ADDRESS, NETWORK, assertRpcMatchesNetwork, appChain, appTransport } from './network.ts'

// PORT is what hosting platforms (Railway, Render, …) inject; API_PORT is the local-dev name.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000)
// Comma-separated, so the custom domain and the *.vercel.app URL can both call the API.
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)

const app = express()
app.use(cors({ origin: FRONTEND_ORIGINS }))
app.use(express.json())

app.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`
  res.json({ ok: true, db: 'connected' })
})

app.use('/agents', agentsRouter)
app.use('/negotiations', negotiationsRouter)
app.use('/orders', ordersRouter)
app.use('/escrow-results', escrowResultsRouter)
app.use('/disputes', disputesRouter)
app.use('/tasks', tasksRouter)
app.use('/ratings', ratingsRouter)
app.use('/verifications', verificationsRouter)
app.use('/ai-calls', aiCallsRouter)

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
