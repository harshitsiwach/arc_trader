export type SlipState = 'live' | 'won' | 'lost' | 'push' | 'void' | 'claimed'

export interface SlipBet {
  key: string
  round: string
  side: 'up' | 'down'
  stake: number
  state: SlipState
  /** Amount returned so far (payout on win, stake on push/void). */
  returned?: number
  /** Present when the user can still collect. */
  claimId?: string | bigint
}

const STATE_LABEL: Record<SlipState, string> = {
  live: 'LIVE',
  won: 'WON',
  lost: 'LOST',
  push: 'PUSH',
  void: 'VOID',
  claimed: 'CLAIMED',
}

const STATE_COLOR: Record<SlipState, string> = {
  live: '#4ade80',
  won: '#4ade80',
  lost: '#ff7b7b',
  push: '#f5c518',
  void: '#f5c518',
  claimed: '#999',
}

/**
 * Bet slip: active tickets on top, settled history + P&L below.
 * Shared by demo ledger and onchain testnet modes.
 */
export default function BetSlip({
  bets,
  onClaim,
  busy,
}: {
  bets: SlipBet[]
  onClaim?: (claimId: string | bigint) => void
  busy?: boolean
}) {
  const active = bets.filter((b) => b.state === 'live')
  const history = bets.filter((b) => b.state !== 'live')
  const liveStaked = active.reduce((s, b) => s + b.stake, 0)
  const risked = history.reduce((s, b) => s + b.stake, 0)
  const returned = history.reduce((s, b) => s + (b.returned ?? 0), 0)
  const net = returned - risked

  return (
    <div>
      <div style={styles.head}>
        <strong>Bet slip {active.length > 0 && <span style={styles.count}>{active.length} live</span>}</strong>
        {active.length > 0 && <span style={styles.muted}>${liveStaked.toFixed(2)} riding</span>}
      </div>
      {active.length === 0 && <p style={styles.muted}>No live bets — place one above.</p>}
      {active.map((b) => (
        <div key={b.key} style={styles.ticket}>
          <span style={{ ...styles.side, color: b.side === 'up' ? '#4ade80' : '#ff7b7b' }}>
            {b.side === 'up' ? '▲ UP' : '▼ DOWN'}
          </span>
          <span style={styles.stake}>${b.stake.toFixed(2)}</span>
          <span style={styles.round}>#{b.round}</span>
          <span style={{ ...styles.state, color: STATE_COLOR[b.state] }}>● LIVE</span>
        </div>
      ))}

      {history.length > 0 && (
        <>
          <div style={{ ...styles.head, marginTop: 12 }}>
            <strong>History</strong>
            <span style={{ ...styles.muted, color: net >= 0 ? '#4ade80' : '#ff7b7b' }}>
              {net >= 0 ? '+' : ''}${net.toFixed(2)} net
            </span>
          </div>
          {history.slice(0, 10).map((b) => (
            <div key={b.key} style={styles.ticket}>
              <span style={{ ...styles.side, color: b.side === 'up' ? '#4ade80' : '#ff7b7b' }}>
                {b.side === 'up' ? '▲' : '▼'} ${b.stake.toFixed(2)}
              </span>
              <span style={styles.round}>#{b.round}</span>
              <span style={{ ...styles.state, color: STATE_COLOR[b.state] }}>{STATE_LABEL[b.state]}</span>
              {b.claimId != null && onClaim && (b.state === 'won' || b.state === 'push' || b.state === 'void') && (
                <button style={styles.claim} disabled={busy} onClick={() => onClaim(b.claimId!)}>
                  Claim{b.returned != null && b.returned > 0 ? ` $${b.returned.toFixed(2)}` : ''}
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  count: { fontSize: 11, background: '#4ade80', color: '#000', borderRadius: 4, padding: '1px 6px', marginLeft: 6, fontWeight: 700 },
  ticket: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    border: '1px solid #26262b',
    borderRadius: 8,
    marginBottom: 6,
    fontSize: 13,
    background: '#0a0a0b',
  },
  side: { fontWeight: 700, minWidth: 62 },
  stake: { fontFamily: 'monospace' },
  round: { opacity: 0.5, fontSize: 12, marginLeft: 'auto' },
  state: { fontSize: 11, fontWeight: 700 },
  claim: {
    padding: '4px 10px',
    borderRadius: 6,
    border: 'none',
    background: '#fff',
    color: '#000',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 12,
  },
  muted: { opacity: 0.6, fontSize: 13 },
}
