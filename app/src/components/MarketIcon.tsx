import { useState, type CSSProperties } from 'react'
import CryptoIcon from './CryptoIcon'
import { COMMODITY_ICONS, FOREX_ICONS, STOCK_ICONS } from '../lib/iconManifest'
import type { Category } from '../lib/hyperliquid'

function imgSrc(category: Category, base: string): string | null {
  const sym = base.toUpperCase()
  if (category === 'stocks' && STOCK_ICONS.has(sym)) return `/icons/stocks/${sym}.png`
  if (category === 'forex' && FOREX_ICONS.has(sym)) return `/icons/forex/${sym}.png`
  if (category === 'commodities' && COMMODITY_ICONS.has(sym)) return `/icons/commodities/${sym}.png`
  return null
}

function hue(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

/** Letter badge for markets without a logo (indices, unlisted perps). */
function Badge({ base, size }: { base: string; size: number }) {
  const letters = base.replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase() || '?'
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `hsl(${hue(base)} 45% 32%)`,
        color: '#fff',
        fontSize: Math.max(8, size * 0.38),
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {letters}
    </span>
  )
}

/**
 * One icon for every market: web3icons SVG for crypto, cloned-repo PNGs for
 * stocks/forex/commodities, letter badge for everything else (indices etc).
 */
export default function MarketIcon({
  base,
  category,
  size = 18,
  style,
}: {
  base: string
  category: Category
  size?: number
  style?: CSSProperties
}) {
  const [failed, setFailed] = useState(false)
  if (category === 'crypto') return <CryptoIcon symbol={base} size={size} />
  const src = imgSrc(category, base)
  if (!src || failed) return <Badge base={base} size={size} />
  return (
    <img
      src={src}
      alt={base}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ borderRadius: '50%', objectFit: 'contain', flexShrink: 0, display: 'block', background: '#1c1c22', ...style }}
    />
  )
}
