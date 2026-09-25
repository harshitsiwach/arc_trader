import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deposit,
  getAccount,
  getProducts,
  getRounds,
  getUserId,
  placeBet,
  type Bet,
  type BetProduct,
  type BetRound,
} from '../lib/betting'

/** Polls the P1 engine: products once, rounds every 2s, local 250ms clock for countdowns. */
export function useBetting() {
  const [user] = useState(getUserId)
  const [products, setProducts] = useState<BetProduct[]>([])
  const [productId, setProductId] = useState('flash-10s')
  const [rounds, setRounds] = useState<BetRound[]>([])
  const [serverTime, setServerTime] = useState(Date.now())
  const [balance, setBalance] = useState<number | null>(null)
  const [myBets, setMyBets] = useState<Bet[]>([])
  const [online, setOnline] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const productRef = useRef(productId)
  productRef.current = productId

  useEffect(() => {
    getProducts()
      .then((r) => {
        setProducts(r.products)
        setOnline(true)
      })
      .catch(() => setOnline(false))
  }, [])

  const refreshRounds = useCallback(async () => {
    try {
      const r = await getRounds(productRef.current)
      setRounds(r.rounds)
      setServerTime(r.time)
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  const refreshAccount = useCallback(async () => {
    try {
      const a = await getAccount(user)
      setBalance(a.balance)
      setMyBets(a.bets)
    } catch {
      // engine offline — keep stale
    }
  }, [user])

  useEffect(() => {
    refreshRounds()
    refreshAccount()
    const t = setInterval(refreshRounds, 2000)
    return () => clearInterval(t)
  }, [refreshRounds, refreshAccount, productId])

  // Local clock for smooth countdowns between polls.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const skew = now - serverTime // client/server clock delta approx

  const bet = useCallback(
    async (roundId: string, side: 'up' | 'down', stake: number) => {
      setNotice(null)
      try {
        const out = await placeBet(user, roundId, side, stake)
        setBalance(out.balance)
        await Promise.all([refreshRounds(), refreshAccount()])
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'bet failed')
      }
    },
    [user, refreshRounds, refreshAccount],
  )

  const faucet = useCallback(async () => {
    setNotice(null)
    try {
      const out = await deposit(user, 1000)
      setBalance(out.balance)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'faucet failed')
    }
  }, [user])

  /** Manual reconnect attempt for the offline popup. Returns true when back online. */
  const retry = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([
        getRounds(productRef.current),
        getAccount(user),
      ])
      setRounds(r.rounds)
      setServerTime(r.time)
      setBalance(a.balance)
      setMyBets(a.bets)
      setProducts((prev) => prev) // keep products; refreshed on mount
      setOnline(true)
      try {
        const p = await getProducts()
        setProducts(p.products)
      } catch {
        // rounds+account are enough to trade
      }
      return true
    } catch {
      setOnline(false)
      return false
    }
  }, [user])

  const notify = useCallback((msg: string | null) => setNotice(msg), [])

  const openRound = rounds.find((r) => r.status === 'open') ?? null
  const lastSettled = rounds.find((r) => r.status === 'settled' || r.status === 'void') ?? null

  return {
    user, products, productId, setProductId,
    openRound, lastSettled, rounds,
    balance, myBets, online, notice, notify,
    now: serverTime + skew, bet, faucet, retry, refreshAccount,
  }
}
