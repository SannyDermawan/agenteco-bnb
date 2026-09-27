import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { appChain } from './chain'

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: {
    [appChain.id]: http(appChain.rpcUrls.default.http[0]),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
