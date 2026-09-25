import { createConfig, http } from 'wagmi'
import { arc, arcTestnet, base, baseSepolia, mainnet, sepolia } from 'viem/chains'
import { injected } from 'wagmi/connectors'

// Arc chains first; public mainnets/testnets included as CCTP counterparties.
export const config = createConfig({
  chains: [arc, arcTestnet, baseSepolia, sepolia, base, mainnet],
  connectors: [injected()],
  transports: {
    [arc.id]: http(import.meta.env.VITE_ARC_RPC_URL ?? 'https://rpc.mainnet.arc.io'),
    [arcTestnet.id]: http(
      import.meta.env.VITE_ARC_TESTNET_RPC ?? 'https://rpc.testnet.arc.io',
    ),
    [baseSepolia.id]: http(),
    [sepolia.id]: http(),
    [base.id]: http(),
    [mainnet.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
