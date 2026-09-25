#!/usr/bin/env bash
# Refresh Circle console imports so they pick up onchain verification.
# Usage: CIRCLE_API_KEY=<key> bash scripts/circle-refresh.sh
# The key stays in your shell only — nothing is stored or printed.
set -euo pipefail

: "${CIRCLE_API_KEY:?Set CIRCLE_API_KEY env var first}"
BASE="https://api.circle.com/v1/w3s"

uuid() {
  if command -v uuidgen >/dev/null; then uuidgen; else python3 -c "import uuid; print(uuid.uuid4())"; fi
}

refresh_one() {
  local name="$1" address="$2"
  echo "== $name ($address)"
  local resp
  resp=$(curl -s -X POST "$BASE/contracts/import" \
    -H "Authorization: Bearer $CIRCLE_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import json; print(json.dumps({'address':'$address','blockchain':'ARC-TESTNET','name':'$name','idempotencyKey':'$(uuid)','refreshVerification':True}))")")
  echo "$resp" | python3 -c "
import json,sys
d = json.load(sys.stdin)
c = d.get('data', {}).get('contract', {})
print('verification:', c.get('verificationStatus'), '| functions:', len(c.get('functions') or []))
print('warnings:', [w.get('message') for w in (d.get('data', {}).get('warnings') or [])])
" || { echo "raw response:"; echo "$resp" | head -c 500; echo; }
}

refresh_one "Hyperblock Vault" "0x618d5ed02f4e22833076c4093dbca946692fd382"
refresh_one "Hyperblock Rounds" "0xa6160980892e1e96325665b2f2446309cc8be37a"
echo "Done. If functions > 0 for both, execute the 6 admin calls from the console."
