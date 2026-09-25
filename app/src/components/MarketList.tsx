import { useMemo, useState } from 'react'
import { isReferenceClosed, type Category, type Market } from '../lib/hyperliquid'
import MarketIcon from './MarketIcon'

const TABS: ('all' | Category)[] = ['all', 'crypto', 'stocks', 'commodities', 'indices', 'forex']

/** Asset list: tabs + search + table. Lives top-left. */
export default function MarketList({
  markets,
  loading,
  error,
  livePrices,
  selected,
  onSelect,
}: {
  markets: Market[]
  loading: boolean
  error: string | null
  livePrices: Record<string, string>
  selected: string
  onSelect: (coin: string) => void
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    return markets.filter((m) => {
      if (tab !== 'all' && m.category !== tab) return false
      if (q && !m.base.toUpperCase().includes(q) && !m.coin.toUpperCase().includes(q)) return false
      return true
    })
  }, [markets, tab, query])

  return (
    <section style={styles.wrap}>
      <div style={styles.toolbar}>
        <div style={styles.tabs}>
          {TABS.map((t) => (
            <button key={t} style={tabBtn(tab === t)} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <input
          style={styles.search}
          placeholder="Search markets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <p style={styles.muted}>Loading Hyperliquid markets…</p>}
      {error && <p style={styles.error}>{error}</p>}

      {!loading && !error && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Market</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Price</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Funding</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const px = livePrices[m.coin] ?? livePrices[m.base] ?? m.markPx ?? '—'
                const stale = isReferenceClosed(m)
                return (
                  <tr
                    key={m.coin}
                    onClick={() => onSelect(m.coin)}
                    style={{
                      cursor: 'pointer',
                      background: selected === m.coin ? '#1c1c22' : 'transparent',
                    }}
                  >
                    <td style={styles.td}>
                      <span style={styles.name}>
                        <MarketIcon base={m.base} category={m.category} />
                        <strong>{m.base}</strong>
                      </span>{' '}
                      <span style={styles.tag}>{m.category}</span>
                      {m.dex === 'xyz' && <span style={styles.tag}>perp</span>}
                      {stale && <span style={styles.stale}>reference closed</span>}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{px}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                      {m.funding != null ? `${(Number(m.funding) * 100).toFixed(4)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p style={styles.muted}>No markets match.</p>}
        </div>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' },
  toolbar: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  tabs: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  search: {
    marginLeft: 'auto',
    background: '#131316',
    border: '1px solid #26262b',
    color: '#ededed',
    borderRadius: 8,
    padding: '8px 12px',
    minWidth: 140,
    flex: '1 1 120px',
  },
  tableWrap: {
    border: '1px solid #26262b',
    borderRadius: 12,
    background: '#131316',
    overflow: 'auto',
    flex: 1,
    minHeight: 520,
    maxHeight: 620,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', opacity: 0.55, fontWeight: 600, position: 'sticky', top: 0, background: '#131316' },
  td: { padding: '8px 12px', borderTop: '1px solid #1e1e24' },
  name: { display: 'inline-flex', alignItems: 'center', gap: 7 },
  tag: { fontSize: 10, opacity: 0.55, border: '1px solid #333', borderRadius: 4, padding: '1px 5px', marginLeft: 6 },
  stale: { fontSize: 10, color: '#f5c518', border: '1px solid #5a4a00', borderRadius: 4, padding: '1px 5px', marginLeft: 6 },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #333',
  background: active ? '#fff' : 'transparent',
  color: active ? '#000' : '#ededed',
  cursor: 'pointer',
  textTransform: 'capitalize',
})
