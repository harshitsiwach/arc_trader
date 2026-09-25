import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  fetchCandles,
  type CandleInterval,
  type HLCandle,
} from '../lib/hyperliquid'

export interface LiveCandle {
  t: number
  o: string
  h: string
  l: string
  c: string
}

function toCandle(c: HLCandle) {
  return {
    time: Math.floor(c.t / 1000) as UTCTimestamp,
    open: Number(c.o),
    high: Number(c.h),
    low: Number(c.l),
    close: Number(c.c),
  }
}

export default function PriceChart({
  coin,
  interval,
  live,
  icon,
}: {
  coin: string
  interval: CandleInterval
  live: LiveCandle | null
  icon?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [mode, setMode] = useState<'candles' | 'line'>('candles')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastTimeRef = useRef<number>(0)

  const modeRef = useRef(mode)
  modeRef.current = mode

  // (Re)create chart + load history when coin/interval changes
  useEffect(() => {
    if (!ref.current) return
    setLoading(true)
    setError(null)
    lastTimeRef.current = 0

    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#9a9aa3' },
      grid: { vertLines: { color: '#1e1e24' }, horzLines: { color: '#1e1e24' } },
      timeScale: { timeVisible: true, secondsVisible: false },
    })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderVisible: false,
    })
    const line = chart.addSeries(LineSeries, {
      color: '#4f8cff',
      lineWidth: 2,
      priceLineVisible: true,
    })
    chartRef.current = chart
    candleRef.current = candles
    lineRef.current = line

    let cancelled = false
    fetchCandles(coin, interval)
      .then((rows) => {
        if (cancelled) return
        const data = rows.map(toCandle)
        candles.setData(data)
        line.setData(data.map((d) => ({ time: d.time, value: d.close })))
        lastTimeRef.current = data.length ? (data[data.length - 1].time as number) : 0
        applyMode()
        setLoading(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Chart load failed')
          setLoading(false)
        }
      })

    function applyMode() {
      const showCandles = modeRef.current === 'candles'
      chartRef.current?.applyOptions({}) // noop keepalive
      candleRef.current?.applyOptions({ visible: showCandles })
      lineRef.current?.applyOptions({ visible: !showCandles })
    }

    const ro = new ResizeObserver(() => chart.applyOptions({ autoSize: true }))
    if (ref.current) ro.observe(ref.current)
    return () => {
      cancelled = true
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      lineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, interval]);

  useEffect(() => {
    candleRef.current?.applyOptions({ visible: mode === 'candles' })
    lineRef.current?.applyOptions({ visible: mode === 'line' })
  }, [mode])

  // Live tick updates
  useEffect(() => {
    if (!live || !candleRef.current || !lineRef.current) return
    const time = Math.floor(live.t / 1000) as UTCTimestamp
    const bar = {
      time,
      open: Number(live.o),
      high: Number(live.h),
      low: Number(live.l),
      close: Number(live.c),
    }
    try {
      candleRef.current.update(bar)
      lineRef.current.update({ time, value: bar.close })
      lastTimeRef.current = time as number
    } catch {
      // out-of-order update — ignore
    }
  }, [live])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {loading ? 'Loading chart…' : error ?? `${coin} · ${interval}`}
        </span>
        <span style={{ flex: 1 }} />
        <button style={btn(mode === 'candles')} onClick={() => setMode('candles')}>Candles</button>
        <button style={btn(mode === 'line')} onClick={() => setMode('line')}>Line</button>
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 520, width: '100%' }} />
    </div>
  )
}

const btn = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #333',
  background: active ? '#fff' : 'transparent',
  color: active ? '#000' : '#ededed',
  cursor: 'pointer',
})
