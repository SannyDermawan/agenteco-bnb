import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { appChain } from './chain.ts'
import type { KeeperConfig } from './config.ts'

export function createClients(config: KeeperConfig) {
  const account = privateKeyToAccount(config.keeperPrivateKey)
  const transport = http(config.rpcUrl)

  const publicClient = createPublicClient({ chain: appChain, transport })
  const walletClient = createWalletClient({ account, chain: appChain, transport })

  return { account, publicClient, walletClient }
}

export type Clients = ReturnType<typeof createClients>
