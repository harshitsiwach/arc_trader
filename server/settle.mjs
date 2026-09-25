/** P1 settlement signing. HMAC today; P2 verifies the same shape onchain (then multisig). */
import { createHmac, timingSafeEqual } from 'node:crypto'

export function signResult(secret, r) {
  const msg = [r.id, r.coin, r.refPrice, r.settlePrice, r.result, r.expiresAt].join('|')
  return createHmac('sha256', secret).update(msg).digest('hex')
}

export function verifyResult(secret, r, sig) {
  const a = Buffer.from(signResult(secret, r))
  const b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}
