import { createPublicClient, parseUnits, formatEther, type Address } from 'viem'
import { ERC20_ABI } from '../../agent-runtime/src/onchain/abi.ts'
import { HOSTED_MIN_GAS, NATIVE_SYMBOL, TOKEN_SYMBOL, USDT_ADDRESS, appChain, appTransport } from './network.ts'


// Buyer: enough for createEscrow + approve + fundEscrow + accept/dispute + rating + refund.
// Seller: enough for a handful of startExecution + markDelivered + dispute-response + payout rounds.
// Per network (HOSTED_MIN_GAS), below the frontend's activation top-up.

const publicClient = createPublicClient({ chain: appChain, transport: appTransport() })

export async function getChainHead(): Promise<bigint> {
  return publicClient.getBlockNumber()
}

/** Pass requiredUsdt = '0' for a hosted seller — it only needs gas, not a budget. */
export async function checkHostedDeposit(
  walletAddress: Address,
  requiredUsdt: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const decimals = await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'decimals',
  })
  const requiredAmount = parseUnits(requiredUsdt, decimals)

  const [usdtBalance, gasBalance] = await Promise.all([
    publicClient.readContract({ address: USDT_ADDRESS, abi: ERC20_ABI, functionName: 'balanceOf', args: [walletAddress] }),
    publicClient.getBalance({ address: walletAddress }),
  ])

  if (usdtBalance < requiredAmount) {
    return { ok: false, error: `Agent wallet has not received the required ${requiredUsdt} ${TOKEN_SYMBOL} deposit yet.` }
  }
  if (gasBalance < parseUnits(HOSTED_MIN_GAS, 18)) {
    return {
      ok: false,
      error: `Agent wallet needs at least ${HOSTED_MIN_GAS} ${NATIVE_SYMBOL} for gas (has ${formatEther(gasBalance)}).`,
    }
  }

  return { ok: true }
}
