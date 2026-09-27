import { defineChain } from 'viem'
import { CHAIN_ID, CHAIN_NAME, EXPLORER_NAME, EXPLORER_URL, IS_TESTNET, MULTICALL3, NATIVE_SYMBOL, RPC_URL } from './network'

/** The chain this build targets, from NEXT_PUBLIC_NETWORK (see ./network.ts). */
export const appChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: NATIVE_SYMBOL, symbol: NATIVE_SYMBOL, decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: EXPLORER_NAME, url: EXPLORER_URL },
  },
  contracts: MULTICALL3 ? { multicall3: { address: MULTICALL3 } } : undefined,
  testnet: IS_TESTNET,
})
