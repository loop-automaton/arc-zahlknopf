/**
 * wagmi configuration (Arc Testnet only)
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet only for ENS name lookups
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.io'),
    [mainnet.id]: http('https://cloudflare-eth.com'),
  },
})
