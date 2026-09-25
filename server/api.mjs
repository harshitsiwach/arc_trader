/** P1 HTTP API. node:http, zero deps. CORS open for the local frontend. */
import { createServer } from 'node:http'

export function startApi({ port, store, manager, products, faucet }) {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return end(res, 204, '')

    const url = new URL(req.url, 'http://x')
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return end(res, 200, { ok: true, time: Date.now() })
      }
      if (req.method === 'GET' && url.pathname === '/api/products') {
        return end(res, 200, { products: products.map(publicProduct) })
      }
      if (req.method === 'GET' && url.pathname === '/api/rounds') {
        const productId = url.searchParams.get('product') ?? undefined
        const status = url.searchParams.get('status') ?? undefined
        let rounds = [...store.state.rounds].reverse()
        if (productId) rounds = rounds.filter((r) => r.productId === productId)
        if (status) rounds = rounds.filter((r) => r.status === status)
        return end(res, 200, { time: Date.now(), rounds: rounds.slice(0, 30) })
      }
      const roundMatch = url.pathname.match(/^\/api\/rounds\/([\w-]+)$/)
      if (req.method === 'GET' && roundMatch) {
        const r = store.state.rounds.find((x) => x.id === roundMatch[1])
        if (!r) return end(res, 404, { error: 'round not found' })
        const bets = store.state.bets.filter((b) => b.round === r.id)
        return end(res, 200, { time: Date.now(), round: r, bets: summarizeBets(bets) })
      }
      if (req.method === 'POST' && url.pathname === '/api/bets') {
        const body = await json(req)
        const out = manager.placeBet(String(body.user ?? 'anon'), String(body.roundId ?? ''), body.side, Number(body.stake))
        if (!out.ok) return end(res, 400, { error: out.reason })
        return end(res, 200, { bet: out.bet, balance: store.getUser(String(body.user ?? 'anon')).balance })
      }
      if (req.method === 'POST' && url.pathname === '/api/deposit') {
        // DEMO faucet: free play-money. P2 replaces this with real Arc USDC deposits.
        const body = await json(req)
        const user = store.getUser(String(body.user ?? 'anon'))
        const amount = Math.min(Number(body.amount ?? faucet.amount), faucet.amount)
        if (!Number.isFinite(amount) || amount <= 0) return end(res, 400, { error: 'invalid amount' })
        if (user.balance + amount > faucet.cap) return end(res, 400, { error: `demo cap $${faucet.cap}` })
        user.balance += amount
        store.save()
        return end(res, 200, { balance: user.balance, demo: true })
      }
      const acctMatch = url.pathname.match(/^\/api\/account\/([\w.-]+)$/)
      if (req.method === 'GET' && acctMatch) {
        const id = decodeURIComponent(acctMatch[1])
        const user = store.getUser(id)
        const bets = store.state.bets.filter((b) => b.user === id).slice(-20).reverse()
        return end(res, 200, { user: id, balance: user.balance, bets, demo: true })
      }
      if (req.method === 'GET' && url.pathname === '/api/bankroll') {
        return end(res, 200, {
          bankroll: store.state.bankroll,
          startingBankroll: store.state.startingBankroll,
          dayPnl: store.state.dayPnl,
          exposure: manager.openExposure(),
        })
      }
      if (req.method === 'POST' && url.pathname === '/api/onramp/sessions') {
        return onrampSession(req, res)
      }
      return end(res, 404, { error: 'not found' })
    } catch (e) {
      return end(res, 500, { error: e instanceof Error ? e.message : 'internal error' })
    }
  })
  server.listen(port, () => console.log(`[api] listening :${port}`))
  return server
}

function publicProduct(p) {
  return { id: p.id, label: p.label, coin: p.coin, durationSec: p.durationSec, entryCutoffSec: p.entryCutoffSec, payout: p.payout, feePct: p.feePct, minBet: p.minBet }
}

function summarizeBets(bets) {
  const up = bets.filter((b) => b.side === 'up').reduce((s, b) => s + b.stake, 0)
  const down = bets.filter((b) => b.side === 'down').reduce((s, b) => s + b.stake, 0)
  return { count: bets.length, upStakes: up, downStakes: down }
}

/**
 * Fiat onramp session minting (App Kit Onramp widget).
 * Needs CIRCLE_API_KEY (+ REFERRER_DOMAIN for cards/Apple/Google Pay) in env.
 * Without a key this answers 501 and the frontend shows setup instructions.
 */
async function onrampSession(req, res) {
  if (!process.env.CIRCLE_API_KEY) {
    return end(res, 501, {
      error: 'onramp not configured — set CIRCLE_API_KEY (+ REFERRER_DOMAIN for cards) and restart the engine',
    })
  }
  const { createAppServerKit, createSessionRouteHandler } = await import('@circle-fin/app-kit/server')
  const serverKit = createAppServerKit({
    onramp: {
      apiKey: process.env.CIRCLE_API_KEY,
      referrerDomain: process.env.REFERRER_DOMAIN ?? 'localhost',
    },
  })
  const handler = createSessionRouteHandler(serverKit.onramp)
  const raw = await new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 65536) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(body))
  })
  // Bridge node:http into the Fetch-standard handler (Node 22 globals).
  const request = new Request('http://local/api/onramp/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw || '{}',
  })
  const response = await handler(request)
  const text = await response.text()
  const headers = {}
  response.headers.forEach((v, k) => {
    if (!['content-length', 'connection'].includes(k.toLowerCase())) headers[k] = v
  })
  headers['cache-control'] = 'no-store'
  res.writeHead(response.status, { 'content-type': 'application/json', ...headers })
  res.end(text)
}

function end(res, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' })
  res.end(text)
}

function json(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1e6) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
  })
}
