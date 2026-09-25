import { useState } from 'react'

/** Popup shown when the P1 bet engine is unreachable. */
export default function EngineOfflineModal({
  onRetry,
  onDismiss,
}: {
  onRetry: () => Promise<boolean>
  onDismiss: () => void
}) {
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)

  const retry = async () => {
    setChecking(true)
    setFailed(false)
    const ok = await onRetry()
    setChecking(false)
    if (!ok) setFailed(true)
    // on success the parent hides the modal (online flips true)
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <p style={styles.kicker}>BET ENGINE</p>
        <h2 style={styles.title}>Bet engine is not running</h2>
        <p style={styles.body}>
          Up / Down betting needs the local engine. Start it, then press retry:
        </p>
        <pre style={styles.code}>cd /Users/0xugly/Desktop/arcblock{'\n'}node server/index.mjs</pre>
        <p style={styles.hint}>Listens on :8787 · override with PORT= · data in server/data.json</p>
        {failed && <p style={styles.error}>Still unreachable — is the engine running on :8787?</p>}
        <div style={styles.row}>
          <button style={styles.primary} disabled={checking} onClick={retry}>
            {checking ? 'Checking…' : 'Retry connection'}
          </button>
          <button style={styles.ghost} onClick={onDismiss}>
            Continue browsing
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 16,
  },
  card: {
    width: 440,
    maxWidth: '100%',
    background: '#131316',
    border: '1px solid #26262b',
    borderRadius: 12,
    padding: 24,
  },
  kicker: { margin: '0 0 8px', fontSize: 11, letterSpacing: '0.12em', opacity: 0.55 },
  title: { margin: '0 0 8px', fontSize: 20 },
  body: { margin: '0 0 12px', fontSize: 13, opacity: 0.75 },
  code: {
    margin: '0 0 8px',
    fontFamily: 'monospace',
    fontSize: 12,
    background: '#0a0a0b',
    border: '1px solid #26262b',
    borderRadius: 8,
    padding: '10px 12px',
    overflowX: 'auto',
  },
  hint: { margin: '0 0 12px', fontSize: 12, opacity: 0.5 },
  error: { color: '#ff7b7b', fontSize: 13 },
  row: { display: 'flex', gap: 8 },
  primary: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#fff',
    color: '#000',
    cursor: 'pointer',
    fontWeight: 600,
  },
  ghost: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: 8,
    border: '1px solid #333',
    background: 'transparent',
    color: '#ededed',
    cursor: 'pointer',
  },
}
