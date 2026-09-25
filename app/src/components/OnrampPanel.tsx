import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { AppKit } from '@circle-fin/app-kit'
import { getUserId } from '../lib/betting'

const API = (import.meta.env.VITE_BETTING_API_URL as string | undefined) ?? 'http://localhost:8787'

const kit = new AppKit()

/** Fiat → stablecoins on Arc, embedded as an iframe (App Kit Onramp). */
export default function OnrampPanel() {
  const { address } = useAccount()
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<{ close: () => void } | null>(null)
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [setup, setSetup] = useState(false)

  useEffect(
    () => () => {
      widgetRef.current?.close()
      widgetRef.current = null
    },
    [],
  )

  const start = async () => {
    if (!address || !containerRef.current) return
    setNotice(null)
    setSetup(false)
    setBusy(true)
    try {
      const res = await fetch(`${API}/api/onramp/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appUserId: getUserId(), destinationAddress: address }),
      })
      if (res.status === 501) {
        setSetup(true)
        return
      }
      if (!res.ok) throw new Error(`session failed (${res.status})`)
      const session = await res.json()
      widgetRef.current?.close()
      widgetRef.current = kit.onramp.mountIframe({
        session,
        container: containerRef.current,
        onDepositSettled: ({ payload }) => {
          setNotice(`Deposit settled: ${JSON.stringify(payload).slice(0, 160)}`)
        },
        onDepositNotCompleted: ({ code }) => {
          setNotice(`Deposit not completed: ${code}`)
        },
      })
      setStarted(true)
    } catch (e) {
      setNotice(e instanceof Error ? e.message.slice(0, 200) : 'onramp failed to start')
    } finally {
      setBusy(false)
    }
  }

  const stop = () => {
    widgetRef.current?.close()
    widgetRef.current = null
    setStarted(false)
  }

  return (
    <div>
      {!started && (
        <div style={styles.row}>
          <button style={styles.primary} disabled={!address || busy} onClick={() => void start()}>
            {busy ? 'Opening…' : !address ? 'Connect wallet first' : 'Buy with fiat →'}
          </button>
        </div>
      )}
      <div ref={containerRef} style={styles.frame} />
      {started && (
        <button style={styles.ghost} onClick={stop}>
          Close widget
        </button>
      )}
      {setup && (
        <p style={styles.muted}>
          Onramp isn't configured on this engine yet. The operator must set{' '}
          <code>CIRCLE_API_KEY</code> (console.circle.com → API keys) and{' '}
          <code>REFERRER_DOMAIN</code> for cards, then restart <code>node server/index.mjs</code>.
        </p>
      )}
      {notice && <p style={styles.error}>{notice}</p>}
      <p style={styles.muted}>Buys land at your connected Arc address. Card/Apple/Google Pay need the referrer domain set server-side.</p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 },
  frame: { width: '100%', height: 640 },
  primary: { flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#fff', color: '#000', cursor: 'pointer', fontWeight: 700 },
  ghost: { marginTop: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ededed', cursor: 'pointer', fontSize: 13 },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
}
