import Link from 'next/link'
import { OrderStatusBadge } from './OrderStatus'
import { OnChainStatusBadge } from './OnChainStatusBadge'
import { ArrowRightIcon } from './icons'
import type { Order } from '@/lib/agenteco-data'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

/** Live on-chain status once there is an escrow; the registry's own status before that. */
function StatusCell({ order }: { order: Order }) {
  return order.escrowStatus !== undefined ? <OnChainStatusBadge status={order.escrowStatus} /> : <OrderStatusBadge status={order.status} />
}

function hrefFor(order: Order) {
  return order.href ?? `/app/orders/${order.id.replace('#', '')}`
}

export function OrderTable({ orders }: { orders: Order[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0D0F14]">
      <table className="hidden w-full text-left text-[13px] md:table">
        <thead>
          <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-[0.08em] text-[#8B8D96]">
            <th className="px-5 py-3 font-medium">Order</th>
            <th className="px-5 py-3 font-medium">Buyer</th>
            <th className="px-5 py-3 font-medium">Seller</th>
            <th className="px-5 py-3 font-medium">Service</th>
            <th className="px-5 py-3 font-medium">Amount</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Created</th>
            <th className="px-5 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-white/[0.04] last:border-0">
              <td className="px-5 py-3.5 font-medium text-[#F5F5F7]">{o.id}</td>
              <td className="px-5 py-3.5 text-[#8B8D96]">{o.buyer}</td>
              <td className="px-5 py-3.5 text-[#8B8D96]">{o.seller}</td>
              <td className="px-5 py-3.5 text-[#8B8D96]">{o.service}</td>
              <td className="px-5 py-3.5 text-[#F5F5F7]">{o.amount.toFixed(2)} {TOKEN_SYMBOL}</td>
              <td className="px-5 py-3.5">
                <StatusCell order={o} />
              </td>
              <td className="px-5 py-3.5 text-[#8B8D96]">{o.createdAt}</td>
              <td className="px-5 py-3.5 text-right">
                <Link
                  href={hrefFor(o)}
                  className="inline-flex items-center gap-1 text-[#5B5FEF] hover:text-[#F5F5F7]"
                >
                  View
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="divide-y divide-white/[0.05] md:hidden">
        {orders.map((o) => (
          <Link key={o.id} href={hrefFor(o)} className="block px-4 py-4">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-[#F5F5F7]">{o.id}</span>
              <StatusCell order={o} />
            </div>
            <div className="mt-1.5 text-[12.5px] text-[#8B8D96]">{o.service}</div>
            <div className="mt-2 flex items-center justify-between text-[12px] text-[#8B8D96]">
              <span>
                {o.buyer} → {o.seller}
              </span>
              <span className="text-[#F5F5F7]">{o.amount.toFixed(2)} {TOKEN_SYMBOL}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
