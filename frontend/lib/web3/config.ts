import { createConfig, fallback, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { appChain } from './chain'
import { RPC_URLS } from './network'

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: {
    // The public RPC can go quiet for minutes; fail over instead of hanging.
    [appChain.id]: fallback(RPC_URLS.map((url) => http(url, { timeout: 10_000, retryCount: 1 }))),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
