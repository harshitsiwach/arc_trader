/**
 * P2 operator daemon — runs 1-minute up/down rounds on Arc Testnet.
 *   RPC_URL=... VAULT_ADDR=... ROUNDS_ADDR=... OPERATOR_KEY=... [SETTLER_KEY=...] node daemon.mjs
 *   DRY_RUN=1 → reads + logs intended actions, sends nothing.
 *
 * The operator key NEVER leaves this machine: run it on your own server.
 * Caps follow the AUDITED (full-payout) math, sized live from houseBalance:
 *   L = house * 0.25% ; round maxBet = min($1.00, floor(L / 1.85 to cents))
 * $1 bets unlock automatically once the bankroll passes ~$740.
 */
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { PriceFeed } from './feed.mjs'
import { signLock, signSettle, toFixed8 } from './signer.mjs'
import vaultAbi from '../app/src/lib/abi-Vault.json' with { type: 'json' }
import roundsAbi from '../app/src/lib/abi-Rounds.json' with { type: 'json' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DRY = process.env.DRY_RUN === '1'
const CENT = 10_000n // $0.01 in USDC base units

const PRODUCT = {
  id: 'one-1m',
  coin: 'BTC',
  durationSec: 60,
  entryCutoffSec: 10,
  twapSec: 5,
  payoutBps: 18500, // 1.85x
  feeBps: 150, // 1.5%
  liabilityPctBps: 25, // 0.25% of house per round
  minBet: 100_000n, // $0.10
  maxBetCap: 1_000_000n, // $1.00 (effective max also gated by liability sizing)
  maxSkewBps: 8000,
  dailyStopPctBps: 500, // halt new rounds at -5% day
}

const rpc = process.env.RPC_URL ?? 'https://rpc.testnet.arc.io'
const VAULT = process.env.VAULT_ADDR ?? '0x92Bdf0aC7E33FF4D2ae6026c370b893dcd47Dc2c'
const ROUNDS = process.env.ROUNDS_ADDR ?? '0xCe10F9bed67F23814f5304931cB554beE3bcCD54'
const STATE_PATH = new URL('./daemon-state.json', import.meta.url)

function loadState() {
  const day = new Date().toISOString().slice(0, 10)
  if (existsSync(STATE_PATH)) {
    try {
      const s = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
      if (s.day === day) return s
    } catch { /* reset */ }
  }
  return { day, dayStartHouse: null }
}

async function main() {
  let key = process.env.OPERATOR_KEY
  if (key && !key.startsWith('0x')) key = `0x${key}`
  if (!key && !DRY) throw new Error('OPERATOR_KEY required (omit only with DRY_RUN=1)')
  const settlerKey = process.env.SETTLER_KEY ?? key

  const boot = createPublicClient({ transport: http(rpc) })
  const chainIdNum = await boot.getChainId()
  const chain = defineChain({
    id: chainIdNum, name: 'arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  })
  const publicClient = createPublicClient({ chain, transport: http(rpc) })
  const account = key ? privateKeyToAccount(key) : null
  const wallet = account ? createWalletClient({ account, chain, transport: http(rpc) }) : null
  const chainId = BigInt(chainIdNum)

  const feed = new PriceFeed()
  feed.connect()
  // Wait for first ticks so lock/settle never run blind.
  for (let i = 0; i < 30 && feed.getMid(PRODUCT.coin) == null; i++) await sleep(1000)
  if (feed.getMid(PRODUCT.coin) == null) throw new Error('no Hyperliquid feed — aborting')

  const state = loadState()
  const coinBytes = `0x${Buffer.from(PRODUCT.coin.padEnd(32, '\0')).toString('hex')}`
  console.log(`[daemon] ${DRY ? 'DRY-RUN' : 'LIVE'} chain=${chainIdNum} vault=${VAULT} rounds=${ROUNDS}`)

  for (;;) {
    try {
      await tick(publicClient, wallet, feed, state, coinBytes, chainId)
    } catch (e) {
      console.error('[daemon] tick error:', e.shortMessage ?? e.message)
    }
    await sleep(2000)
  }
}

async function tick(publicClient, wallet, feed, state, coinBytes, chainId) {
  const now = Math.floor(Date.now() / 1000)
  const house = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'houseBalance' })
  if (state.dayStartHouse == null) {
    state.dayStartHouse = house.toString()
    persist(state)
  }
  const dayStart = BigInt(state.dayStartHouse)

  // Daily stop-loss → pause (operator), halt creation.
  if (house * 10000n < dayStart * BigInt(10000 - PRODUCT.dailyStopPctBps)) {
    console.error(`[daemon] STOP-LOSS: house ${fmt(house)} < 95% of ${fmt(dayStart)} — pausing`)
    if (!DRY) {
      await wallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'pause' })
      await wallet.writeContract({ address: ROUNDS, abi: roundsAbi, functionName: 'pause' })
    } else console.log('[daemon] DRY: would pause Vault + Rounds')
    await sleep(60000)
    return
  }

  const L = (house * BigInt(PRODUCT.liabilityPctBps)) / 10000n
  let maxBet = (L * 10000n) / BigInt(PRODUCT.payoutBps) // full-payout math (audited)
  maxBet -= maxBet % CENT // floor to cents
  if (maxBet > PRODUCT.maxBetCap) maxBet = PRODUCT.maxBetCap

  const count = await publicClient.readContract({ address: ROUNDS, abi: roundsAbi, functionName: 'roundCount' })
  let open = null
  let locked = null
  // Scan last few rounds (trial scale; P4 uses event indexing).
  for (let id = count; id > 0n && id > count - 6n; id--) {
    const r = await publicClient.readContract({ address: ROUNDS, abi: roundsAbi, functionName: 'rounds', args: [id] })
    const status = r[8] // struct: coin,lockAt,expiresAt,payoutBps,feeBps,maxLiability,maxBet,maxSkewBps,status,...
    if (status === 0) open = { id, r }
    if (status === 1) locked = { id, r }
  }

  if (!open) {
    if (maxBet < PRODUCT.minBet) {
      console.warn(`[daemon] bankroll too small: maxBet ${fmt(maxBet)} < min $${fmt(PRODUCT.minBet)} — skipping creation`)
      return
    }
    const lockAt = BigInt(now + (PRODUCT.durationSec - PRODUCT.entryCutoffSec))
    const expiresAt = BigInt(now + PRODUCT.durationSec)
    console.log(`[daemon] create 1m round: L=$${fmt(L)} maxBet=$${fmt(maxBet)}`)
    if (!DRY) {
      const h = await wallet.writeContract({
        address: ROUNDS, abi: roundsAbi, functionName: 'createRound',
        args: [coinBytes, lockAt, expiresAt, PRODUCT.payoutBps, PRODUCT.feeBps, L, maxBet, PRODUCT.maxSkewBps],
      })
      await publicClient.waitForTransactionReceipt({ hash: h })
      console.log('[daemon] round created:', h)
    }
    return
  }

  const lockAt = Number(open.r[1])
  const expiresAt = Number(open.r[2])
  if (now >= lockAt) {
    const mid = feed.getMid(PRODUCT.coin)
    if (mid == null) { console.warn('[daemon] no mid at lock — waiting'); return }
    const refPx = toFixed8(String(mid))
    console.log(`[daemon] lock #${open.id} @ ${mid}`)
    if (!DRY) {
      const sig = await signLock(settlerKeyOf(), chainId, ROUNDS, open.id, refPx)
      const h = await wallet.writeContract({
        address: ROUNDS, abi: roundsAbi, functionName: 'lockRound',
        args: [open.id, refPx, sig.v, sig.r, sig.s],
      })
      await publicClient.waitForTransactionReceipt({ hash: h })
    }
    return
  }
  void expiresAt

  if (locked) {
    const lex = Number(locked.r[2])
    if (now >= lex) {
      const px = feed.twap(PRODUCT.coin, PRODUCT.twapSec) ?? feed.getMid(PRODUCT.coin)
      if (px == null) { console.warn('[daemon] no price at settle — waiting'); return }
      const settlePx = toFixed8(String(px))
      console.log(`[daemon] settle #${locked.id} @ ${px}`)
      if (!DRY) {
        const sig = await signSettle(settlerKeyOf(), chainId, ROUNDS, locked.id, settlePx)
        const h = await wallet.writeContract({
          address: ROUNDS, abi: roundsAbi, functionName: 'settleRound',
          args: [locked.id, settlePx, sig.v, sig.r, sig.s],
        })
        await publicClient.waitForTransactionReceipt({ hash: h })
      }
    }
  }

  function settlerKeyOf() {
    const k = process.env.SETTLER_KEY ?? process.env.OPERATOR_KEY
    if (!k) throw new Error('settler key missing')
    return k.startsWith('0x') ? k : `0x${k}`
  }
}

function persist(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function fmt(baseUnits) {
  return (Number(baseUnits) / 1e6).toFixed(2)
}

main().catch((e) => {
  console.error('[daemon] FATAL', e.shortMessage ?? e.message)
  process.exit(1)
});
