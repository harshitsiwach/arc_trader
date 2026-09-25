/**
 * P0 bankroll math — pure functions, zero dependencies.
 * All money in USDC (6-decimal ERC-20 view). Fractions, not percents.
 *
 * Model: each round risks at most L (liability cap). Bettor stakes S + fee.
 * Winner receives payout S * m. House P&L per $1 staked:
 *   E = (1 + f) - p * m        (p = true win prob of the paid side)
 */

/** Expected house profit per $1 staked. */
export function houseEdgePerDollar({ payout, fee, winProb = 0.5 }) {
  return 1 + fee - winProb * payout
}

/** Worst-case net loss the house accepts on one round. */
export function roundLiability(bankroll, liabilityPct) {
  return bankroll * liabilityPct
}

/**
 * Largest single bet s.t. even if it is the whole winning side,
 * net payout (m-1)*B stays within L. Whale cap applied on top.
 */
export function maxSingleBet({ bankroll, liabilityPct, payout, whaleFrac }) {
  const L = roundLiability(bankroll, liabilityPct)
  const raw = L / (payout - 1)
  return { liability: L, raw, capped: raw * whaleFrac }
}

/**
 * Worst-case house net loss for a closed round, ignoring fee income
 * (conservative): every unit staked on the winning side gets (m-1).
 */
export function worstCaseLoss(winningSideStakes, payout) {
  return winningSideStakes * (payout - 1)
}

/**
 * Gambler's ruin: per-round trials risk 1 unit; house loses the unit w.p. q.
 * P(hit ruinLevel before target | start at `units`).
 */
export function ruinProbability({ units, ruinAt, target, q }) {
  const p = 1 - q
  if (q <= 0) return 0
  if (q >= p) return 1
  const r = q / p
  const num = Math.pow(r, units) - Math.pow(r, target)
  const den = Math.pow(r, ruinAt) - Math.pow(r, target)
  return num / den
}

/**
 * Map observable edge into the ruin model: each round turns over handle H = k*L
 * with expected profit e*H. As a unit-risk trial: E = (1-2q)*L  =>  q = (1-e*k)/2.
 * Requires e*k < 1 (edge smaller than one liability unit per handle ratio).
 */
export function impliedQLose({ edge, handleRatio }) {
  const q = (1 - edge * handleRatio) / 2
  if (!(q > 0 && q < 0.5)) {
    throw new Error(`handleRatio ${handleRatio} inconsistent with edge ${edge}`)
  }
  return q
}

/** Expected daily gross given participation assumptions. */
export function dailyProjection({ roundsPerDay, betsPerRound, avgBet, edge }) {
  const handle = roundsPerDay * betsPerRound * avgBet
  return { handle, expectedGross: handle * edge }
}
