import { useEffect, useState } from 'react'
import {
  CURATED,
  categorize,
  fetchAllMids,
  fetchMetaMarkets,
  stripDex,
  type Market,
} from '../lib/hyperliquid'

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [mids, setMids] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [native, xyz, nativeMids, xyzMids] = await Promise.all([
          fetchMetaMarkets(''),
          fetchMetaMarkets('xyz').catch(() => [] as Market[]),
          fetchAllMids('').catch(() => ({}) as Record<string, string>),
          fetchAllMids('xyz').catch(() => ({}) as Record<string, string>),
        ])
        if (cancelled) return
        const byCoin = new Map<string, Market>()
        for (const m of [...native, ...xyz]) byCoin.set(m.coin, m)

        // Merge mids snapshots (keys may be prefixed or bare — try both)
        const applyMids = (all: Record<string, string>) => {
          for (const [k, v] of Object.entries(all)) {
            const hit =
              byCoin.get(k) ??
              byCoin.get(`xyz:${k}`) ??
              [...byCoin.values()].find((m) => stripDex(m.coin) === stripDex(k))
            if (hit) hit.markPx = v
          }
        }
        applyMids(nativeMids)
        applyMids(xyzMids)

        // Curated first (in CURATED order), then rest of universe alphabetically
        const curatedSet = new Set(CURATED.map((c) => c.coin))
        const curated: Market[] = []
        for (const c of CURATED) {
          const m = byCoin.get(c.coin) ?? byCoin.get(stripDex(c.coin))
          if (m) curated.push(m)
          else curated.push({ coin: c.coin, base: stripDex(c.coin), dex: c.dex, category: c.category })
        }
        const rest = [...byCoin.values()]
          .filter((m) => !curatedSet.has(m.coin))
          .sort((a, b) => a.base.localeCompare(b.base))
        setMarkets([...curated, ...rest])
        setMids({ ...nativeMids, ...xyzMids })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load markets')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Live tick application from WS
  const applyTick = (coin: string, px: string) => {
    setMids((prev) => (prev[coin] === px ? prev : { ...prev, [coin]: px }))
    setMarkets((prev) => {
      const i = prev.findIndex((m) => m.coin === coin || stripDex(m.coin) === stripDex(coin))
      if (i < 0) return prev
      if (prev[i].markPx === px) return prev
      const next = [...prev]
      next[i] = { ...next[i], markPx: px }
      return next
    })
  }

  return { markets, mids, loading, error, applyTick }
}

// Re-export for callers that need ad-hoc categorization
export { categorize }
