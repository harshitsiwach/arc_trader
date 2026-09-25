import { createPublicClient, http } from 'viem'
import { arcTestnet } from 'viem/chains'
import vaultAbi from './abi-Vault.json'
import roundsAbi from './abi-Rounds.json'

export const VAULT_ADDR = ((
  import.meta.env.VITE_VAULT_ADDR as string | undefined
) ?? '0x92Bdf0aC7E33FF4D2ae6026c370b893dcd47Dc2c') as `0x${string}`
export const ROUNDS_ADDR = ((
  import.meta.env.VITE_ROUNDS_ADDR as string | undefined
) ?? '0xCe10F9bed67F23814f5304931cB554beE3bcCD54') as `0x${string}`
export const USDC_ADDR = '0x3600000000000000000000000000000000000000' as `0x${string}`
export const MIN_BET_USDC = 0.1
export const MAX_BET_CAP_USDC = 1.0

export { vaultAbi, roundsAbi }

/** Minimal ERC-20 surface (approve / balanceOf / allowance) for USDC. */
export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const RPC = (import.meta.env.VITE_ARC_TESTNET_RPC as string | undefined) ?? 'https://rpc.testnet.arc.io'

export const testnetClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC),
})

/** USDC dollars -> base units (6dp). */
export const toBase = (usdc: number): bigint => BigInt(Math.floor(usdc * 1e6))
/** Base units -> dollars. */
export const fromBase = (v: bigint): number => Number(v) / 1e6

export interface OnchainRound {
  id: bigint
  coin: string
  lockAt: number
  expiresAt: number
  payoutBps: number
  feeBps: number
  maxLiability: bigint
  maxBet: bigint
  status: number // 0 open, 1 locked, 2 settled, 3 void
  result: number // 0 none, 1 up, 2 down, 3 push
  refPrice: bigint
  settlePrice: bigint
  upStakes: bigint
  downStakes: bigint
}

export interface OnchainBet {
  id: bigint
  user: string
  roundId: bigint
  up: boolean
  stake: bigint
  fee: bigint
  claimed: boolean
}

export async function readRound(id: bigint): Promise<OnchainRound> {
  const r = (await testnetClient.readContract({
    address: ROUNDS_ADDR as `0x${string}`,
    abi: roundsAbi,
    functionName: 'rounds',
    args: [id],
  })) as unknown as [string, bigint, bigint, number, number, bigint, bigint, number, number, number, bigint, bigint, bigint, bigint]
  return {
    id,
    coin: r[0],
    lockAt: Number(r[1]),
    expiresAt: Number(r[2]),
    payoutBps: r[3],
    feeBps: r[4],
    maxLiability: r[5],
    maxBet: r[6],
    status: r[8],
    result: r[9],
    refPrice: r[10],
    settlePrice: r[11],
    upStakes: r[12],
    downStakes: r[13],
  }
}

export async function readBet(id: bigint): Promise<OnchainBet> {
  const b = (await testnetClient.readContract({
    address: ROUNDS_ADDR as `0x${string}`,
    abi: roundsAbi,
    functionName: 'bets',
    args: [id],
  })) as unknown as [string, bigint, boolean, bigint, bigint, boolean]
  return { id, user: b[0], roundId: b[1], up: b[2], stake: b[3], fee: b[4], claimed: b[5] }
}

const BET_KEY = 'ob-bet-ids'
export function loadBetIds(): bigint[] {
  try {
    return (JSON.parse(localStorage.getItem(BET_KEY) ?? '[]') as (string | number)[]).map(BigInt).slice(-30)
  } catch {
    return []
  }
}
export function saveBetId(id: bigint) {
  try {
    const ids = loadBetIds()
    ids.push(id)
    localStorage.setItem(BET_KEY, JSON.stringify(ids.slice(-30).map(String)))
  } catch {
    // private mode — ignore
  }
}
