/** P1 engine tests: node --test server/engine.test.mjs */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.mjs'
import { PriceFeed } from './feed.mjs'
import { RoundManager } from './rounds.mjs'

// Flash @ $10k BR: L = $20, whale-capped single = $5.
const PRODUCTS = [
  { id: 'flash', label: 't', coin: 'BTC', durationSec: 10, entryCutoffSec: 5, twapSec: 3, payout: 1.8, feePct: 0.015, liabilityPct: 0.002, minBet: 1, maxSkewShare: 0.8 },
]

function setup(bankroll = 10000) {
  const store = new Store('mem', { persist: false, startingBankroll: bankroll })
  const feed = new PriceFeed() // inject-only (no connect)
  const mgr = new RoundManager(store, feed, PRODUCTS, { settleSecret: 'test' })
  return { store, feed, mgr }
}

function fund(store, user, amount = 100) {
  store.getUser(user).balance += amount
}

describe('bet guards', () => {
  it('rejects dust, accepts capped, rejects whale', () => {
    const { store, mgr } = setup()
    fund(store, 'u')
    const r = mgr.createRound(PRODUCTS[0], 1_000_000)
    mgr.now = () => 1_000_001
    assert.equal(mgr.placeBet('u', r.id, 'up', 0.5).ok, false, 'dust rejected')
    assert.equal(mgr.placeBet('u', r.id, 'up', 5).ok, true, 'capped accepted')
    assert.equal(mgr.placeBet('u', r.id, 'up', 5.01).ok, false, 'whale rejected')
  })

  it('first bet of a round always works (skew exempt when small)', () => {
    const { store, mgr } = setup()
    fund(store, 'u')
    const r = mgr.createRound(PRODUCTS[0], 1_000_000)
    mgr.now = () => 1_000_001
    assert.equal(mgr.placeBet('u', r.id, 'up', 5).ok, true)
  })

  it('skew guard blocks piling once sizable, allows contrarian', () => {
    const { store, mgr } = setup()
    for (const u of ['a', 'b', 'c', 'd']) fund(store, u)
    const r = mgr.createRound(PRODUCTS[0], 1_000_000)
    mgr.now = () => 1_000_001
    assert.equal(mgr.placeBet('a', r.id, 'up', 5).ok, true) // up=5, worst 4 <= 10 ok
    assert.equal(mgr.placeBet('b', r.id, 'up', 5).ok, true) // up=10, worst 8 <= 10 ok
    const blocked = mgr.placeBet('c', r.id, 'up', 5)
    assert.equal(blocked.ok, false, 'third one-sided bet trips flow guard')
    assert.match(blocked.reason, /flow guard/)
    assert.equal(mgr.placeBet('c', r.id, 'down', 5).ok, true, 'contrarian always welcome')
  })

  it('liability cap binds balanced books (round full)', () => {
    const { store, mgr } = setup()
    const users = Array.from({ length: 12 }, (_, i) => `u${i}`)
    for (const u of users) fund(store, u)
    const r = mgr.createRound(PRODUCTS[0], 1_000_000)
    mgr.now = () => 1_000_001
    // Alternate sides $5: share stays 50%, guard silent; each side caps at $25 (worst $20 = L).
    for (let i = 0; i < 10; i++) {
      const out = mgr.placeBet(users[i], r.id, i % 2 ? 'down' : 'up', 5)
      assert.equal(out.ok, true, `bet ${i} accepted`)
    }
    const full = mgr.placeBet(users[10], r.id, 'up', 5)
    assert.equal(full.ok, false, '11th bet exceeds liability')
    assert.match(full.reason, /round full/)
  })
})

describe('settle / void', () => {
  it('pays winners, books bankroll delta + signature', () => {
    const { store, feed, mgr } = setup()
    fund(store, 'w')
    const r = mgr.createRound(PRODUCTS[0], 1_000_000)
    mgr.now = () => 1_000_001
    mgr.placeBet('w', r.id, 'up', 5) // fee 0.075
    feed.inject('BTC', 100, 1_004_000)
    mgr.now = () => 1_006_000
    mgr.lock(r)
    assert.equal(r.refPrice, 100)
    feed.inject('BTC', 101, 1_009_000)
    feed.inject('BTC', 101, 1_009_500)
    mgr.now = () => 1_011_000
    mgr.settle(r)
    assert.equal(r.result, 'up')
    assert.ok(r.signature && r.signature.length === 64)
    const u = store.getUser('w')
    assert.ok(Math.abs(u.balance - (100 - 5.075 + 9)) < 1e-9, `balance ${u.balance}`)
    assert.ok(Math.abs(store.state.bankroll - (10000 + 0.075 - 4)) < 1e-9, `bankroll ${store.state.bankroll}`)
    assert.equal(store.state.bets[0].status, 'won')
  })

  it('tie refunds stakes (push)', () => {
    const { store, feed, mgr } = setup()
    fund(store, 'w')
    const r = mgr.createRound(PRODUCTS[0], 1_000_000)
    mgr.now = () => 1_000_001
    mgr.placeBet('w', r.id, 'up', 5)
    feed.inject('BTC', 100, 1_004_000)
    mgr.now = () => 1_006_000
    mgr.lock(r)
    feed.inject('BTC', 100, 1_009_000)
    mgr.now = () => 1_011_000
    mgr.settle(r)
    assert.equal(r.result, 'push')
    assert.ok(Math.abs(store.getUser('w').balance - (100 - 0.075)) < 1e-9)
  })

  it('void refunds stake + fee when priceless', () => {
    const { store, mgr } = setup()
    fund(store, 'w')
    const r = mgr.createRound(PRODUCTS[0], 1_000_000)
    mgr.now = () => 1_000_001
    mgr.placeBet('w', r.id, 'up', 5)
    mgr.now = () => 1_006_000
    mgr.lock(r) // no feed data -> void
    assert.equal(r.status, 'void')
    assert.ok(Math.abs(store.getUser('w').balance - 100) < 1e-9)
    assert.ok(Math.abs(store.state.bankroll - 10000) < 1e-9)
  })
})

describe('loop + daily stop', () => {
  it('tick locks then settles a full lifecycle', () => {
    const { store, feed, mgr } = setup()
    feed.inject('BTC', 100, 0)
    let t = 1_000_000
    mgr.now = () => t
    mgr.tick()
    const r = store.state.rounds[0]
    assert.equal(r.status, 'open')
    t = r.lockAt + 1
    feed.inject('BTC', 100, t)
    mgr.tick()
    assert.equal(r.status, 'locked')
    assert.equal(r.refPrice, 100)
    t = r.expiresAt + 1
    feed.inject('BTC', 102, t - 1000)
    mgr.tick()
    assert.equal(r.status, 'settled')
    assert.equal(r.result, 'up')
  })

  it('daily stop-loss halts new rounds', () => {
    const { store, mgr } = setup()
    mgr.now = () => 1_000_000
    store.state.dayPnl = -500 // -5% of 10k
    mgr.tick()
    assert.equal(store.state.rounds.length, 0, 'no rounds while halted')
    store.state.dayPnl = 0
    mgr.tick()
    assert.equal(store.state.rounds.length, 1, 'rounds resume')
  })
})
