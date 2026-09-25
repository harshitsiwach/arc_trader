/** P1 server config. Risk numbers inherit risk-model/params.json; products add per-duration tuning. */
import { readFileSync } from 'node:fs'

const risk = JSON.parse(readFileSync(new URL('../risk-model/params.json', import.meta.url)))

export const config = {
  port: Number(process.env.PORT ?? 8787),
  settleSecret: process.env.SETTLE_SECRET ?? 'dev-secret-change-me',
  dataPath: new URL(process.env.DATA_PATH ?? './data.json', import.meta.url),
  startingBankroll: Number(process.env.START_BANKROLL ?? 10000),
  demoFaucetAmount: 1000,
  demoFaucetCap: 10000, // max demo balance per user
  risk,
  products: [
    {
      // 10s "1000x-style" flash rounds. Real 1000x linear payout is uninsurable
      // (unbounded liability + notional fees >> margin), so this is a fixed-payout
      // binary with 1000x-like short-horizon exposure. Payout 1.80x (below the
      // 1.85x standard) prices in the extra latency-arb risk of 10s windows.
      // Liability 0.2%/round: at ~864 rounds/day, sqrt(n)*L daily vol stays sane.
      id: 'flash-10s',
      label: '10s Flash ⚡1000x-style',
      coin: 'BTC',
      durationSec: 10,
      entryCutoffSec: 5, // entries only in first half — late-window sniping is fatal at 10s
      twapSec: 3,
      payout: 1.8,
      feePct: risk.entryFeePct,
      liabilityPct: 0.002,
      minBet: risk.minBetUsdc,
      maxSkewShare: 0.8,
    },
    {
      id: 'std-5m',
      label: '5m Classic',
      coin: 'BTC',
      durationSec: 300,
      entryCutoffSec: risk.entryCutoffSec,
      twapSec: risk.settlementTwapSec,
      payout: risk.payoutMultiplier,
      feePct: risk.entryFeePct,
      liabilityPct: risk.maxLiabilityPctPerRound,
      minBet: risk.minBetUsdc,
      maxSkewShare: 0.8,
    },
  ],
}
