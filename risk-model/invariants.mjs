/**
 * P0 invariants — the five survival rules as machine-checkable predicates.
 * P1 server calls these before accepting bets / closing rounds;
 * P2 contracts enforce the onchain-subset (marked [CHAIN]).
 */
import { worstCaseLoss, roundLiability } from './model.mjs'

export function checkBet({ bet, bankroll, p }) {
  if (bet < p.minBetUsdc) return fail(`bet ${bet} below min ${p.minBetUsdc}`)
  const L = roundLiability(bankroll, p.maxLiabilityPctPerRound)
  const maxSingle = (L / (p.payoutMultiplier - 1)) * p.whaleFracOfLiability
  if (bet > maxSingle) return fail(`bet ${bet} exceeds whale-capped max ${maxSingle.toFixed(2)}`)
  return ok()
}

/** [CHAIN] Closed round must satisfy worst-case payout within liability. */
export function checkRoundLiability({ upStakes, downStakes, bankroll, p }) {
  const L = roundLiability(bankroll, p.maxLiabilityPctPerRound)
  const worst = Math.max(worstCaseLoss(upStakes, p.payoutMultiplier), worstCaseLoss(downStakes, p.payoutMultiplier))
  if (worst > L + 1e-9) return fail(`worst-case loss ${worst.toFixed(2)} exceeds liability ${L.toFixed(2)}`)
  return ok()
}

/** One-sided flow guard: dominant side share must stay under cap. */
export function checkSkew({ upStakes, downStakes, maxShare = 0.75 }) {
  const total = upStakes + downStakes
  if (total <= 0) return ok()
  const share = Math.max(upStakes, downStakes) / total
  if (share > maxShare) return fail(`dominant side ${(share * 100).toFixed(1)}% exceeds ${(maxShare * 100).toFixed(0)}% — shade payout or halt entries`)
  return ok()
}

/** [CHAIN] Payout multiplier is never fair-or-better. */
export function checkPayout({ payout }) {
  if (payout >= 2) return fail(`payout ${payout} must be < 2.0 (sub-fair)`)
  return ok()
}

/** Daily stop-loss: halt new rounds once day P&L breaches -dailyStopLossPct. */
export function checkDailyStop({ dayPnl, bankroll, p }) {
  if (dayPnl <= -bankroll * p.dailyStopLossPct) {
    return fail(`day P&L ${dayPnl.toFixed(2)} breached stop-loss — halt new rounds`)
  }
  return ok()
}

function ok() {
  return { ok: true, reason: '' }
}
function fail(reason) {
  return { ok: false, reason }
}
