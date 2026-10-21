/**
 * wagmi configuration – Arc Testnet (Standard) oder Arc Mainnet (VITE_NETWORK=mainnet, bun run build:mainnet)
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { IS_MAINNET, NET } from './network'

// mainnet (Ethereum) only for ENS name lookups
export const config = IS_MAINNET
  ? createConfig({
      chains: [arc, mainnet],
      connectors: [injected()],
      transports: {
        [arc.id]: http(NET.rpcUrl),
        [mainnet.id]: http('https://cloudflare-eth.com'),
      },
    })
  : createConfig({
      chains: [arcTestnet, mainnet],
      connectors: [injected()],
      transports: {
        [arcTestnet.id]: http(NET.rpcUrl),
        [mainnet.id]: http('https://cloudflare-eth.com'),
      },
    })
