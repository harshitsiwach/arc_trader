/** P0 runner: prints tables, writes tables.md, runs invariant self-tests. */
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import {
  houseEdgePerDollar,
  maxSingleBet,
  ruinProbability,
  impliedQLose,
  dailyProjection,
} from './model.mjs'
import { checkBet, checkRoundLiability, checkSkew, checkPayout, checkDailyStop } from './invariants.mjs'

const p = JSON.parse(readFileSync(new URL('./params.json', import.meta.url)))
const usd = (n) => '$' + n.toLocaleString('en-US')
const edge = houseEdgePerDollar({ payout: p.payoutMultiplier, fee: p.entryFeePct, winProb: p.referenceWinProb })

const lines = []
lines.push('# P0 risk tables (generated — do not hand-edit)')
lines.push(`\nParams: payout ${p.payoutMultiplier}x, fee ${(p.entryFeePct * 100).toFixed(1)}%, liability ${(p.maxLiabilityPctPerRound * 100).toFixed(1)}%/round, whale cap ${(p.whaleFracOfLiability * 100).toFixed(0)}% of liability-implied max.`)
lines.push(`\nHouse edge per $1 staked @50/50: **${(edge * 100).toFixed(2)}%**`)

// --- Tier table ---
lines.push('\n## Max-bet table per bankroll tier')
lines.push('\n| Bankroll | Round liability (1%) | Max single bet (raw) | Whale-capped bet |')
lines.push('| --- | --- | --- | --- |')
for (const br of p.tiersUsdc) {
  const t = maxSingleBet({ bankroll: br, liabilityPct: p.maxLiabilityPctPerRound, payout: p.payoutMultiplier, whaleFrac: p.whaleFracOfLiability })
  lines.push(`| ${usd(br)} | $${t.liability.toFixed(2)} | $${t.raw.toFixed(2)} | $${t.capped.toFixed(2)} |`)
}

// --- Ruin table: bankroll = 100 liability units, ruin = -50u, target = +100u ---
lines.push('\n## Ruin probability (lose 50% of bankroll before doubling it)')
lines.push('\n| Daily handle ratio (H/L) | Implied q (lose unit) | P(ruin) |')
lines.push('| --- | --- | --- |')
for (const k of [2, 4, 8]) {
  const q = impliedQLose({ edge, handleRatio: k })
  const ruin = ruinProbability({ units: 100, ruinAt: 50, target: 200, q })
  lines.push(`| ${k}x | ${q.toFixed(4)} | ${ruin.toExponential(2)} |`)
}

// --- Daily projection: 5m rounds -> 288/day, assume 30% fill, 8 bets/round avg $10 scaled by tier ---
lines.push('\n## Daily projection (5m rounds, 288/day @30% fill ≈ 86 rounds, 8 bets/round @ tier-scaled avg)')
lines.push('\n| Bankroll | Avg bet | Handle/day | Expected gross/day |')
lines.push('| --- | --- | --- | --- |')
for (const br of p.tiersUsdc) {
  const avgBet = Math.max(p.minBetUsdc, maxSingleBet({ bankroll: br, liabilityPct: p.maxLiabilityPctPerRound, payout: p.payoutMultiplier, whaleFrac: p.whaleFracOfLiability }).capped / 2)
  const d = dailyProjection({ roundsPerDay: 86, betsPerRound: 8, avgBet, edge })
  lines.push(`| ${usd(br)} | $${avgBet.toFixed(2)} | $${d.handle.toFixed(0)} | $${d.expectedGross.toFixed(0)} |`)
}

writeFileSync(new URL('./tables.md', import.meta.url), lines.join('\n') + '\n')
console.log(lines.join('\n'))

// --- Self-tests ---
assert.ok(edge > 0.08 && edge < 0.1, `edge ${edge} should be ~9%`)
const t10k = maxSingleBet({ bankroll: 10000, liabilityPct: 0.01, payout: 1.85, whaleFrac: 0.2 })
assert.ok(Math.abs(t10k.capped - 23.53) < 0.01, `whale-capped bet ${t10k.capped}`)
assert.equal(checkBet({ bet: 10, bankroll: 10000, p }).ok, true)
assert.equal(checkBet({ bet: 24, bankroll: 10000, p }).ok, false, 'whale cap must reject $24 @ $10k BR')
assert.equal(checkBet({ bet: 0.5, bankroll: 10000, p }).ok, false, 'min bet must reject dust')
assert.equal(checkRoundLiability({ upStakes: 100, downStakes: 20, bankroll: 10000, p }).ok, true)
assert.equal(checkRoundLiability({ upStakes: 200, downStakes: 0, bankroll: 10000, p }).ok, false, 'must reject over-liability round')
assert.equal(checkSkew({ upStakes: 90, downStakes: 10 }).ok, false, 'must flag 90% skew')
assert.equal(checkSkew({ upStakes: 60, downStakes: 40 }).ok, true)
assert.equal(checkPayout({ payout: 1.85 }).ok, true)
assert.equal(checkPayout({ payout: 2.0 }).ok, false, 'must reject fair-or-better payout')
assert.equal(checkDailyStop({ dayPnl: -100, bankroll: 10000, p }).ok, true)
assert.equal(checkDailyStop({ dayPnl: -500, bankroll: 10000, p }).ok, false, 'must halt at -5% day')
const ruinWorst = ruinProbability({ units: 100, ruinAt: 50, target: 200, q: impliedQLose({ edge, handleRatio: 8 }) })
assert.ok(ruinWorst < 0.001, `ruin ${ruinWorst} must be < 0.1%`)
console.log('\nAll P0 self-tests passed.')
