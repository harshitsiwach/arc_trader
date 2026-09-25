import { useState } from 'react'
import { useSmartAccount } from '../hooks/useSmartAccount'

/** Passkey login + smart account home. Gasless trading unlocks across the app. */
export default function SmartAccountPanel() {
  const { configured, address, status, notice, lastOp, register, login, logout } =
    useSmartAccount('testnet')
  const [username, setUsername] = useState('')

  if (!configured) {
    return (
      <div>
        <h2 style={styles.h2}>Account <span style={styles.demo}>passkey smart wallet</span></h2>
        <p style={styles.muted}>Not configured on this build. The operator must set:</p>
        <pre style={styles.code}>VITE_CLIENT_KEY=&lt;console.circle.com → Keys → Client Keys&gt;{'\n'}VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl</pre>
        <p style={styles.muted}>Plus, in Console: Passkey Domain = this app's domain, and a Gas Station paymaster policy for sponsored transactions.</p>
      </div>
    )
  }

  return (
    <div>
      <h2 style={styles.h2}>Account <span style={styles.demo}>passkey · smart wallet · $0 gas</span></h2>

      {status === 'ready' && address ? (
        <>
          <p style={styles.addr}>{address}</p>
          <p style={styles.muted}>Face ID / fingerprint in, gasless trades everywhere. No seed phrase, no per-tx gas.</p>
          <div style={styles.row}>
            <button style={styles.ghost} onClick={logout}>Log out</button>
          </div>
        </>
      ) : (
        <>
          <div style={styles.row}>
            <input
              style={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username (for new passkey)"
            />
          </div>
          <div style={styles.row}>
            <button
              style={styles.primary}
              disabled={status === 'working'}
              onClick={() => void register(username)}
            >
              {status === 'working' ? '…' : 'Create passkey →'}
            </button>
            <button style={styles.ghost} disabled={status === 'working'} onClick={() => void login()}>
              Log in
            </button>
          </div>
          <p style={styles.muted}>One tap creates your passkey + smart wallet (deploys itself lazily, gas-free, on first trade).</p>
        </>
      )}

      {notice && <p style={styles.error}>{notice}</p>}
      {lastOp && (
        <p style={styles.muted}>
          last op:{' '}
          <a style={styles.link} href={`https://explorer.testnet.arc.io/tx/${lastOp}`} target="_blank" rel="noreferrer">
            {lastOp.slice(0, 18)}… ↗
          </a>
        </p>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  h2: { margin: '0 0 12px', fontSize: 20 },
  demo: { fontSize: 11, opacity: 0.55, fontWeight: 400 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 },
  input: { background: '#131316', border: '1px solid #333', color: '#ededed', borderRadius: 8, padding: '8px 12px', width: 200 },
  primary: { padding: '10px 16px', borderRadius: 8, border: 'none', background: '#fff', color: '#000', cursor: 'pointer', fontWeight: 700 },
  ghost: { padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ededed', cursor: 'pointer', fontSize: 13 },
  addr: { fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' },
  code: { fontFamily: 'monospace', fontSize: 12, background: '#0a0a0b', border: '1px solid #26262b', borderRadius: 8, padding: '10px 12px', overflowX: 'auto' },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
  link: { color: '#ededed' },
}
