import { useEffect, useState } from 'react'
import { useBetting } from '../hooks/useBetting'
import MarketIcon from './MarketIcon'
import EngineOfflineModal from './EngineOfflineModal'
import OnchainBettingPanel from './OnchainBettingPanel'
import BetSlip from './BetSlip'

export default function BettingPanel() {
  const {
    user, products, productId, setProductId,
    openRound, lastSettled, balance, myBets, online, notice, notify,
    now, bet, faucet, retry,
  } = useBetting()
  const [stake, setStake] = useState('5')
  const [busy, setBusy] = useState<'up' | 'down' | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [mode, setMode] = useState<'demo' | 'testnet'>('demo')

  // Re-arm the popup if the engine drops again after a dismiss.
  useEffect(() => {
    if (online) setDismissed(false)
  }, [online])

  const product = products.find((p) => p.id === productId)
  const lockIn = openRound ? Math.max(0, (openRound.lockAt - now) / 1000) : 0
  const entriesOpen = !!openRound && lockIn > 0
  const stakeNum = Number(stake)
  const toWin = Number.isFinite(stakeNum) && product ? stakeNum * product.payout : 0

  const place = async (side: 'up' | 'down') => {
    if (!openRound) return
    if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
      notify('Enter a stake greater than 0.')
      return
    }
    setBusy(side)
    await bet(openRound.id, side, stakeNum)
    setBusy(null)
  }

  return (
    <section style={styles.wrap}>
      <h2 style={styles.h2}>Up / Down <span style={styles.demo}>demo vs Arc Testnet</span></h2>

      <div style={styles.row}>
        <button style={tab(mode === 'demo')} onClick={() => setMode('demo')}>Demo ledger</button>
        <button style={tab(mode === 'testnet')} onClick={() => setMode('testnet')}>Arc Testnet · real USDC</button>
      </div>

      {mode === 'testnet' ? (
        <OnchainBettingPanel />
      ) : (
        <>
          {!online && !dismissed && (
            <EngineOfflineModal onRetry={retry} onDismiss={() => setDismissed(true)} />
          )}

          {!online && (
            <p style={styles.error}>
              <span style={styles.dot} /> Engine offline — betting is paused.
              <button style={styles.link} onClick={() => setDismissed(false)}> Show popup</button>
            </p>
          )}

          <div style={styles.row}>
            {products.map((p) => (
              <button key={p.id} style={tab(productId === p.id)} onClick={() => setProductId(p.id)}>
                {p.label}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <span style={styles.muted}>
              {user} · balance: {balance == null ? '—' : `$${balance.toFixed(2)}`}{' '}
              <button style={tab(false)} onClick={faucet}>+ faucet $1k</button>
            </span>
          </div>

          {product && (
            <p style={styles.muted}>
              {product.coin} · pays {product.payout}x · {(product.feePct * 100).toFixed(1)}% fee · min ${product.minBet} ·
              ties refund · closes {product.entryCutoffSec}s before expiry
            </p>
          )}

          <div style={styles.grid}>
            <div style={styles.card}>
              {openRound ? (
                <>
                  <div style={styles.roundHead}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <MarketIcon base={openRound.coin} category="crypto" />
                      <strong>{openRound.coin} · {openRound.id}</strong>
                    </span>
                    <span style={entriesOpen ? styles.live : styles.locked}>
                      {entriesOpen ? `locks in ${lockIn.toFixed(1)}s` : 'locking…'}
                    </span>
                  </div>
                  <div style={styles.pool}>
                    <span>UP ${openRound.upStakes.toFixed(2)}</span>
                    <span>DOWN ${openRound.downStakes.toFixed(2)}</span>
                  </div>
                  <div style={styles.row}>
                    <input
                      style={styles.input}
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      inputMode="decimal"
                      placeholder="stake $"
                    />
                    <span style={styles.muted}>to win ${toWin.toFixed(2)}</span>
                  </div>
                  <div style={styles.row}>
                    <button style={styles.up} disabled={!entriesOpen || busy != null} onClick={() => place('up')}>
                      {busy === 'up' ? '…' : '▲ UP'}
                    </button>
                    <button style={styles.down} disabled={!entriesOpen || busy != null} onClick={() => place('down')}>
                      {busy === 'down' ? '…' : '▼ DOWN'}
                    </button>
                  </div>
                  {notice && <p style={styles.error}>{notice}</p>}
                </>
              ) : (
                <p style={styles.muted}>{online ? 'Waiting for next round…' : 'Engine offline.'}</p>
              )}
            </div>

            <div style={styles.card}>
              <strong>Last result</strong>
              {lastSettled ? (
                <p style={styles.muted}>
                  {lastSettled.coin} {lastSettled.status === 'void' ? 'void (refunded)' : `${lastSettled.result?.toUpperCase()} @ ${lastSettled.settlePrice}`}
                  <br />ref {lastSettled.refPrice} · {lastSettled.id}
                </p>
              ) : (
                <p style={styles.muted}>—</p>
              )}
              <div style={{ marginTop: 12 }}>
                <BetSlip
                  bets={myBets.slice(0, 12).map((b) => ({
                    key: b.id,
                    round: b.round,
                    side: b.side,
                    stake: b.stake,
                    state: b.status,
                    returned:
                      b.payout ?? (b.status === 'push' || b.status === 'void' ? b.stake : 0),
                  }))}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { width: '100%', border: '1px solid #26262b', borderRadius: 12, background: '#131316', padding: 20 },
  h2: { margin: '0 0 12px', fontSize: 20 },
  demo: { fontSize: 11, opacity: 0.55, fontWeight: 400 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 },
  grid: { display: 'grid', gridTemplateColumns: '1fr', gap: 12 },
  card: { border: '1px solid #26262b', borderRadius: 10, padding: 14, background: '#0f0f12' },
  roundHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  live: { color: '#4ade80', fontSize: 13, fontVariantNumeric: 'tabular-nums' },
  locked: { color: '#f5c518', fontSize: 13 },
  pool: { display: 'flex', justifyContent: 'space-between', fontSize: 13, opacity: 0.8, marginBottom: 8 },
  input: { background: '#131316', border: '1px solid #333', color: '#ededed', borderRadius: 8, padding: '8px 12px', width: 120 },
  up: { flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  down: { flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
  dot: { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#ff7b7b', marginRight: 6 },
  link: { background: 'none', border: 'none', padding: 0, color: '#ededed', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 },
}

const tab = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #333',
  background: active ? '#fff' : 'transparent',
  color: active ? '#000' : '#ededed',
  cursor: 'pointer',
})
