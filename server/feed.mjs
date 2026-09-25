/**
 * P1 price feed: Hyperliquid WS allMids + timestamped history for TWAP.
 * Falls back to inject-only mode (tests / no-WebSocket envs).
 */
export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'
const HIST_CAP = 2000

export function stripDex(coin) {
  const i = coin.indexOf(':')
  return i >= 0 ? coin.slice(i + 1) : coin
}

export class PriceFeed {
  constructor() {
    this.mids = new Map() // coin -> px string
    this.hist = new Map() // coin -> [{t, px}]
    this.connected = false
  }

  connect() {
    if (typeof WebSocket === 'undefined') {
      console.warn('[feed] no global WebSocket — inject-only mode')
      return
    }
    let attempt = 0
    const open = () => {
      const ws = new WebSocket(HL_WS_URL)
      ws.onopen = () => {
        attempt = 0
        this.connected = true
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }))
        const ping = setInterval(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' }))
          else clearInterval(ping)
        }, 25000)
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.channel === 'allMids' && msg.data?.mids) {
            const t = Date.now()
            for (const [k, px] of Object.entries(msg.data.mids)) this.ingest(k, px, t)
          }
        } catch {
          // ignore malformed frames
        }
      }
      ws.onclose = () => {
        this.connected = false
        attempt += 1
        setTimeout(open, Math.min(1000 * 2 ** attempt, 15000))
      }
      ws.onerror = () => ws.close()
    }
    open()
  }

  ingest(coin, px, t = Date.now()) {
    this.mids.set(coin, String(px))
    const arr = this.hist.get(coin) ?? []
    arr.push({ t, px: Number(px) })
    if (arr.length > HIST_CAP) arr.splice(0, arr.length - HIST_CAP)
    this.hist.set(coin, arr)
  }

  /** Test/demo hook: push a synthetic tick. */
  inject(coin, px, t = Date.now()) {
    this.ingest(coin, px, t)
  }

  lookup(coin) {
    return this.mids.get(coin) ?? this.mids.get(stripDex(coin)) ?? null
  }

  getMid(coin) {
    const v = this.lookup(coin)
    return v == null ? null : Number(v)
  }

  /** Mean of ticks in the trailing window. Null when no data. */
  twap(coin, windowSec, now = Date.now()) {
    const arr = this.hist.get(coin) ?? this.hist.get(stripDex(coin)) ?? []
    const cut = now - windowSec * 1000
    const pts = arr.filter((p) => p.t >= cut)
    if (!pts.length) return null
    return pts.reduce((s, p) => s + p.px, 0) / pts.length
  }
}
