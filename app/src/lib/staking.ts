import { createPublicClient, http } from 'viem'
import { arcTestnet } from 'viem/chains'

/** Filled with real addresses after the Studio deploy; empty = not deployed yet. */
export const STAKE_VAULT_ADDR = (
  import.meta.env.VITE_STAKE_VAULT_ADDR as string | undefined
) ?? ''
export const REWARD_TOKEN_ADDR = (
  import.meta.env.VITE_REWARD_TOKEN_ADDR as string | undefined
) ?? ''

export const isStakingLive = STAKE_VAULT_ADDR.startsWith('0x') && REWARD_TOKEN_ADDR.startsWith('0x')

const RPC = (import.meta.env.VITE_ARC_TESTNET_RPC as string | undefined) ?? 'https://rpc.testnet.arc.io'

export const stakingClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC),
})

/** Minimal StakeVault surface — must match the curated Studio interface exactly. */
export const stakeVaultAbi = [
  { type: 'function', name: 'stake', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claimRewards', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'earlyExit', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'unstake', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'stakedBalance', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'accruedRewards', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'unlockTime', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalStaked', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalDeployed', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'treasury', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'REWARD_RATE', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const

export const VAULT = STAKE_VAULT_ADDR as `0x${string}`
export const HBLK = REWARD_TOKEN_ADDR as `0x${string}`

export const fromU6 = (v: bigint): number => Number(v) / 1e6
export const toU6 = (usdc: number): bigint => BigInt(Math.floor(usdc * 1e6))
export const fromWad = (v: bigint): number => Number(v) / 1e18
