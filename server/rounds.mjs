/**
 * P1 round engine. One open round per product; next opens when the current locks.
 * Enforces risk-model invariants on every transition. Money = demo USDC ledger.
 */
import { checkBet, checkRoundLiability, checkPayout, checkDailyStop } from '../risk-model/invariants.mjs'
import { worstCaseLoss, roundLiability } from '../risk-model/model.mjs'
import { signResult } from './settle.mjs'

const TICK_MS = 250

export class RoundManager {
  constructor(store, feed, products, { settleSecret }) {
    this.s = store
    this.feed = feed
    this.products = new Map(products.map((p) => [p.id, p]))
    this.secret = settleSecret
    this.timer = null
    for (const p of products) {
      const bad = checkPayout({ payout: p.payout })
      if (!bad.ok) throw new Error(`product ${p.id}: ${bad.reason}`)
    }
  }

  start() {
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  now() {
    return Date.now()
  }

  ensureDay() {
    const day = new Date().toISOString().slice(0, 10)
    if (this.s.state.day !== day) {
      this.s.state.day = day
      this.s.state.dayPnl = 0
      this.s.save()
    }
  }

  tradingHalted(bankroll) {
    return !checkDailyStop({ dayPnl: this.s.state.dayPnl, bankroll, p: { dailyStopLossPct: 0.05 } }).ok
  }

  openRound(productId) {
    return this.s.state.rounds.find((r) => r.productId === productId && r.status === 'open') ?? null
  }

  createRound(product, t) {
    const r = {
      id: this.s.nextId('r'),
      productId: product.id,
      coin: product.coin,
      payout: product.payout,
      feePct: product.feePct,
      openAt: t,
      lockAt: t + (product.durationSec - product.entryCutoffSec) * 1000,
      expiresAt: t + product.durationSec * 1000,
      refPrice: null,
      settlePrice: null,
      result: null,
      status: 'open',
      upStakes: 0,
      downStakes: 0,
      signature: null,
    }
    this.s.state.rounds.push(r)
    this.s.save()
    return r
  }

  tick() {
    this.ensureDay()
    const t = this.now()
    const st = this.s.state
    for (const product of this.products.values()) {
      if (this.tradingHalted(st.bankroll)) continue
      if (!this.openRound(product.id)) this.createRound(product, t)
    }
    for (const r of st.rounds) {
      if (r.status === 'open' && t >= r.lockAt) this.lock(r)
      else if (r.status === 'locked' && t >= r.expiresAt) this.settle(r)
    }
  }

  lock(r) {
    const mid = this.feed.getMid(r.coin)
    if (mid == null) return this.void(r, 'no reference price at lock')
    r.refPrice = mid
    r.status = 'locked'
    this.s.save()
    // Open the next round immediately so there is always an open board.
    const product = this.products.get(r.productId)
    if (product && !this.tradingHalted(this.s.state.bankroll)) this.createRound(product, this.now())
  }

  placeBet(userId, roundId, side, stake) {
    const st = this.s.state
    const r = st.rounds.find((x) => x.id === roundId)
    if (!r) return err('round not found')
    if (r.status !== 'open') return err('round not open')
    if (this.now() >= r.lockAt) return err('entries closed')
    if (side !== 'up' && side !== 'down') return err('side must be up|down')
    stake = Number(stake)
    if (!Number.isFinite(stake) || stake <= 0) return err('invalid stake')

    const product = this.products.get(r.productId)
    const p = {
      minBetUsdc: product.minBet,
      payoutMultiplier: product.payout,
      maxLiabilityPctPerRound: product.liabilityPct,
      whaleFracOfLiability: 0.2,
    }
    const c1 = checkBet({ bet: stake, bankroll: st.bankroll, p })
    if (!c1.ok) return err(c1.reason)

    // Liability simulation with this bet included.
    const up = r.upStakes + (side === 'up' ? stake : 0)
    const down = r.downStakes + (side === 'down' ? stake : 0)
    const c2 = checkRoundLiability({ upStakes: up, downStakes: down, bankroll: st.bankroll, p })
    if (!c2.ok) return err('round full — ' + c2.reason)

    // Skew guard (risk-model policy): once the dominant side is SIZABLE
    // (>50% of round liability at risk), stop deepening it past the share cap.
    // Small early books are exempt so the first bet of a round always works;
    // contrarian bets that reduce skew are always welcome — they fund the book.
    const total = up + down
    const domSide = up >= down ? 'up' : 'down'
    const L = roundLiability(st.bankroll, product.liabilityPct)
    const worstDom = Math.max(up, down) * (product.payout - 1)
    if (
      total > 0 &&
      side === domSide &&
      Math.max(up, down) / total > product.maxSkewShare &&
      worstDom > 0.5 * L
    ) {
      return err(`flow guard: ${domSide} book is full — try the other side`)
    }

    const user = this.s.getUser(userId)
    const fee = stake * product.feePct
    if (user.balance < stake + fee) return err('insufficient balance — use faucet')
    user.balance -= stake + fee
    st.bankroll += fee
    if (side === 'up') r.upStakes += stake
    else r.downStakes += stake
    const bet = { id: this.s.nextId('b'), user: userId, round: r.id, side, stake, fee, status: 'live' }
    st.bets.push(bet)
    this.s.save()
    return { ok: true, bet }
  }

  settle(r) {
    const st = this.s.state
    const product = this.products.get(r.productId)
    const px = this.feed.twap(r.coin, product.twapSec, this.now()) ?? this.feed.getMid(r.coin)
    if (px == null || r.refPrice == null) return this.void(r, 'no settlement price')
    r.settlePrice = px
    r.result = px > r.refPrice ? 'up' : px < r.refPrice ? 'down' : 'push'
    r.status = 'settled'

    const winners = st.bets.filter((b) => b.round === r.id && b.status === 'live' && b.side === r.result)
    const losers = st.bets.filter((b) => b.round === r.id && b.status === 'live' && b.side !== r.result && r.result !== 'push')
    const pushes = r.result === 'push' ? st.bets.filter((b) => b.round === r.id && b.status === 'live') : []

    let profitPaid = 0
    let loserStakes = 0
    for (const b of winners) {
      const u = this.s.getUser(b.user)
      u.balance += b.stake * r.payout
      profitPaid += b.stake * (r.payout - 1)
      b.status = 'won'
      b.payout = b.stake * r.payout
    }
    for (const b of losers) {
      loserStakes += b.stake
      b.status = 'lost'
    }
    for (const b of pushes) {
      const u = this.s.getUser(b.user)
      u.balance += b.stake
      b.status = 'push'
      b.payout = b.stake
    }
    const delta = loserStakes - profitPaid
    st.bankroll += delta
    st.dayPnl += delta
    r.signature = signResult(this.secret, r)
    this.s.save()
    return { ok: true, round: r }
  }

  void(r, reason) {
    const st = this.s.state
    for (const b of st.bets.filter((b) => b.round === r.id && b.status === 'live')) {
      const u = this.s.getUser(b.user)
      u.balance += b.stake + b.fee // full refund incl. fee on operator-side voids
      st.bankroll -= b.fee
      b.status = 'void'
    }
    r.status = 'void'
    r.result = 'void'
    r.voidReason = reason
    this.s.save()
    return { ok: true, round: r }
  }

  /** Liability actually consumed by currently-open rounds (for monitoring). */
  openExposure() {
    return this.s.state.rounds
      .filter((r) => r.status === 'open' || r.status === 'locked')
      .map((r) => {
        const product = this.products.get(r.productId)
        const L = roundLiability(this.s.state.bankroll, product.liabilityPct)
        const worst = Math.max(
          worstCaseLoss(r.upStakes, r.payout),
          worstCaseLoss(r.downStakes, r.payout),
        )
        return { round: r.id, product: r.productId, worst, liability: L, pct: L ? worst / L : 0 }
      })
  }
}

function err(reason) {
  return { ok: false, reason }
}
