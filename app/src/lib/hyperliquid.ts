export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'

export const XYZ_DEX = 'xyz'

export type Category = 'crypto' | 'stocks' | 'commodities' | 'indices' | 'forex'

export interface Market {
  coin: string // dex-prefixed for HIP-3, e.g. "xyz:TSLA", plain for native e.g. "BTC"
  base: string // display symbol without prefix
  dex: '' | 'xyz'
  category: Category
  maxLeverage?: number
  markPx?: string
  oraclePx?: string
  funding?: string
  openInterest?: string
}

// Curated default (~20). Full universe from meta() powers search.
export const CURATED: { coin: string; dex: '' | 'xyz'; category: Category }[] = [
  { coin: 'BTC', dex: '', category: 'crypto' },
  { coin: 'ETH', dex: '', category: 'crypto' },
  { coin: 'HYPE', dex: '', category: 'crypto' },
  { coin: 'SOL', dex: '', category: 'crypto' },
  { coin: 'xyz:TSLA', dex: 'xyz', category: 'stocks' },
  { coin: 'xyz:NVDA', dex: 'xyz', category: 'stocks' },
  { coin: 'xyz:AAPL', dex: 'xyz', category: 'stocks' },
  { coin: 'xyz:MSFT', dex: 'xyz', category: 'stocks' },
  { coin: 'xyz:META', dex: 'xyz', category: 'stocks' },
  { coin: 'xyz:PLTR', dex: 'xyz', category: 'stocks' },
  { coin: 'xyz:GOLD', dex: 'xyz', category: 'commodities' },
  { coin: 'xyz:SILVER', dex: 'xyz', category: 'commodities' },
  { coin: 'xyz:CL', dex: 'xyz', category: 'commodities' },
  { coin: 'xyz:BRENTOIL', dex: 'xyz', category: 'commodities' },
  { coin: 'xyz:COPPER', dex: 'xyz', category: 'commodities' },
  { coin: 'xyz:NATGAS', dex: 'xyz', category: 'commodities' },
  { coin: 'xyz:SP500', dex: 'xyz', category: 'indices' },
  { coin: 'xyz:XYZ100', dex: 'xyz', category: 'indices' },
  { coin: 'xyz:JP225', dex: 'xyz', category: 'indices' },
  { coin: 'xyz:EUR', dex: 'xyz', category: 'forex' },
]

const COMMODITY_RE = /^(GOLD|SILVER|COPPER|PLATINUM|PALLADIUM|BRENTOIL|CL|NATGAS|ALUMINIUM|URANIUM|WHEAT|CORN|TTF)$/
const INDEX_RE = /^(SP500|XYZ100|JP225|KR200|USAR|EWJ|EWY|EWZ|EWT|DRAM|VOL|MAGS|SMH|XLE|SOXL|NCLD|LYTE)$/
const FOREX_RE = /^(EUR|GBP|JPY|DXY)$/

export function categorize(base: string, dex: '' | 'xyz'): Category {
  if (dex === '') return 'crypto'
  const b = base.toUpperCase()
  if (COMMODITY_RE.test(b)) return 'commodities'
  if (INDEX_RE.test(b)) return 'indices'
  if (FOREX_RE.test(b)) return 'forex'
  return 'stocks'
}

export function stripDex(coin: string): string {
  const i = coin.indexOf(':')
  return i >= 0 ? coin.slice(i + 1) : coin
}

async function postInfo<T>(body: unknown): Promise<T> {
  const res = await fetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Hyperliquid info ${res.status}`)
  return res.json() as Promise<T>
}

interface MetaUniverseEntry {
  name: string
  maxLeverage?: number
  isDelisted?: boolean
}
interface AssetCtx {
  markPx?: string
  oraclePx?: string
  funding?: string
  openInterest?: string
}

export async function fetchMetaMarkets(dex: '' | 'xyz'): Promise<Market[]> {
  const body = dex === '' ? { type: 'metaAndAssetCtxs' } : { type: 'metaAndAssetCtxs', dex }
  const [meta, ctxs] = (await postInfo<[ { universe: MetaUniverseEntry[] }, AssetCtx[]]>(body)) as [
    { universe: MetaUniverseEntry[] },
    AssetCtx[],
  ]
  return meta.universe
    .map((u, i) => ({ u, ctx: ctxs[i] }))
    .filter(({ u }) => !u.isDelisted)
    .map(({ u, ctx }) => {
      const base = stripDex(u.name)
      // Native dex names are plain ("BTC"); xyz names may or may not carry prefix — normalize.
      const coin = dex === '' ? u.name : u.name.includes(':') ? u.name : `${XYZ_DEX}:${u.name}`
      return {
        coin,
        base,
        dex,
        category: categorize(base, dex),
        maxLeverage: u.maxLeverage,
        markPx: ctx?.markPx,
        oraclePx: ctx?.oraclePx,
        funding: ctx?.funding,
        openInterest: ctx?.openInterest,
      } satisfies Market
    })
}

export async function fetchAllMids(dex: '' | 'xyz'): Promise<Record<string, string>> {
  const body = dex === '' ? { type: 'allMids' } : { type: 'allMids', dex }
  const json = await postInfo<{ mids: Record<string, string> } | Record<string, string>>(body)
  if (json && typeof json === 'object' && 'mids' in (json as object)) {
    return (json as { mids: Record<string, string> }).mids
  }
  return json as Record<string, string>
}

export interface HLCandle {
  t: number
  T: number
  s: string
  i: string
  o: string
  h: string
  l: string
  c: string
  v: string
  n: number
}

export type CandleInterval =
  | '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M'

export const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d']

export async function fetchCandles(
  coin: string,
  interval: CandleInterval,
  lookbackMs = 24 * 60 * 60 * 1000,
): Promise<HLCandle[]> {
  const endTime = Date.now()
  const rows = await postInfo<HLCandle[]>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime: endTime - lookbackMs, endTime },
  })
  return [...rows].sort((a, b) => a.t - b.t)
}

// --- Market-hours / stale reference detection ---

function etNow(): { day: number; mins: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { day: dayMap[parts.weekday] ?? 0, mins: Number(parts.hour) * 60 + Number(parts.minute) }
}

function ctNow(): { day: number; mins: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { day: dayMap[parts.weekday] ?? 0, mins: Number(parts.hour) * 60 + Number(parts.minute) }
}

/** True when the TradFi reference venue is closed (oracle mark may be stale). */
export function isReferenceClosed(m: Market): boolean {
  if (m.dex === '') return false // crypto trades 24/7
  if (m.category === 'stocks' || m.category === 'indices' || m.category === 'forex') {
    const { day, mins } = etNow()
    if (day === 0 || day === 6) return true
    return mins < 9 * 60 + 30 || mins >= 16 * 60
  }
  // CME-ish: Sun 17:00 -> Fri 16:00 CT
  const { day, mins } = ctNow()
  if (day === 6) return true
  if (day === 0) return mins < 17 * 60
  if (day === 5) return mins >= 16 * 60
  return false
}
