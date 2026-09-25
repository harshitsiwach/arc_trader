/**
 * P2 chain signer. Produces the ECDSA signatures Rounds.sol expects, using the
 * exact same hashing (abi.encode with string tags + EIP-191 personal-sign).
 * The P1 HMAC path stays for the demo API; this is the road to mainnet.
 */
import { encodeAbiParameters, keccak256, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ROUNDS_ABI = parseAbi([
  'function lockHash(uint256 roundId, uint256 refPrice) view returns (bytes32)',
  'function settleHash(uint256 roundId, uint256 settlePrice) view returns (bytes32)',
  'function voidHash(uint256 roundId) view returns (bytes32)',
  'function lockRound(uint256 roundId, uint256 refPrice, uint8 v, bytes32 r, bytes32 s)',
  'function settleRound(uint256 roundId, uint256 settlePrice, uint8 v, bytes32 r, bytes32 s)',
  'function voidRound(uint256 roundId, uint8 v, bytes32 r, bytes32 s)',
])

export { ROUNDS_ABI }

/** Decimal price string -> 1e8 fixed-point bigint (matches Rounds.sol). */
export function toFixed8(px) {
  const [i, f = ''] = String(px).split('.')
  return BigInt(i) * 100_000_000n + BigInt((f + '00000000').slice(0, 8))
}

function tagHash(chainId, rounds, tag, roundId, priceOrNull) {
  const types =
    priceOrNull == null
      ? ['string', 'uint256', 'address', 'uint256']
      : ['string', 'uint256', 'address', 'uint256', 'uint256']
  const values =
    priceOrNull == null
      ? [tag, chainId, rounds, roundId]
      : [tag, chainId, rounds, roundId, priceOrNull]
  return keccak256(encodeAbiParameters(types.map((t) => ({ type: t })), values))
}

async function sign(key, hash) {
  const account = privateKeyToAccount(key)
  const sig = await account.signMessage({ message: { raw: hash } })
  const r = `0x${sig.slice(2, 66)}`
  const s = `0x${sig.slice(66, 130)}`
  const rawV = parseInt(sig.slice(130, 132), 16)
  return { v: rawV < 27 ? rawV + 27 : rawV, r, s, signer: account.address }
}

export const signLock = (key, chainId, rounds, roundId, refPrice) =>
  sign(key, tagHash(chainId, rounds, 'ARC-ROUND-LOCK', roundId, refPrice))

export const signSettle = (key, chainId, rounds, roundId, settlePrice) =>
  sign(key, tagHash(chainId, rounds, 'ARC-ROUND-SETTLE', roundId, settlePrice))

export const signVoid = (key, chainId, rounds, roundId) =>
  sign(key, tagHash(chainId, rounds, 'ARC-ROUND-VOID', roundId, null))
