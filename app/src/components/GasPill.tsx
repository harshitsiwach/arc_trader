import { useEffect, useState } from 'react'
import { createPublicClient, formatGwei, http } from 'viem'
import { arc } from 'viem/chains'

const client = createPublicClient({
  chain: arc,
  transport: http(import.meta.env.VITE_ARC_RPC_URL ?? 'https://rpc.mainnet.arc.io'),
})

/** Live Arc Mainnet gas pill: gas price + typical-transfer cost in USDC. */
export default function GasPill() {
  const [gwei, setGwei] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const price = await client.getGasPrice()
        if (!stop) setGwei(formatGwei(price))
      } catch {
        // keep stale on failure
      }
    }
    load()
    const t = setInterval(load, 15000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  // 21k-gas transfer priced in USDC (18dp native view ≈ 1:1 with 6dp for display).
  const txCost = gwei != null ? (Number(gwei) * 1e-9 * 21000).toFixed(4) : null

  return (
    <span style={styles.pill} title="Arc Mainnet gas — 21k transfer estimate">
      <span style={styles.dot} />
      {gwei == null ? 'gas …' : `${Number(gwei).toFixed(1)} Gwei · ~$${txCost}`}
    </span>
  )
}

const styles: Record<string, React.CSSProperties> = {
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontFamily: 'monospace',
    fontSize: 12,
    border: '1px solid #26262b',
    borderRadius: 8,
    padding: '8px 12px',
    background: '#131316',
    whiteSpace: 'nowrap',
  },
  dot: { width: 7, height: 7, borderRadius: '50%', background: '#4ade80' },
}
