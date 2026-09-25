import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { arc } from 'viem/chains'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Compact wallet profile for the top-right header. */
export default function WalletProfile() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const onWrongNetwork = isConnected && chainId !== arc.id

  if (!isConnected) {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        {connectors.map((c) => (
          <button key={c.uid} style={styles.primary} disabled={isPending} onClick={() => connect({ connector: c })}>
            {isPending ? 'Connecting…' : `Connect ${c.name}`}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={styles.pill} title={address}>
        <span style={{ ...styles.dot, background: onWrongNetwork ? '#f5c518' : '#4ade80' }} />
        {short(address!)}
      </span>
      {onWrongNetwork ? (
        <button style={styles.warn} disabled={isSwitching} onClick={() => switchChain({ chainId: arc.id })}>
          {isSwitching ? 'Switching…' : 'Switch to Arc'}
        </button>
      ) : (
        <span style={styles.net}>Arc · {chainId}</span>
      )}
      <button style={styles.ghost} onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  primary: {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#fff',
    color: '#000',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontFamily: 'monospace',
    fontSize: 13,
    border: '1px solid #26262b',
    borderRadius: 8,
    padding: '8px 12px',
    background: '#131316',
  },
  dot: { width: 7, height: 7, borderRadius: '50%' },
  net: { fontSize: 12, opacity: 0.55 },
  ghost: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #333',
    background: 'transparent',
    color: '#ededed',
    cursor: 'pointer',
    fontSize: 13,
  },
  warn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: 'none',
    background: '#f5c518',
    color: '#000',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
}
