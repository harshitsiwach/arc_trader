import { useState } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { AppKit, type BridgeChain } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider } from 'viem'
import { MAINNET_CHAINS, TESTNET_CHAINS } from '../lib/cctp'

const kit = new AppKit()

interface Step {
  name?: string
  state?: string
  txHash?: string
  explorerUrl?: string
}

/** CCTP bridge: burn USDC on source, mint on destination. Testnet default. */
export default function BridgePanel() {
  const { connector, address } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const [net, setNet] = useState<'testnet' | 'mainnet'>('testnet')
  const [fromKit, setFromKit] = useState('Arc_Testnet')
  const [toKit, setToKit] = useState('Base_Sepolia')
  const [amount, setAmount] = useState('1.00')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<unknown>(null)

  const chains = net === 'testnet' ? TESTNET_CHAINS : MAINNET_CHAINS
  const fromChain = chains.find((c) => c.kit === fromKit) ?? chains[0]
  const isMainnet = net === 'mainnet'
  const amt = Number(amount)
  const canGo =
    !!address && !!connector && Number.isFinite(amt) && amt > 0 && fromKit !== toKit && !busy &&
    (!isMainnet || ack)

  const run = async () => {
    if (!connector) return
    setNotice(null)
    setSteps([])
    setBusy(true)
    try {
      if (chainId !== fromChain.id) await switchChainAsync({ chainId: fromChain.id })
      const provider = (await connector.getProvider()) as unknown as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({ provider })
      const result = (await kit.bridge({
        from: { adapter, chain: fromKit as `${BridgeChain}` },
        to: { adapter, chain: toKit as `${BridgeChain}` },
        amount: amt.toFixed(2),
      })) as unknown as { state?: string; steps?: Step[] }
      setLastResult(result)
      setSteps(result.steps ?? [])
      if (result.state !== 'success') {
        setNotice(`Transfer ended in state: ${result.state ?? 'unknown'}. Use Retry to resume — never start a new transfer.`)
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message.slice(0, 220) : 'bridge failed')
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!lastResult || typeof (kit as unknown as { retry?: unknown }).retry !== 'function') {
      setNotice('Resume unavailable — inspect the step explorer links below before retrying manually.')
      return
    }
    setBusy(true)
    try {
      const result = (await (kit as unknown as { retry: (r: unknown) => Promise<{ state?: string; steps?: Step[] }> }).retry(lastResult))
      setSteps(result.steps ?? [])
    } catch (e) {
      setNotice(e instanceof Error ? e.message.slice(0, 220) : 'retry failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={styles.row}>
        <button style={tab(net === 'testnet')} onClick={() => setNet('testnet')}>Testnet</button>
        <button style={tab(net === 'mainnet')} onClick={() => setNet('mainnet')}>Mainnet</button>
      </div>
      <div style={styles.row}>
        <label style={styles.lbl}>From
          <select style={styles.select} value={fromKit} onChange={(e) => setFromKit(e.target.value)}>
            {chains.map((c) => <option key={c.kit} value={c.kit}>{c.label}</option>)}
          </select>
        </label>
        <label style={styles.lbl}>To
          <select style={styles.select} value={toKit} onChange={(e) => setToKit(e.target.value)}>
            {chains.map((c) => <option key={c.kit} value={c.kit}>{c.label}</option>)}
          </select>
        </label>
        <label style={styles.lbl}>USDC
          <input style={styles.input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
      </div>
      {isMainnet && (
        <label style={styles.warn}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          {' '}I understand this moves real funds{amt > 100 ? ` (${amt} USDC exceeds the $100 caution threshold)` : ''}.
        </label>
      )}
      <div style={styles.row}>
        <button style={styles.primary} disabled={!canGo} onClick={() => void run()}>
          {busy ? 'Bridging…' : !address ? 'Connect wallet first' : `Bridge ${Number.isFinite(amt) && amt > 0 ? amt.toFixed(2) : ''} USDC →`}
        </button>
        {Boolean(lastResult) && <button style={styles.ghost} disabled={busy} onClick={() => void retry()}>Retry</button>}
      </div>
      {steps.length > 0 && (
        <div style={styles.steps}>
          {steps.map((s, i) => (
            <p key={i} style={styles.muted}>
              {s.name} — {s.state}{' '}
              {s.explorerUrl && <a style={styles.link} href={s.explorerUrl} target="_blank" rel="noreferrer">tx ↗</a>}
            </p>
          ))}
        </div>
      )}
      {notice && <p style={styles.error}>{notice}</p>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 },
  lbl: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, opacity: 0.85 },
  select: { background: '#131316', border: '1px solid #333', color: '#ededed', borderRadius: 8, padding: '8px 10px', fontSize: 13 },
  input: { background: '#131316', border: '1px solid #333', color: '#ededed', borderRadius: 8, padding: '8px 12px', width: 100 },
  primary: { flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#fff', color: '#000', cursor: 'pointer', fontWeight: 700 },
  ghost: { padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ededed', cursor: 'pointer', fontSize: 13 },
  warn: { display: 'block', fontSize: 13, color: '#f5c518', marginBottom: 8 },
  steps: { marginTop: 4 },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
  link: { color: '#ededed' },
}

const tab = (active: boolean): React.CSSProperties => ({
  fontSize: 12, padding: '6px 10px', borderRadius: 8,
  border: '1px solid #333',
  background: active ? '#fff' : 'transparent',
  color: active ? '#000' : '#ededed', cursor: 'pointer',
})
