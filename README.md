# Hyperblock — live markets + up/down betting on Arc

A trading terminal (Hyperliquid-style 3-column layout: chart · assets · betting) with a binary
up/down betting house that settles in USDC on **Arc**. Crypto, stocks, commodities, indices and
forex prices stream live from Hyperliquid; betting runs first on a local demo ledger, then for
real USDC against audited contracts on **Arc Testnet**.

## Repo map

| Path | What |
|---|---|
| `app/` | Vite + React + wagmi/viem frontend |
| `app/src/lib/hyperliquid.ts` | Hyperliquid REST/WS client, categories, market-hours |
| `app/src/lib/onchain.ts` | Arc Testnet contract addresses, ABIs, base-unit helpers |
| `app/src/lib/betting.ts` | P1 demo-engine API client |
| `server/index.mjs` | P1 demo betting engine (in-memory ledger + JSON store) |
| `server/daemon.mjs` | P2 operator daemon — real 1m rounds on Arc Testnet |
| `server/relay.mjs` | One-shot onchain round rehearsal (create → lock → settle) |
| `server/signer.mjs` | ECDSA settler signatures matching `Rounds.sol` |
| `contracts/` | Foundry project: `Vault.sol` + `Rounds.sol` (audited), 12 tests |
| `onchain/` | Audited sources + metadata pulled from the Arc Studio turn |
| `risk-model/` | P0 bankroll math, invariants, generated tables |
| `scripts/sync-icons.mjs` | Copies stock/forex/commodity PNGs + generates icon manifest |
| `scripts/circle-refresh.sh` | Refresh Circle console imports post-verification |
| `icons/` | Cloned NVSTly logo repo (stocks, forex, crypto PNGs) |

## Prerequisites

- Node 22+, npm, [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`)
- A browser wallet (Rabbi/MetaMask) with Arc Mainnet + Arc Testnet configured
- Testnet USDC from [faucet.circle.com](https://faucet.circle.com) (gas **and** bankroll — USDC is Arc's gas token)

## 1. Run the app

```bash
cd app
npm install
npm run dev        # → http://localhost:5173
```

The terminal works without any backend: live Hyperliquid prices, charts, asset search.
`npm run build` / `npm run preview` for production.

Wallet utilities live in a **Wallet** section below Earn: live Arc gas pill (header),
**Bridge** (CCTP via App Kit, testnet default, explicit mainnet confirm), **Swap**
(review quote → execute, permissionless), **Fund** (fiat onramp iframe — needs the
engine running with `CIRCLE_API_KEY`; see `server/.env.example`).

Useful env (see `app/.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `VITE_ARC_RPC_URL` | `https://rpc.mainnet.arc.io` | Mainnet identity chain |
| `VITE_ARC_TESTNET_RPC` | `https://rpc.testnet.arc.io` | Testnet reads |
| `VITE_BETTING_API_URL` | `http://localhost:8787` | P1 demo engine |
| `VITE_VAULT_ADDR` / `VITE_ROUNDS_ADDR` | testnet deployment below | Onchain betting |

## 2. Run the P1 demo betting engine (play money)

```bash
node server/index.mjs            # :8787 · PORT= to change · store in server/data.json
```

- Products: `flash-10s` (10s, 1.80x) and `std-5m` (5m, 1.85x), 1.5% fee, ties refund.
- Frontend: betting panel → **Demo ledger** → `+ faucet $1k` → bet UP/DOWN.
- If the engine isn't running, the app shows a popup with these exact steps and a retry button.
- Tests: `node --test server/engine.test.mjs` (9/9).

## 3. Run the P2 operator daemon (real USDC, Arc Testnet)

The daemon creates 1-minute rounds onchain, locks with Hyperliquid mids, settles with
a TWAP, and auto-pauses both contracts at −5% daily stop. **It needs your hot (operator)
key — run it on your own machine, never share the key.**

```bash
cd /Users/0xugly/Desktop/arcblock
bash server/start-daemon.sh            # prompts for the HOT private key (hidden, never stored)
bash server/start-daemon.sh --dry-run  # rehearse read-only first
# or, if OPERATOR_KEY is already exported in your shell:
# RPC_URL= VAULT_ADDR= ROUNDS_ADDR= SETTLER_KEY= node server/daemon.mjs
```

- `SETTLER_KEY` defaults to operator (split them later via `setSettler`).
- `DRY_RUN=1` rehearses read-only (no transactions) — use it first.
- Round sizing is live from `houseBalance`: `maxBet = min($1.00, floor(L ÷ 1.85))`.
  At $300 bankroll that's ~$0.40; **$1.00 bets unlock at ~$740 bankroll** — fund more,
  caps breathe automatically. `minBet` is $0.10.
- Day state persists in `server/daemon-state.json`.
- Frontend: betting panel → **Arc Testnet · real USDC** → deposit → bet → claim → withdraw.

## 4. Contracts (Arc Testnet, verified)

| Contract | Address |
|---|---|
| Vault | [`0x92Bdf0aC7E33FF4D2ae6026c370b893dcd47Dc2c`](https://explorer.testnet.arc.io/address/0x92Bdf0aC7E33FF4D2ae6026c370b893dcd47Dc2c) |
| Rounds | [`0xCe10F9bed67F23814f5304931cB554beE3bcCD54`](https://explorer.testnet.arc.io/address/0xCe10F9bed67F23814f5304931cB554beE3bcCD54) |
| USDC (native predeploy) | `0x3600000000000000000000000000000000000000` |

Audited by Arc Studio (fixed: stuck-escrow timeout via `forceVoidExpired`, full-payout
liability cap, renounce disabled, admin events). **12/12 forge tests green.**

```bash
cd contracts
forge build
forge test
```

Key rules enforced onchain: payout hard-capped below 2.0x, per-bet whale cap,
per-round liability sim, skew guard, fee on bet, ties push, voids refund fee,
settler ECDSA sigs (contract derives UP/DOWN/PUSH itself).

### Owner runbook (cold wallet, via explorer write UI — contracts are verified)

1. USDC `approve(vault, amount)` → `fundHouse(amount)` (repeatable; start ~$500 test USDC)
2. `setDailyWithdrawCap` (e.g. `250000000` = $250/day; base units, 6dp: $1 = `1000000`)
3. Later: `sweep(to, amount)` for profits; `pause()`/`unpause()` for emergencies

### User flow
`usdc.approve` → `deposit` → `placeBet(roundId, up, stake)` → `claim(betId)` → `withdraw`.
Prices are 1e8 fixed-point (BTC $76,467.50 = `7646750000000`).

### Redeploy (fresh instances under your keys)

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.io --broadcast --private-key <deployer-key>
# env: USDC_ADDR, OWNER_, OPERATOR_, SETTLER_, DEPLOYER_
```
Then verify with the same toolchain (solc 0.8.24, optimizer 200):
```bash
forge verify-contract <addr> src/Vault.sol:Vault --chain-id 5042002 \
  --verifier etherscan --verifier-url "https://explorer.testnet.arc.io/api/" \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" <usdc> <owner> <operator>) \
  --etherscan-api-key dummy
```

## 5. Risk model (P0 — the house edge, honestly)

```bash
node risk-model/run.mjs   # prints tables → risk-model/tables.md + 11 self-tests
```

- 1.85x payout + 1.5% fee ≈ **9% edge** per $1 at 50/50; 1.80x flash ≈ 11.5%.
- Max 1% bankroll loss per round; whale cap 20% of liability-implied max; skew guard
  halts one-sided books; −5% daily stop.
- `risk-model/invariants.mjs` exports the five rules as predicates — the engines
  enforce them; items marked `[CHAIN]` are also enforced in Solidity.
- ⚠️ The deployed contracts use the auditor's **full-payout** liability (tighter than
  the original P0 profit-based math). `server/` demo engine still uses the old math;
  `server/daemon.mjs` uses the correct full-payout math.

## 6. Icons

```bash
node scripts/sync-icons.mjs   # clone repo → app/public/icons + iconManifest.ts
```

Crypto uses `@web3icons/react` SVGs; stocks/forex/commodities use the cloned PNGs;
everything else gets a letter badge. Re-run when new HIP-3 markets list.

## 7. Arc Studio (contract work via hosted agent)

```bash
npm install -g @circle-fin/arc-studio-cli   # 1.1.3, once per machine
arc-studio login --paste                     # human, browser flow
arc-studio whoami                             # exit 0 = ready
arc-studio run "<task>" --session <name> --file <path> --detach --output json
arc-studio attach --session <name>            # follow a detached turn (don't timeout-kill: it cancels server-side)
arc-studio pull --session <name> --out ./onchain --paths "contracts/**"
```

Notes from experience: prompt cap is 10k chars (use `--file`); `finalText` prose is
untrusted — trust `filesChanged`/pulled files; verify every reported deployment
yourself (`cast code` + role reads); never paste tokens/keys in chat — the sandbox
`.env` is edited via its web workspace, never through here.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Betting popup "engine is not running" | Start `node server/index.mjs` (:8787) or check `VITE_BETTING_API_URL` |
| UP/DOWN disabled | Round locked (wait for next), invalid stake, or failed server guard — read the notice line |
| `placeBet` reverts `Cap()` | Stake over round max, liability full, or one-sided book — try smaller/other side |
| `claim` reverts `BadRound()` | Round not settled yet — wait for expiry + settler |
| Forge `verify-contract` rate limits | Wait 2–5 min; use `https://explorer.testnet.arc.io/api/` host (not `testnet.arcscan.app`) |
| `cast wallet` rejects a key | This forge build rejects some formats; generate fresh with `cast wallet new` |
| Stuck round, settler offline | Anyone can call `forceVoidExpired(roundId)` after expiry — funds return |

## What NOT to do

- Never commit `.env*`, `server/data.json`, `daemon-state.json`, keys, or `broadcast/` tx logs with secrets.
- Never pass private keys/API tokens as CLI args in shared logs or chat.
- Testnet first, always. Mainnet needs a fresh external audit + multisig owner + KMS settler.
