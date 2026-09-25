import { useEffect, useState } from 'react'
import { useSwitchChain } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { useOnchainBetting } from '../hooks/useOnchainBetting'
import { useSmartAccount } from '../hooks/useSmartAccount'
import { fromBase } from '../lib/onchain'
import MarketIcon from './MarketIcon'
import BetSlip from './BetSlip'
import SmartTradePanel from './SmartTradePanel'

/** Real-money betting against the Arc Testnet Vault/Rounds contracts. */
export default function OnchainBettingPanel() {
  const {
    address, chainId, vaultBalance, walletUsdc,
    openRound, lockedRound, myBets, notice, pending,
    deposit, placeBet, claim, withdraw,
  } = useOnchainBetting()
  const smart = useSmartAccount('testnet')
  const [payer, setPayer] = useState<'wallet' | 'smart'>('wallet')
  const { switchChain } = useSwitchChain()
  const [stake, setStake] = useState('0.10')
  const [amount, setAmount] = useState('5')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  if (!address) return <p style={styles.muted}>Connect a wallet (top right) to bet on Arc Testnet.</p>
  if (chainId !== 5042002) {
    return (
      <div>
        <p style={styles.error}>You're on chain {chainId} — betting runs on Arc Testnet (5042002).</p>
        <button style={styles.ghost} onClick={() => switchChain({ chainId: arcTestnet.id })}>
          Switch to Arc Testnet
        </button>
      </div>
    )
  }

  const nowSec = Math.floor(now / 1000)
  const lockIn = openRound ? Math.max(0, openRound.lockAt - nowSec) : 0
  const entriesOpen = !!openRound && lockIn > 0
  const stakeNum = Number(stake)
  const effMax = openRound ? fromBase(openRound.maxBet) : 1
  const toWin = Number.isFinite(stakeNum) && openRound ? stakeNum * (openRound.payoutBps / 10000) : 0

  return (
    <div>
      <div style={styles.row}>
        <button style={pay(payer === 'wallet')} onClick={() => setPayer('wallet')}>Wallet</button>
        <button style={pay(payer === 'smart')} onClick={() => setPayer('smart')}>
          Smart · gasless{smart.address ? '' : ' (setup)'}
        </button>
      </div>
      {payer === 'smart' ? (
        smart.status === 'ready' && smart.address ? (
          <SmartTradePanel smartAddress={smart.address} />
        ) : (
          <p style={styles.muted}>
            Set up passkey login on the <strong>Account</strong> page first — then trade here with $0 gas.
          </p>
        )
      ) : (
      <>
      <p style={styles.muted}>
        wallet: {walletUsdc == null ? '—' : `$${walletUsdc.toFixed(2)}`} · vault:{' '}
        {vaultBalance == null ? '—' : `$${vaultBalance.toFixed(2)}`}
      </p>
      <div style={styles.row}>
        <input style={styles.input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="$" />
        <button style={styles.ghost} disabled={pending} onClick={() => deposit(Number(amount))}>Deposit</button>
        <button style={styles.ghost} disabled={pending} onClick={() => withdraw(Number(amount))}>Withdraw</button>
      </div>

      {openRound ? (
        <div style={styles.card}>
          <div style={styles.roundHead}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <MarketIcon base="BTC" category="crypto" />
              <strong>BTC · #{String(openRound.id)}</strong>
            </span>
            <span style={entriesOpen ? styles.live : styles.locked}>
              {entriesOpen ? `locks in ${lockIn}s` : 'locking…'}
            </span>
          </div>
          <div style={styles.pool}>
            <span>UP ${fromBase(openRound.upStakes).toFixed(2)}</span>
            <span>DOWN ${fromBase(openRound.downStakes).toFixed(2)}</span>
          </div>
          <div style={styles.row}>
            <input style={styles.input} value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" placeholder="$0.10–$1.00" />
            <span style={styles.muted}>to win ${toWin.toFixed(2)} · max ${effMax.toFixed(2)}</span>
          </div>
          <div style={styles.row}>
            <button style={styles.up} disabled={!entriesOpen || pending} onClick={() => placeBet(openRound.id, true, stakeNum)}>▲ UP</button>
            <button style={styles.down} disabled={!entriesOpen || pending} onClick={() => placeBet(openRound.id, false, stakeNum)}>▼ DOWN</button>
          </div>
        </div>
      ) : (
        <p style={styles.muted}>
          {lockedRound ? `Round #${String(lockedRound.id)} settling…` : 'Waiting for the operator round… (start server/daemon.mjs)'}
        </p>
      )}

      <div style={styles.card}>
        <BetSlip
          bets={myBets.map((b) => {
            const settled = b.roundStatus === 2 || b.roundStatus === 3
            const won =
              b.roundStatus === 2 &&
              ((b.roundResult === 1 && b.up) || (b.roundResult === 2 && !b.up))
            const state = b.claimed
              ? 'claimed'
              : !settled
                ? 'live'
                : b.roundStatus === 3
                  ? 'void'
                  : won
                    ? 'won'
                    : b.roundResult === 3
                      ? 'push'
                      : 'lost'
            return {
              key: String(b.id),
              round: String(b.roundId),
              side: b.up ? 'up' : 'down',
              stake: fromBase(b.stake),
              state,
              returned: won
                ? fromBase(b.stake) * (b.roundPayout / 10000)
                : state === 'push' || state === 'void'
                  ? fromBase(b.stake)
                  : 0,
              claimId: !b.claimed && settled ? b.id : undefined,
            }
          })}
          onClaim={(id) => claim(id as bigint)}
          busy={pending}
        />
      </div>
      {notice && <p style={styles.error}>{notice}</p>}
      {pending && <p style={styles.muted}>Confirm in wallet…</p>}
      </>
      )}
    </div>
  )
}

const pay = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #333',
  background: active ? '#fff' : 'transparent',
  color: active ? '#000' : '#ededed',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
})

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, marginTop: 8 },
  card: { border: '1px solid #26262b', borderRadius: 10, padding: 14, background: '#0f0f12', marginTop: 8 },
  roundHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  live: { color: '#4ade80', fontSize: 13, fontVariantNumeric: 'tabular-nums' },
  locked: { color: '#f5c518', fontSize: 13 },
  pool: { display: 'flex', justifyContent: 'space-between', fontSize: 13, opacity: 0.8, marginBottom: 8 },
  input: { background: '#131316', border: '1px solid #333', color: '#ededed', borderRadius: 8, padding: '8px 12px', width: 90 },
  up: { flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  down: { flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  ghost: { padding: '8px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ededed', cursor: 'pointer', fontSize: 13 },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
}
