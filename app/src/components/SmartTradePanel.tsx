import { useEffect, useState } from 'react'
import type { Hex } from 'viem'
import { useSmartAccount } from '../hooks/useSmartAccount'
import { useOnchainBetting } from '../hooks/useOnchainBetting'
import { ROUNDS_ADDR, fromBase, roundsAbi, saveBetId, testnetClient } from '../lib/onchain'
import BetSlip, { type SlipBet } from './BetSlip'

async function enc() {
  return import('../lib/smartAccount')
}

/** Gasless trading via smart account: batched approve+deposit, one-tap bet/claim. */
export default function SmartTradePanel({ smartAddress }: { smartAddress: Hex }) {
  const { send, lastOp } = useSmartAccount('testnet')
  const { openRound, lockedRound, myBets, vaultBalance, walletUsdc, notice, refresh } =
    useOnchainBetting(smartAddress)
  const [stake, setStake] = useState('0.10')
  const [amount, setAmount] = useState('5')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  const run = async (label: string, calls: { to: Hex; data: Hex }[], after?: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    const txHash = await send(calls)
    if (txHash) {
      setMsg(`${label} sent (gasless) — ${txHash.slice(0, 10)}…`)
      await after?.()
      await refresh()
    }
    setBusy(false)
  }

  const deposit = () => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return setMsg('Enter an amount greater than 0.')
    void enc().then((m) => run('Deposit', m.encDepositBatch(n)))
  }

  const bet = (up: boolean) => {
    if (!openRound) return
    const n = Number(stake)
    if (!Number.isFinite(n) || n <= 0) return setMsg('Enter a stake greater than 0.')
    void enc().then((m) =>
      run(`Bet ${up ? 'UP' : 'DOWN'}`, [m.encPlaceBet(openRound.id, up, n)], async () => {
        try {
          const c = (await testnetClient.readContract({
            address: ROUNDS_ADDR, abi: roundsAbi, functionName: 'betCount',
          })) as bigint
          saveBetId(c)
        } catch { /* non-fatal */ }
      }),
    )
  }

  const claimById = (id: bigint) => {
    void enc().then((m) => run('Claim', [m.encClaim(id)]))
  }

  const lockIn = openRound ? Math.max(0, openRound.lockAt - Math.floor(now / 1000)) : 0
  const entriesOpen = !!openRound && lockIn > 0
  const effMax = openRound ? fromBase(openRound.maxBet) : 1

  const slip: SlipBet[] = myBets.map((b) => {
    const settled = b.roundStatus === 2 || b.roundStatus === 3
    const won = b.roundStatus === 2 && ((b.roundResult === 1 && b.up) || (b.roundResult === 2 && !b.up))
    return {
      key: String(b.id),
      round: String(b.roundId),
      side: b.up ? 'up' : 'down',
      stake: fromBase(b.stake),
      state: b.claimed ? 'claimed' : !settled ? 'live' : b.roundStatus === 3 ? 'void' : won ? 'won' : b.roundResult === 3 ? 'push' : 'lost',
      returned: won ? fromBase(b.stake) * (b.roundPayout / 10000) : undefined,
    }
  })

  return (
    <div>
      <p style={styles.muted}>
        smart USDC: {walletUsdc == null ? '—' : `$${walletUsdc.toFixed(2)}`} · vault:{' '}
        {vaultBalance == null ? '—' : `$${vaultBalance.toFixed(2)}`} · <span style={styles.free}>$0 gas</span>
      </p>

      <div style={styles.row}>
        <input style={styles.input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <button style={styles.ghost} disabled={busy} onClick={deposit}>Deposit (1 tap)</button>
      </div>

      {openRound ? (
        <>
          <div style={styles.row}>
            <input style={styles.input} value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" />
            <span style={styles.muted}>max ${effMax.toFixed(2)}</span>
          </div>
          <div style={styles.row}>
            <button style={styles.up} disabled={!entriesOpen || busy} onClick={() => bet(true)}>▲ UP · gasless</button>
            <button style={styles.down} disabled={!entriesOpen || busy} onClick={() => bet(false)}>▼ DOWN · gasless</button>
          </div>
          {!entriesOpen && <p style={styles.muted}>Round #{String(openRound.id)} locking… next round opens automatically.</p>}
        </>
      ) : (
        <p style={styles.muted}>{lockedRound ? `Round #${String(lockedRound.id)} settling…` : 'Waiting for operator round…'}</p>
      )}

      <div style={{ marginTop: 8 }}>
        <BetSlip
          bets={slip}
          onClaim={(id) => claimById(id as bigint)}
          busy={busy}
        />
      </div>
      {msg && <p style={styles.ok}>{msg}</p>}
      {notice && <p style={styles.error}>{notice}</p>}
      {lastOp && <p style={styles.muted}>last op: {lastOp.slice(0, 18)}…</p>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, marginTop: 8 },
  input: { background: '#131316', border: '1px solid #333', color: '#ededed', borderRadius: 8, padding: '8px 12px', width: 90 },
  ghost: { padding: '8px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ededed', cursor: 'pointer', fontSize: 13 },
  up: { flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  down: { flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  free: { color: '#4ade80', fontWeight: 700 },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
  ok: { color: '#4ade80', fontSize: 13 },
}
