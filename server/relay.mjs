/**
 * P2 operator relay rehearsal: runs ONE full round lifecycle onchain.
 *   RPC_URL=... ROUNDS_ADDR=... OPERATOR_KEY=... SETTLER_KEY=... node relay.mjs flash-10s
 * Uses live Hyperliquid mids (REST) for lock ref + mini-TWAP settle.
 * OPERATOR_KEY and SETTLER_KEY may be the same in rehearsal.
 */
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { config } from './config.mjs'
import { ROUNDS_ABI, signLock, signSettle, toFixed8 } from './signer.mjs'

const ROUNDS_ABI_PLUS = [
  ...ROUNDS_ABI,
  ...parseAbi([
    'function createRound(bytes32 coin, uint64 lockAt, uint64 expiresAt, uint32 payoutBps, uint32 feeBps, uint128 maxLiability, uint128 maxBet, uint16 maxSkewBps) returns (uint256)',
    'function roundCount() view returns (uint256)',
  ]),
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function hlMid(coin) {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  })
  const j = await res.json()
  const mids = j.mids ?? j
  const px = mids[coin]
  if (px == null) throw new Error(`no HL mid for ${coin}`)
  return px
}

async function main() {
  const productId = process.argv[2] ?? 'flash-10s'
  const product = config.products.find((p) => p.id === productId)
  if (!product) throw new Error(`unknown product ${productId}`)

  const rpc = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
  const roundsAddr = process.env.ROUNDS_ADDR
  if (!roundsAddr) throw new Error('ROUNDS_ADDR required')
  const operator = privateKeyToAccount(process.env.OPERATOR_KEY)
  const settlerKey = process.env.SETTLER_KEY ?? process.env.OPERATOR_KEY

  const boot = createPublicClient({ transport: http(rpc) })
  const chainIdNum = await boot.getChainId()
  const chain = defineChain({
    id: chainIdNum,
    name: 'relay-target',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  })
  const publicClient = createPublicClient({ chain, transport: http(rpc) })
  const wallet = createWalletClient({ account: operator, chain, transport: http(rpc) })
  const chainId = BigInt(chainIdNum)

  // P0 sizing: liability + whale-capped max bet, in USDC base units.
  const bankroll = Number(process.env.BANKROLL_USDC ?? 10000)
  const L = bankroll * product.liabilityPct
  const maxBet = (L / (product.payout - 1)) * 0.2
  const toU = (x) => BigInt(Math.floor(x * 1e6))
  const coinBytes = `0x${Buffer.from(product.coin.padEnd(32, '\0')).toString('hex')}`

  const now = Math.floor(Date.now() / 1000)
  const lockAt = BigInt(now + 8)
  const expiresAt = BigInt(now + 8 + product.durationSec)
  console.log(`[relay] creating ${productId} round (lock in 8s, duration ${product.durationSec}s)`)

  const createHash = await wallet.writeContract({
    address: roundsAddr,
    abi: ROUNDS_ABI_PLUS,
    functionName: 'createRound',
    args: [coinBytes, lockAt, expiresAt, Math.round(product.payout * 10000), Math.round(product.feePct * 10000), toU(L), toU(maxBet), 8000],
  })
  await publicClient.waitForTransactionReceipt({ hash: createHash })
  const roundId = await publicClient.readContract({ address: roundsAddr, abi: ROUNDS_ABI_PLUS, functionName: 'roundCount' })
  console.log(`[relay] round ${roundId} created`)

  await sleep(Number(lockAt) * 1000 - Date.now() + 500)
  const refPx = toFixed8(await hlMid(product.coin))
  const lockSig = await signLock(settlerKey, chainId, roundsAddr, roundId, refPx)
  const lockHash = await wallet.writeContract({
    address: roundsAddr, abi: ROUNDS_ABI_PLUS, functionName: 'lockRound',
    args: [roundId, refPx, lockSig.v, lockSig.r, lockSig.s],
  })
  await publicClient.waitForTransactionReceipt({ hash: lockHash })
  console.log(`[relay] locked @ ${refPx}`)

  await sleep(Number(expiresAt) * 1000 - Date.now() + 500)
  const samples = []
  for (let i = 0; i < 3; i++) {
    samples.push(Number(await hlMid(product.coin)))
    await sleep(1000)
  }
  const twap = samples.reduce((a, b) => a + b, 0) / samples.length
  const settlePx = toFixed8(twap.toString())
  const settleSig = await signSettle(settlerKey, chainId, roundsAddr, roundId, settlePx)
  const settleHash = await wallet.writeContract({
    address: roundsAddr, abi: ROUNDS_ABI_PLUS, functionName: 'settleRound',
    args: [roundId, settlePx, settleSig.v, settleSig.r, settleSig.s],
  })
  await publicClient.waitForTransactionReceipt({ hash: settleHash })
  console.log(`[relay] settled: ref ${refPx} -> settle ${settlePx} => ${settlePx > refPx ? 'UP' : settlePx < refPx ? 'DOWN' : 'PUSH'}`)
}

main().catch((e) => {
  console.error('[relay] FATAL', e.stack ?? e.message)
  process.exit(1)
})
