import { useState } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { AppKit, type SwapChain } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider } from 'viem'
import { kitNameForChainId } from '../lib/cctp'
import { arcTestnet } from 'viem/chains'

const kit = new AppKit()
const TOKENS = ['USDC', 'USDT', 'WETH', 'EURC']

interface Reviewed {
  outAmount: string
  outToken: string
  request: { tokenIn: string; tokenOut: string; amountIn: string; config: { slippageBps: number } }
  account: string | undefined
}

/** Same-chain swap with explicit review → execute. Permissionless (no kit key). */
export default function SwapPanel() {
  const { connector, address } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const [tokenIn, setTokenIn] = useState('USDT')
  const [tokenOut, setTokenOut] = useState('USDC')
  const [amountIn, setAmountIn] = useState('10.00')
  const [slippage, setSlippage] = useState('100')
  const [reviewed, setReviewed] = useState<Reviewed | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const kitChain = kitNameForChainId(chainId)
  const amt = Number(amountIn)

  const getAdapter = async () => {
    if (!connector) throw new Error('Wallet not connected')
    const provider = (await connector.getProvider()) as unknown as EIP1193Provider
    return createViemAdapterFromProvider({ provider })
  }

  const review = async () => {
    if (!kitChain || !Number.isFinite(amt) || amt <= 0) return
    setNotice(null)
    setBusy(true)
    try {
      const adapter = await getAdapter()
      const request = {
        tokenIn,
        tokenOut,
        amountIn: amt.toFixed(2),
        config: { slippageBps: Number(slippage) || 100 },
      } as const
      const estimate = (await kit.estimateSwap({
        from: { adapter, chain: kitChain as `${SwapChain}` },
        ...request,
      })) as unknown as { estimatedOutput?: { amount?: string; token?: string } }
      setReviewed({
        outAmount: estimate.estimatedOutput?.amount ?? '?',
        outToken: estimate.estimatedOutput?.token ?? tokenOut,
        request: { ...request },
        account: address,
      })
    } catch (e) {
      setNotice(e instanceof Error ? e.message.slice(0, 220) : 'estimate failed — route may not exist here')
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (!reviewed || !kitChain) return
    if (address !== reviewed.account) {
      setNotice('Wallet account changed since the estimate — review again.')
      return
    }
    setBusy(true)
    try {
      const adapter = await getAdapter()
      await kit.swap({ from: { adapter, chain: kitChain as `${SwapChain}` }, ...reviewed.request })
      setReviewed(null)
      setNotice('Swap submitted — track it in your wallet / explorer.')
    } catch (e) {
      setNotice(e instanceof Error ? e.message.slice(0, 220) : 'swap failed')
    } finally {
      setBusy(false)
    }
  }

  if (!kitChain) {
    return (
      <div>
        <p style={styles.error}>Swaps run on the connected chain — switch to a supported one.</p>
        <button style={styles.ghost} onClick={() => switchChainAsync({ chainId: arcTestnet.id })}>
          Switch to Arc Testnet
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={styles.row}>
        <label style={styles.lbl}>From
          <select style={styles.select} value={tokenIn} onChange={(e) => setTokenIn(e.target.value)}>
            {TOKENS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label style={styles.lbl}>To
          <select style={styles.select} value={tokenOut} onChange={(e) => setTokenOut(e.target.value)}>
            {TOKENS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label style={styles.lbl}>Amount
          <input style={styles.input} value={amountIn} onChange={(e) => setAmountIn(e.target.value)} inputMode="decimal" />
        </label>
        <label style={styles.lbl}>Slippage (bps)
          <input style={styles.input} value={slippage} onChange={(e) => setSlippage(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      {!reviewed ? (
        <button style={styles.primary} disabled={!address || busy} onClick={() => void review()}>
          {busy ? 'Quoting…' : 'Review quote'}
        </button>
      ) : (
        <div style={styles.quote}>
          <p style={styles.muted}>
            {reviewed.request.amountIn} {reviewed.request.tokenIn} → ~{reviewed.outAmount} {reviewed.outToken} on {kitChain}
          </p>
          <div style={styles.row}>
            <button style={styles.primary} disabled={busy} onClick={() => void execute()}>Swap →</button>
            <button style={styles.ghost} onClick={() => setReviewed(null)}>Discard</button>
          </div>
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
  primary: { width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none', background: '#fff', color: '#000', cursor: 'pointer', fontWeight: 700 },
  ghost: { padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ededed', cursor: 'pointer', fontSize: 13 },
  quote: { marginTop: 4 },
  muted: { opacity: 0.6, fontSize: 13 },
  error: { color: '#ff7b7b', fontSize: 13 },
}
