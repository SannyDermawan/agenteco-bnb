import { createPublicClient, createWalletClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { appChain } from './chain.ts'
import { RPC_URL, appTransport } from '../network.ts'

export function createOnchainClients(privateKey: `0x${string}`, rpcUrl = RPC_URL) {
  const account = privateKeyToAccount(privateKey)
  // The default RPC comes with its fallbacks; an explicit one is used alone.
  const transport = rpcUrl === RPC_URL ? appTransport() : http(rpcUrl)

  const publicClient = createPublicClient({ chain: appChain, transport })
  const walletClient = createWalletClient({ account, chain: appChain, transport })

  return { account, publicClient, walletClient }
}

export type OnchainClients = ReturnType<typeof createOnchainClients>
export type { Address }
