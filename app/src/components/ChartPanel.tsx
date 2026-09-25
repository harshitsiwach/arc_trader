import { INTERVALS, isReferenceClosed, type CandleInterval, type Market } from '../lib/hyperliquid'
import PriceChart, { type LiveCandle } from './PriceChart'
import MarketIcon from './MarketIcon'

/** Full-width chart card for the selected market. Sits below the list/betting row. */
export default function ChartPanel({
  markets,
  selected,
  interval,
  onIntervalChange,
  liveCandles,
  livePrice,
}: {
  markets: Market[]
  selected: string
  interval: CandleInterval
  onIntervalChange: (i: CandleInterval) => void
  liveCandles: Record<string, LiveCandle>
  livePrice: string | null
}) {
  const selectedMarket = markets.find((m) => m.coin === selected) ?? null

  return (
    <section style={styles.wrap}>
      <div style={styles.head}>
        <span style={styles.title}>
          {selectedMarket && (
            <MarketIcon base={selectedMarket.base} category={selectedMarket.category} size={20} />
          )}
          <strong>{selectedMarket?.base ?? selected}</strong>
          {livePrice && <span style={styles.price}>{livePrice}</span>}
        </span>
        <div style={styles.intervals}>
          {INTERVALS.map((i) => (
            <button key={i} style={tabBtn(interval === i)} onClick={() => onIntervalChange(i)}>
              {i}
            </button>
          ))}
        </div>
      </div>
      {selectedMarket?.dex !== '' && selectedMarket && isReferenceClosed(selectedMarket) && (
        <p style={styles.staleNote}>
          Reference market closed — showing Hyperliquid oracle mark. Expect gaps/stale prints
          outside TradFi hours.
        </p>
      )}
      <PriceChart
        coin={selected}
        interval={interval}
        live={liveCandles[selected] ?? liveCandles[selectedMarket?.base ?? ''] ?? null}
        icon={
          selectedMarket ? (
            <MarketIcon base={selectedMarket.base} category={selectedMarket.category} size={16} />
          ) : undefined
        }
      />
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    border: '1px solid #26262b',
    borderRadius: 12,
    background: '#131316',
    padding: 16,
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  title: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16 },
  price: { fontFamily: 'monospace', fontSize: 15, opacity: 0.85 },
  intervals: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  staleNote: { fontSize: 12, color: '#f5c518', margin: '0 0 8px' },
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #333',
  background: active ? '#fff' : 'transparent',
  color: active ? '#000' : '#ededed',
  cursor: 'pointer',
})
