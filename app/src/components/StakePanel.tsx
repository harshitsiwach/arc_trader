import { useEffect, useState } from 'react'
import { useSwitchChain } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { useStaking } from '../hooks/useStaking'

function countdown(targetSec: number, now: number): string {
  const s = Math.max(0, targetSec - Math.floor(now / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

/** Earn section: stake USDC, claim HBLK, 30-day lock, penalty exit. */
export default function StakePanel() {
  const { address, chainId, pos, notice, pending, stake, simple, isStakingLive } = useStaking()
  const { switchChain } = useSwitchChain()
  const [amount, setAmount] = useState('10')
  const [now, setNow] = useState(Date.now())
  const [confirmExit, setConfirmExit] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!isStakingLive) {
    return (
      <section style={styles.wrap}>
        <h2 style={styles.h2}>Earn <span style={styles.demo}>HBLK staking — deploying</span></h2>
        <p style={styles.muted}>Staking contracts are being deployed to Arc Testnet. This panel activates automatically.</p>
      </section>
    )
  }
  if (!address) return <p style={styles.muted}>Connect a wallet (top right) to stake.</p>
  if (chainId !== 5042002) {
    return (
      <div>
        <p style={styles.error}>Switch to Arc Testnet (5042002) to stake.</p>
        <button style={styles.ghost} onClick={() => switchChain({ chainId: arcTestnet.id })}>Switch to Arc Testnet</button>
      </div>
    )
  }

  const locked = pos != null && pos.staked > 0 && pos.unlockAt * 1000 > now
  const utilization = pos && pos.tvl > 0 ? (pos.deployed / pos.tvl) * 100 : 0
  // Live projection: rewards accrue linearly per second, so the ticker is exact
  // between chain polls (resyncs every 8s from accruedRewards).
  const elapsedSec = pos ? Math.max(0, (now - pos.fetchedAtMs) / 1000) : 0
  const liveRaw = pos ? pos.accruedRaw + (pos.stakedRaw * pos.rateRaw * BigInt(Math.floor(elapsedSec * 10))) / 10n : 0n
  const liveClaimable = Number(liveRaw) / 1e18
  const perSec = pos ? (Number(pos.stakedRaw) * Number(pos.rateRaw)) / 1e18 : 0
  const perDay = perSec * 86400

  return (
    <section style={styles.wrap}>
      <h2 style={styles.h2}>Earn <span style={styles.demo}>stake USDC · earn HBLK daily · 30-day lock</span></h2>

      <div style={styles.stats}>
        <div><div style={styles.statLabel}>TVL</div><div style={styles.statVal}>${pos?.tvl.toFixed(2) ?? '—'}</div></div>
        <div><div style={styles.statLabel}>House deployed</div><div style={styles.statVal}>{utilization.toFixed(1)}% <span style={styles.cap}>/ 30% cap</span></div></div>
        <div><div style={styles.statLabel}>Your HBLK</div><div style={styles.statVal}>{pos?.hblk.toFixed(2) ?? '—'}</div></div>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <strong>Your position</strong>
          <p style={styles.muted}>
            staked: ${pos?.staked.toFixed(2) ?? '—'}
            {pos && pos.staked > 0 && (
              <> · {locked ? <>unlocks in {countdown(pos.unlockAt, now)}</> : <>unlocked ✓</>}</>
            )}
          </p>
          <div style={styles.tickWrap}>
            <div style={styles.tickLabel}>CLAIMABLE HBLK · LIVE</div>
            <div style={styles.tickValue}>{pos ? liveClaimable.toFixed(6) : '—'}</div>
            <div style={styles.muted}>
              +{perSec.toFixed(6)} HBLK/sec · ~{perDay.toFixed(2)}/day
            </div>
          </div>
          <div style={styles.row}>
            <input style={styles.input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="$" />
            <button style={styles.primary} disabled={pending} onClick={() => stake(Number(amount))}>Stake</button>
            <button style={styles.ghost} disabled={pending || liveClaimable <= 0} onClick={() => simple('claimRewards')}>Claim {liveClaimable > 0 ? `${liveClaimable.toFixed(4)} HBLK` : 'HBLK'}</button>
          </div>
          {pos && pos.staked > 0 && (
            <div style={styles.row}>
              {!locked ? (
                <button style={styles.ghost} disabled={pending} onClick={() => simple('unstake')}>Unstake (100%)</button>
              ) : !confirmExit ? (
                <button style={styles.warn} disabled={pending} onClick={() => setConfirmExit(true)}>Early exit…</button>
              ) : (
                <>
                  <span style={styles.error}>Lose 10% penalty — receive 90% now?</span>
                  <button style={styles.warn} disabled={pending} onClick={() => { setConfirmExit(false); simple('earlyExit') }}>Confirm exit</button>
                  <button style={styles.ghost} onClick={() => setConfirmExit(false)}>Cancel</button>
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.card}>
          <strong>How it works</strong>
          <p style={styles.muted}>USDC locks 30 days per deposit (new deposits reset the clock). HBLK accrues every second, claimable anytime. Max 30% of TVL backs the house bankroll — the rest is always reserved for unlocks. Early exit forfeits 10% to the treasury.</p>
        </div>
      </div>
      {notice && <p style={styles.error}>{notice}</p>}
      {pending && <p style={styles.muted}>Confirm in wallet…</p>}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { width: '100%', border: '1px solid #26262b', borderRadius: 12, background: '#131316', padding: 20, marginTop: 16 },
  h2: { margin: '0 0 12px', fontSize: 20 },
  demo: { fontSize: 11, opacity: 0.55, fontWeight: 400 },
  stats: { display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 12 },
  statLabel: { fontSize: 13, opacity: 0.55 },
  statVal: { fontSize: 24, fontWeight: 600 },
  tickWrap: { border: '1px solid #26262b', borderRadius: 10, padding: '12px 14px', background: '#0a0a0b', margin: '8px 0' },
  tickLabel: { fontSize: 11, letterSpacing: '0.12em', opacity: 0.55 },
  tickValue: { fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#4ade80' },
  cap: { fontSize: 12, opacity: 0.5, fontWeight: 400 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  card: { border: '1px solid #26262b', borderRadius: 10, padding: 14, background: '#0f0f12' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, marginTop: 8 },
  input: { background: '#131316', border: '1px solid #333', color: '#ededed', borderRadius: 8, padding: '8px 12px', width: 100 },
  primary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#fff', color: '#000', cursor: 'pointer', fontWeight: 700 },
  ghost: { padding: '8px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ededed', cursor: 'pointer', fontSize: 13 },
  warn: { padding: '8px 12px', borderRadius: 8, border: 'none', background: '#f5c518', color: '#000', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
}
