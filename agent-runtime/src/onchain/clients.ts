import { createPublicClient, createWalletClient, http, nonceManager, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { appChain } from './chain.ts'
import { RPC_URL, appTransport } from '../network.ts'

export function createOnchainClients(privateKey: `0x${string}`, rpcUrl = RPC_URL) {
  // Load-balanced public RPCs can report a stale pending nonce right after a
  // transaction; the nonce manager keeps its own count so back-to-back
  // transactions from one wallet never reuse a nonce.
  const account = privateKeyToAccount(privateKey, { nonceManager })
  // The default RPC comes with its fallbacks; an explicit one is used alone.
  const transport = rpcUrl === RPC_URL ? appTransport() : http(rpcUrl)

  const publicClient = createPublicClient({ chain: appChain, transport })
  const walletClient = createWalletClient({ account, chain: appChain, transport })

  return { account, publicClient, walletClient }
}

export type OnchainClients = ReturnType<typeof createOnchainClients>
export type { Address }
