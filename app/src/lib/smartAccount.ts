import { createPublicClient, encodeFunctionData, parseUnits, type Hex, type Transport } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import {
  createBundlerClient,
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  encodeTransfer,
  type ToCircleSmartAccountReturnType as SmartAccountT,
  type WebAuthnCredential,
} from '@circle-fin/modular-wallets-core'
import vaultAbi from './abi-Vault.json'
import roundsAbi from './abi-Rounds.json'
import { ROUNDS_ADDR, USDC_ADDR, VAULT_ADDR } from './onchain'

const CLIENT_KEY = import.meta.env.VITE_CLIENT_KEY as string | undefined
const CLIENT_URL =
  (import.meta.env.VITE_CLIENT_URL as string | undefined) ??
  'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'

export const isSmartAccountConfigured = Boolean(CLIENT_KEY)
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const
export type { ToCircleSmartAccountReturnType as SmartAccountT } from '@circle-fin/modular-wallets-core'
export type { WebAuthnCredential } from '@circle-fin/modular-wallets-core'

const CHAINS = { testnet: arcTestnet, mainnet: arc } as const
export type SmartNet = keyof typeof CHAINS

export function passkeyTransport() {
  return toPasskeyTransport(CLIENT_URL, CLIENT_KEY!)
}

export function chainClients(net: SmartNet) {
  const chain = CHAINS[net]
  const path = net === 'mainnet' ? '/arc' : '/arcTestnet'
  // SDK transport typed against newer viem; boundary-cast, runtime-compatible.
  const transport = toModularTransport(`${CLIENT_URL}${path}`, CLIENT_KEY!) as unknown as Transport
  const client = createPublicClient({ chain, transport })
  const bundlerClient = createBundlerClient({ chain, transport })
  return { client, bundlerClient }
}

const CRED_KEY = 'hb-smart-credential'

export function saveCredential(c: WebAuthnCredential) {
  // Trial storage. Production: httpOnly cookies (XSS-safe), never localStorage.
  localStorage.setItem(CRED_KEY, JSON.stringify(c))
}

export function loadCredential(): WebAuthnCredential | null {
  try {
    const raw = localStorage.getItem(CRED_KEY)
    return raw ? (JSON.parse(raw) as WebAuthnCredential) : null
  } catch {
    return null
  }
}

export function clearCredential() {
  localStorage.removeItem(CRED_KEY)
}

export async function registerCredential(username: string) {
  const credential = await toWebAuthnCredential({
    transport: passkeyTransport(),
    mode: WebAuthnMode.Register,
    username,
  })
  saveCredential(credential)
  return credential
}

export async function loginCredential() {
  const credential = await toWebAuthnCredential({
    transport: passkeyTransport(),
    mode: WebAuthnMode.Login,
  })
  saveCredential(credential)
  return credential
}

export async function openSmartAccount(net: SmartNet, credential: WebAuthnCredential, name?: string) {
  const { client } = chainClients(net)
  type ExpectedClient = Parameters<typeof toCircleSmartAccount>[0]['client']
  return toCircleSmartAccount({
    client: client as unknown as ExpectedClient,
    owner: toWebAuthnAccount({ credential }) as WebAuthnAccount,
    ...(name ? { name } : {}),
  })
}

/** Gasless send: sponsored via Circle Gas Station (paymaster: true). */
export async function sendGasless(
  net: SmartNet,
  account: SmartAccountT,
  calls: { to: Hex; data: Hex; value?: bigint }[],
): Promise<`0x${string}`> {
  const { bundlerClient } = chainClients(net)
  return (bundlerClient.sendUserOperation as (
    args: { account: SmartAccountT; calls: typeof calls; paymaster: boolean },
  ) => Promise<`0x${string}`>)({ account, calls, paymaster: true })
}

export async function waitGasless(net: SmartNet, hash: `0x${string}`) {
  const { bundlerClient } = chainClients(net)
  return bundlerClient.waitForUserOperationReceipt({ hash })
}

// ---- Encoded calls against OUR contracts (batched where possible) ----

export function encApproveSpender(spender: Hex, amountUsdc: number) {
  return {
    to: USDC_ADDR as Hex,
    data: encodeFunctionData({
      abi: [
        { type: 'function', name: 'approve', stateMutability: 'nonpayable',
          inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
          outputs: [{ name: '', type: 'bool' }] },
      ],
      functionName: 'approve',
      args: [spender, parseUnits(amountUsdc.toFixed(6), 6)],
    }),
  }
}

export function encVaultDeposit(amountUsdc: number) {
  return {
    to: VAULT_ADDR as Hex,
    data: encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [parseUnits(amountUsdc.toFixed(6), 6)] }),
  }
}

/** Approve + deposit atomically in ONE gasless user op. */
export function encDepositBatch(amountUsdc: number) {
  return [encApproveSpender(VAULT_ADDR as Hex, amountUsdc), encVaultDeposit(amountUsdc)]
}

export function encPlaceBet(roundId: bigint, up: boolean, amountUsdc: number) {
  return {
    to: ROUNDS_ADDR as Hex,
    data: encodeFunctionData({
      abi: roundsAbi, functionName: 'placeBet',
      args: [roundId, up, parseUnits(amountUsdc.toFixed(6), 6)],
    }),
  }
}

export function encClaim(betId: bigint) {
  return {
    to: ROUNDS_ADDR as Hex,
    data: encodeFunctionData({ abi: roundsAbi, functionName: 'claim', args: [betId] }),
  }
}

export function encUsdcTransfer(to: Hex, amountUsdc: number) {
  const call = encodeTransfer(to, ARC_USDC, parseUnits(amountUsdc.toFixed(6), 6))
  return { to: call.to, data: call.data }
}

export { WebAuthnMode }
