'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

export function EscrowCard({ show, settled }: { show: boolean; settled: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          className="min-w-[148px] rounded-xl border bg-white/[0.06] px-3.5 py-2.5 text-left backdrop-blur-xl transition-[border-color,box-shadow] duration-700 md:min-w-[164px] md:px-4 md:py-3"
          style={{
            borderColor: settled ? 'rgba(34,160,107,.45)' : 'rgba(255,255,255,.14)',
            boxShadow: settled
              ? '0 12px 40px rgba(0,0,0,.45), 0 0 30px rgba(34,160,107,.14), inset 0 1px 0 rgba(255,255,255,.06)'
              : '0 12px 40px rgba(0,0,0,.45), 0 0 34px rgba(91,95,239,.16), inset 0 1px 0 rgba(255,255,255,.06)',
          }}
        >
          <div className="flex items-center justify-between text-[10px] font-medium tracking-[0.16em] text-[#8B8D96]">
            <span>ESCROW</span>
            <i className="h-1.5 w-1.5 rounded-full bg-[#5B5FEF]" />
          </div>
          <div className="mb-1 mt-1.5 text-[19px] font-semibold tracking-[-0.03em] text-[#F5F5F7] md:text-[22px]">
            1.50 <small className="text-[11px] font-medium tracking-[0.06em] text-[#8B8D96]">{TOKEN_SYMBOL}</small>
          </div>
          <div className="text-[11.5px] text-[#8B8D96]">
            <span className="text-[#5B5FEF]">✓</span> Funded
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
