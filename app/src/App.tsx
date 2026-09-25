import { Suspense, lazy, useMemo, useState } from 'react'
import WalletProfile from './components/WalletProfile'
import GasPill from './components/GasPill'
import MarketList from './components/MarketList'
import ChartPanel from './components/ChartPanel'
import BettingPanel from './components/BettingPanel'
import StakePanel from './components/StakePanel'
// Code-split: App Kit (bridge/swap/onramp) is ~1.4MB — load on demand.
const BridgePanel = lazy(() => import('./components/BridgePanel'))
const SwapPanel = lazy(() => import('./components/SwapPanel'))
const OnrampPanel = lazy(() => import('./components/OnrampPanel'))
import type { LiveCandle } from './components/PriceChart'
import { useMarkets } from './hooks/useMarkets'
import { useHyperliquidWS } from './hooks/useHyperliquidWS'
import { stripDex, type CandleInterval } from './lib/hyperliquid'

type Page = 'trade' | 'earn' | 'bridge' | 'swap' | 'fund'

const NAV: { id: Page; label: string }[] = [
  { id: 'trade', label: 'Trade' },
  { id: 'earn', label: 'Earn' },
  { id: 'bridge', label: 'Bridge' },
  { id: 'swap', label: 'Swap' },
  { id: 'fund', label: 'Fund' },
]

const PAGE_BLURB: Record<Page, string> = {
  trade: 'Live markets, charts and up/down betting.',
  earn: 'Stake USDC, earn HBLK daily, 30-day lock.',
  bridge: 'Move USDC across chains with Circle CCTP.',
  swap: 'Swap tokens with a reviewed quote first.',
  fund: 'Buy stablecoins with fiat, straight to your wallet.',
}

export default function App() {
  const { markets, loading, error: marketsError, applyTick } = useMarkets()
  const [liveCandles, setLiveCandles] = useState<Record<string, LiveCandle>>({})
  const [livePrices, setLivePrices] = useState<Record<string, string>>({})
  const [selectedCoin, setSelectedCoin] = useState<string>('BTC')
  const [interval, setInterval] = useState<CandleInterval>('1m')
  const [page, setPage] = useState<Page>('trade')

  const handlers = useMemo(
    () => ({
      onMid: (coin: string, px: string) => {
        applyTick(coin, px)
        setLivePrices((prev) => {
          // store under both raw + normalized keys for lookup resilience
          const keys = new Set([coin, stripDex(coin)])
          let changed = false
          const next = { ...prev }
          for (const k of keys) {
            if (next[k] !== px) {
              next[k] = px
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
      onCandle: (
        coin: string,
        c: { t: number; o: string; h: string; l: string; c: string; v: string },
      ) => {
        setLiveCandles((prev) => ({ ...prev, [coin]: c }))
      },
      onTrade: (coin: string, px: string) => {
        if (!coin) return
        setLivePrices((prev) => (prev[coin] === px ? prev : { ...prev, [coin]: px }))
      },
    }),
    [applyTick],
  )

  useHyperliquidWS(selectedCoin, interval, handlers)

  const selectedMarket = markets.find((m) => m.coin === selectedCoin)
  const livePrice =
    livePrices[selectedCoin] ?? livePrices[selectedMarket?.base ?? ''] ?? selectedMarket?.markPx ?? null

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <span style={styles.brand}>Arc</span>
          <span style={styles.sub}> · markets on Arc Mainnet</span>
        </div>
        <nav style={styles.nav}>
          {NAV.map((n) => (
            <button key={n.id} style={navBtn(page === n.id)} onClick={() => setPage(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <GasPill />
          <WalletProfile />
        </div>
      </header>

      <main style={styles.main}>
        <p style={styles.blurb}>{PAGE_BLURB[page]}</p>

        {page === 'trade' && (
          <div style={styles.gridContainer} className="hb-top-row">
            <div style={styles.chart}>
              <ChartPanel
                markets={markets}
                selected={selectedCoin}
                interval={interval}
                onIntervalChange={setInterval}
                liveCandles={liveCandles}
                livePrice={livePrice}
              />
            </div>
            <div style={styles.assets}>
              <MarketList
                markets={markets}
                loading={loading}
                error={marketsError}
                livePrices={livePrices}
                selected={selectedCoin}
                onSelect={setSelectedCoin}
              />
            </div>
            <aside style={styles.side}>
              <BettingPanel />
            </aside>
          </div>
        )}

        {page === 'earn' && <StakePanel />}

        {(page === 'bridge' || page === 'swap' || page === 'fund') && (
          <div style={styles.solo}>
            <div style={styles.card}>
              <Suspense fallback={<p style={{ opacity: 0.6, fontSize: 13 }}>Loading…</p>}>
                {page === 'bridge' && <BridgePanel />}
                {page === 'swap' && <SwapPanel />}
                {page === 'fund' && <OnrampPanel />}
              </Suspense>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const navBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 8,
  border: active ? '1px solid #ededed' : '1px solid transparent',
  background: active ? '#1c1c22' : 'transparent',
  color: '#ededed',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: active ? 700 : 400,
})

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0b',
    color: '#ededed',
    fontFamily: 'system-ui, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
    padding: '14px 24px',
    borderBottom: '1px solid #26262b',
    position: 'sticky',
    top: 0,
    background: '#0a0a0b',
    zIndex: 10,
  },
  brand: { fontSize: 20, fontWeight: 700 },
  sub: { opacity: 0.55, fontSize: 13 },
  nav: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  main: {
    maxWidth: '100%',
    margin: '0 auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  blurb: { opacity: 0.55, fontSize: 13, margin: 0 },
  gridContainer: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 5fr) minmax(280px, 2.5fr) minmax(300px, 2.5fr)',
    gap: 16,
    alignItems: 'stretch',
    width: '100%',
  },
  chart: { minWidth: 0, display: 'flex', flexDirection: 'column' },
  assets: { minWidth: 0, display: 'flex', flexDirection: 'column' },
  side: { minWidth: 0, display: 'flex', flexDirection: 'column' },
  solo: { maxWidth: 720, width: '100%', margin: '0 auto' },
  card: { border: '1px solid #26262b', borderRadius: 12, background: '#131316', padding: 20 },
}
