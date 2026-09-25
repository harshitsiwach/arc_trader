/** P1 betting API client. Demo ledger — P2 replaces deposit/bets with Arc USDC. */
const BASE = (import.meta.env.VITE_BETTING_API_URL as string | undefined) ?? 'http://localhost:8787'

export interface BetProduct {
  id: string
  label: string
  coin: string
  durationSec: number
  entryCutoffSec: number
  payout: number
  feePct: number
  minBet: number
}

export interface BetRound {
  id: string
  productId: string
  coin: string
  payout: number
  openAt: number
  lockAt: number
  expiresAt: number
  refPrice: number | null
  settlePrice: number | null
  result: 'up' | 'down' | 'push' | 'void' | null
  status: 'open' | 'locked' | 'settled' | 'void'
  upStakes: number
  downStakes: number
  signature: string | null
}

export interface Bet {
  id: string
  user: string
  round: string
  side: 'up' | 'down'
  stake: number
  status: 'live' | 'won' | 'lost' | 'push' | 'void'
  payout?: number
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json()
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`)
  return body as T
}

export const getProducts = () => req<{ products: BetProduct[] }>('/api/products')
export const getRounds = (product: string) =>
  req<{ time: number; rounds: BetRound[] }>(`/api/rounds?product=${product}`)
export const placeBet = (user: string, roundId: string, side: 'up' | 'down', stake: number) =>
  req<{ bet: Bet; balance: number }>('/api/bets', {
    method: 'POST',
    body: JSON.stringify({ user, roundId, side, stake }),
  })
export const deposit = (user: string, amount: number) =>
  req<{ balance: number; demo: boolean }>('/api/deposit', { method: 'POST', body: JSON.stringify({ user, amount }) })
export const getAccount = (user: string) =>
  req<{ user: string; balance: number; bets: Bet[]; demo: boolean }>(`/api/account/${encodeURIComponent(user)}`)

export function getUserId(): string {
  let id = localStorage.getItem('bet-user')
  if (!id) {
    id = 'player-' + Math.random().toString(36).slice(2, 8)
    localStorage.setItem('bet-user', id)
  }
  return id
}
