/** Kit chain names <-> wagmi chain ids for CCTP bridge + swap. */
export interface KitChain {
  kit: string
  id: 5042 | 5042002 | 84532 | 11155111 | 1 | 8453
  label: string
}

export const TESTNET_CHAINS: KitChain[] = [
  { kit: 'Arc_Testnet', id: 5042002, label: 'Arc Testnet' },
  { kit: 'Base_Sepolia', id: 84532, label: 'Base Sepolia' },
  { kit: 'Ethereum_Sepolia', id: 11155111, label: 'Ethereum Sepolia' },
]

export const MAINNET_CHAINS: KitChain[] = [
  { kit: 'Arc', id: 5042, label: 'Arc' },
  { kit: 'Base', id: 8453, label: 'Base' },
  { kit: 'Ethereum', id: 1, label: 'Ethereum' },
]

export const ALL_KIT_CHAINS: KitChain[] = [...TESTNET_CHAINS, ...MAINNET_CHAINS]

export function kitNameForChainId(id: number | undefined): string | null {
  return ALL_KIT_CHAINS.find((c) => c.id === id)?.kit ?? null
}
