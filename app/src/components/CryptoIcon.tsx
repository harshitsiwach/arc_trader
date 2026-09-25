import type { CSSProperties, ElementType } from 'react'
import TokenAAVE from '@web3icons/react/icons/tokens/TokenAAVE'
import TokenADA from '@web3icons/react/icons/tokens/TokenADA'
import TokenAPT from '@web3icons/react/icons/tokens/TokenAPT'
import TokenARB from '@web3icons/react/icons/tokens/TokenARB'
import TokenATOM from '@web3icons/react/icons/tokens/TokenATOM'
import TokenAVAX from '@web3icons/react/icons/tokens/TokenAVAX'
import TokenBCH from '@web3icons/react/icons/tokens/TokenBCH'
import TokenBTC from '@web3icons/react/icons/tokens/TokenBTC'
import TokenDOGE from '@web3icons/react/icons/tokens/TokenDOGE'
import TokenDOT from '@web3icons/react/icons/tokens/TokenDOT'
import TokenETH from '@web3icons/react/icons/tokens/TokenETH'
import TokenFIL from '@web3icons/react/icons/tokens/TokenFIL'
import TokenGRT from '@web3icons/react/icons/tokens/TokenGRT'
import TokenHYPE from '@web3icons/react/icons/tokens/TokenHYPE'
import TokenIMX from '@web3icons/react/icons/tokens/TokenIMX'
import TokenINJ from '@web3icons/react/icons/tokens/TokenINJ'
import TokenJUP from '@web3icons/react/icons/tokens/TokenJUP'
import TokenLDO from '@web3icons/react/icons/tokens/TokenLDO'
import TokenLINK from '@web3icons/react/icons/tokens/TokenLINK'
import TokenLTC from '@web3icons/react/icons/tokens/TokenLTC'
import TokenMKR from '@web3icons/react/icons/tokens/TokenMKR'
import TokenNEAR from '@web3icons/react/icons/tokens/TokenNEAR'
import TokenOP from '@web3icons/react/icons/tokens/TokenOP'
import TokenPEPE from '@web3icons/react/icons/tokens/TokenPEPE'
import TokenRUNE from '@web3icons/react/icons/tokens/TokenRUNE'
import TokenSEI from '@web3icons/react/icons/tokens/TokenSEI'
import TokenSOL from '@web3icons/react/icons/tokens/TokenSOL'
import TokenSTX from '@web3icons/react/icons/tokens/TokenSTX'
import TokenSUI from '@web3icons/react/icons/tokens/TokenSUI'
import TokenTIA from '@web3icons/react/icons/tokens/TokenTIA'
import TokenTON from '@web3icons/react/icons/tokens/TokenTON'
import TokenTRX from '@web3icons/react/icons/tokens/TokenTRX'
import TokenUNI from '@web3icons/react/icons/tokens/TokenUNI'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'
import TokenUSDT from '@web3icons/react/icons/tokens/TokenUSDT'
import TokenDAI from '@web3icons/react/icons/tokens/TokenDAI'
import TokenWBTC from '@web3icons/react/icons/tokens/TokenWBTC'
import TokenXRP from '@web3icons/react/icons/tokens/TokenXRP'

/** Curated crypto-only icon map. Unknown symbols render nothing (stocks/commodities keep text). */
const MAP: Record<string, ElementType> = {
  AAVE: TokenAAVE, ADA: TokenADA, APT: TokenAPT, ARB: TokenARB, ATOM: TokenATOM,
  AVAX: TokenAVAX, BCH: TokenBCH, BTC: TokenBTC, DOGE: TokenDOGE, DOT: TokenDOT,
  ETH: TokenETH, FIL: TokenFIL, GRT: TokenGRT, HYPE: TokenHYPE, IMX: TokenIMX,
  INJ: TokenINJ, JUP: TokenJUP, LDO: TokenLDO, LINK: TokenLINK, LTC: TokenLTC,
  MKR: TokenMKR, NEAR: TokenNEAR, OP: TokenOP, PEPE: TokenPEPE, RUNE: TokenRUNE,
  SEI: TokenSEI, SOL: TokenSOL, STX: TokenSTX, SUI: TokenSUI, TIA: TokenTIA,
  TON: TokenTON, TRX: TokenTRX, UNI: TokenUNI, USDC: TokenUSDC, USDT: TokenUSDT,
  DAI: TokenDAI, WBTC: TokenWBTC, XRP: TokenXRP,
}

export default function CryptoIcon({
  symbol,
  size = 18,
  style,
}: {
  symbol: string
  size?: number | string
  style?: CSSProperties
}) {
  const C = MAP[symbol.toUpperCase()]
  if (!C) return null
  return (
    <C
      size={size}
      variant="branded"
      style={{ borderRadius: '50%', flexShrink: 0, display: 'block', ...style }}
    />
  )
}
