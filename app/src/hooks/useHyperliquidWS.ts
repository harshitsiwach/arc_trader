import { useEffect, useRef } from 'react'
import { HL_WS_URL, stripDex, type CandleInterval } from '../lib/hyperliquid'

interface WSHandlers {
  onMid: (coin: string, px: string) => void
  onCandle: (coin: string, candle: { t: number; o: string; h: string; l: string; c: string; v: string }) => void
  onTrade?: (coin: string, px: string) => void
}

/**
 * Single multiplexed Hyperliquid WS connection.
 * Subscribes: allMids (all ticks) + candle + trades for the selected coin.
 * Reconnects with backoff; sends {"method":"ping"} keep-alive every 25s.
 */
export function useHyperliquidWS(
  selectedCoin: string | null,
  interval: CandleInterval,
  handlers: WSHandlers,
) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let attempt = 0
    let pingTimer: ReturnType<typeof setInterval> | null = null

    const send = (msg: unknown) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    const subscribe = () => {
      send({ method: 'subscribe', subscription: { type: 'allMids' } })
      if (selectedCoin) {
        send({ method: 'subscribe', subscription: { type: 'candle', coin: selectedCoin, interval } })
        send({ method: 'subscribe', subscription: { type: 'trades', coin: selectedCoin } })
      }
    }

    const connect = () => {
      if (closed) return
      ws = new WebSocket(HL_WS_URL)

      ws.onopen = () => {
        attempt = 0
        subscribe()
        if (pingTimer) clearInterval(pingTimer)
        pingTimer = setInterval(() => send({ method: 'ping' }), 25_000)
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string)
          const h = handlersRef.current
          if (msg.channel === 'allMids' && msg.data?.mids) {
            const mids = msg.data.mids as Record<string, string>
            for (const [k, px] of Object.entries(mids)) {
              // Normalize: WS may emit bare or prefixed keys
              h.onMid(k.includes(':') ? k : k, px)
            }
          } else if (msg.channel === 'candle' && msg.data) {
            const d = msg.data
            h.onCandle(d.s as string, { t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v })
          } else if (msg.channel === 'trades' && Array.isArray(msg.data)) {
            for (const t of msg.data as { coin?: string; px: string; s?: string }[]) {
              h.onTrade?.(t.coin ?? selectedCoin ?? '', t.px)
            }
          }
        } catch {
          // ignore malformed frames
        }
      }

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer)
        if (closed) return
        attempt += 1
        setTimeout(connect, Math.min(1000 * 2 ** attempt, 15_000))
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closed = true
      if (pingTimer) clearInterval(pingTimer)
      ws?.close()
    }
    // Re-subscribe candle/trades when selection or interval changes (allMids stays).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCoin, interval])

  // Keep selectedCoin matching even when WS emits bare names for xyz markets
  void stripDex
}
