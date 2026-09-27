// Deployment addresses come from ../network.ts (NETWORK + env), not hardcoded.
export { AGENT_ECO_ADDRESS, USDT_ADDRESS } from '../network.ts'

// Escrow windows come from env, validated against the contract at startup.
export { EXECUTION_WINDOW_SECONDS, REVIEW_WINDOW_SECONDS } from '../durations.ts'

// The full AgentEco.sol ABI, generated from the Foundry build (scripts/gen-abi.mjs).
export { AGENT_ECO_ABI, MOCK_USDT_ABI } from '../shared/abi.generated.ts'

export const ERC20_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

/** Mirrors AgentEco.sol's `OrderStatus` enum ordering exactly. */
export const ON_CHAIN_STATUS = ['CREATED', 'FUNDED', 'EXECUTING', 'DELIVERED', 'DISPUTED', 'SETTLED', 'REFUNDED'] as const
export type OnChainStatus = (typeof ON_CHAIN_STATUS)[number]

export function onChainStatusLabel(status: number): OnChainStatus {
  return ON_CHAIN_STATUS[status] ?? 'CREATED'
}
