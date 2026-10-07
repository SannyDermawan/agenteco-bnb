'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/web3/config'
import { AppSidebar } from '@/components/app/AppSidebar'
import { AppTopbar } from '@/components/app/AppTopbar'
import { DemoModeBanner } from '@/components/app/DemoModeBanner'
import { FaucetStrip } from '@/components/app/FaucetStrip'
import { SessionSync } from '@/components/app/SessionGate'

export default function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SessionSync />
        <div className="min-h-screen bg-[#08090D] text-[#F5F5F7]">
          <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="lg:pl-[248px]">
            <AppTopbar onMenuClick={() => setSidebarOpen(true)} />
            <DemoModeBanner />
            <FaucetStrip />
            <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-7 md:py-8">{children}</main>
          </div>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
