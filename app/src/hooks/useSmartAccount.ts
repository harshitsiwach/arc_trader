import { useCallback, useEffect, useState } from 'react'
import type { Hex } from 'viem'
import type { SmartAccountT, SmartNet, WebAuthnCredential } from '../lib/smartAccount'

const CRED_KEY = 'hb-smart-credential'

function loadCredential(): WebAuthnCredential | null {
  try {
    const raw = localStorage.getItem(CRED_KEY)
    return raw ? (JSON.parse(raw) as WebAuthnCredential) : null
  } catch {
    return null
  }
}

async function smartLib() {
  return import('../lib/smartAccount')
}

export type SmartStatus = 'signed-out' | 'working' | 'ready' | 'error'

/** Passkey login + gasless user ops on Arc (testnet default).
 * The heavy SDK loads dynamically on first use — never in the main bundle. */
export function useSmartAccount(net: SmartNet = 'testnet') {
  const [credential, setCredential] = useState<WebAuthnCredential | null>(loadCredential)
  const [account, setAccount] = useState<(SmartAccountT & { address: Hex }) | null>(null)
  const [status, setStatus] = useState<SmartStatus>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem(CRED_KEY) ? 'working' : 'signed-out',
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [lastOp, setLastOp] = useState<string | null>(null)

  // Restore session on load / network switch.
  useEffect(() => {
    let stop = false
    const cred = loadCredential()
    setCredential(cred)
    if (!cred) {
      setStatus('signed-out')
      return
    }
    ;(async () => {
      try {
        const m = await smartLib()
        if (!m.isSmartAccountConfigured) {
          if (!stop) setStatus('error')
          return
        }
        if (!stop) setStatus('working')
        const a = await m.openSmartAccount(net, cred)
        if (!stop) {
          setAccount(a as SmartAccountT & { address: Hex })
          setStatus('ready')
        }
      } catch (e) {
        if (!stop) {
          setStatus('error')
          setNotice(friendly(e))
        }
      }
    })()
    return () => {
      stop = true
    }
  }, [net])

  const register = useCallback(
    async (username: string) => {
      setNotice(null)
      setStatus('working')
      try {
        const m = await smartLib()
        const cred = await m.registerCredential(username.trim() || 'player')
        setCredential(cred)
        const a = await m.openSmartAccount(net, cred, username.trim() || undefined)
        setAccount(a as SmartAccountT & { address: Hex })
        setStatus('ready')
      } catch (e) {
        setStatus(loadCredential() ? 'error' : 'signed-out')
        setNotice(friendly(e))
      }
    },
    [net],
  )

  const login = useCallback(async () => {
    setNotice(null)
    setStatus('working')
    try {
      const m = await smartLib()
      const cred = await m.loginCredential()
      setCredential(cred)
      const a = await m.openSmartAccount(net, cred)
      setAccount(a as SmartAccountT & { address: Hex })
      setStatus('ready')
    } catch (e) {
      setStatus('signed-out')
      setNotice(friendly(e))
    }
  }, [net])

  const logout = useCallback(() => {
    localStorage.removeItem(CRED_KEY)
    setCredential(null)
    setAccount(null)
    setStatus('signed-out')
  }, [])

  const send = useCallback(
    async (calls: { to: Hex; data: Hex; value?: bigint }[]) => {
      if (!account) {
        setNotice('Log in with passkey first.')
        return null
      }
      setNotice(null)
      setLastOp(null)
      try {
        const m = await smartLib()
        const hash = await m.sendGasless(net, account, calls)
        setLastOp(hash)
        const { receipt } = await m.waitGasless(net, hash)
        return receipt.transactionHash
      } catch (e) {
        setNotice(friendly(e))
        return null
      }
    },
    [net, account],
  )

  return {
    configured: Boolean(import.meta.env.VITE_CLIENT_KEY as string | undefined),
    credential: !!credential,
    address: account?.address ?? null,
    status,
    notice,
    lastOp,
    register,
    login,
    logout,
    send,
  }
}

function friendly(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Passkey prompt cancelled or timed out — try again.'
    if (e.name === 'SecurityError') return 'Passkey domain mismatch — check the Passkey Domain in Circle Console.'
    if (e.name === 'InvalidStateError') return 'This passkey already exists here — use Log in instead.'
    return `Passkey error (${e.name}).`
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('155507')) return 'Smart accounts not supported on this chain — use Arc.'
  if (msg.includes('155509') || msg.includes('AA33')) return 'Gas sponsorship not active — configure the Gas Station paymaster policy in Console.'
  if (msg.includes('AA21')) return 'No gas funds and paymaster refused — check sponsorship.'
  return msg.slice(0, 220)
}
