#!/usr/bin/env bash
# One-command operator daemon launcher.
# Usage: bash server/start-daemon.sh [--dry-run]
# The hotkey is asked for interactively (hidden input), checked against the
# HOT address, used only in this process env, and never stored or printed.
set -euo pipefail

EXPECTED_HOT="0x78667A6fD434c821d613c1c683014b47780277db"
RPC_URL="${RPC_URL:-https://rpc.testnet.arc.io}"
VAULT_ADDR="${VAULT_ADDR:-0x92Bdf0aC7E33FF4D2ae6026c370b893dcd47Dc2c}"
ROUNDS_ADDR="${ROUNDS_ADDR:-0xCe10F9bed67F23814f5304931cB554beE3bcCD54}"
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="DRY_RUN=1"

cd "$(dirname "$0")"

# Key sources, in order: env var > key file > secure prompt. Never chat, never disk by us.
if [ -z "${OPERATOR_KEY:-}" ] && [ -n "${OPERATOR_KEY_FILE:-}" ]; then
  OPERATOR_KEY=$(cat "$OPERATOR_KEY_FILE")
fi
if [ -z "${OPERATOR_KEY:-}" ]; then
  echo "HOT wallet is $EXPECTED_HOT (operator + settler)."
  echo "Paste its PRIVATE KEY below (input hidden, nothing is saved):"
  read -rs OPERATOR_KEY
  echo ""
fi

# Format check (pattern match only — the value is never echoed or re-embedded).
case "$OPERATOR_KEY" in
  0x????????????????????????????????????????????????????????????????) ;;
  *) echo "ABORT: key must look like 0x + 64 hex chars."; exit 1 ;;
esac

# Derive the address locally (viem, via env — key never appears in argv/ps).
DERIVED=$(OPERATOR_KEY="$OPERATOR_KEY" node --input-type=module -e \
  "import('viem/accounts').then(m => console.log(m.privateKeyToAccount(process.env.OPERATOR_KEY).address))")
if [ "$(echo "$DERIVED" | tr '[:upper:]' '[:lower:]')" != "$(echo "$EXPECTED_HOT" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "ABORT: this key belongs to $DERIVED, not the HOT wallet $EXPECTED_HOT."
  echo "Using it would send failing transactions (and burn gas). Export the right key and retry."
  exit 1
fi
echo "Key OK — matches HOT wallet."

# Gas check: operator txs pay USDC gas on Arc.
BAL=$(cast balance "$EXPECTED_HOT" --rpc-url "$RPC_URL" 2>/dev/null || echo 0)
echo "HOT wallet gas balance: $BAL wei (USDC)."
if [ "$BAL" = "0" ]; then
  echo "WARNING: zero balance — fund $EXPECTED_HOT with a little testnet USDC (faucet.circle.com), then re-run."
  exit 1
fi

echo "Starting daemon ${DRY:+DRY-RUN }on Arc Testnet (Ctrl+C to stop)…"
# shellcheck disable=SC2086
env RPC_URL="$RPC_URL" VAULT_ADDR="$VAULT_ADDR" ROUNDS_ADDR="$ROUNDS_ADDR" \
  OPERATOR_KEY="$OPERATOR_KEY" $DRY node daemon.mjs
