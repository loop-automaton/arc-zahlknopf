/**
 * Netzwerk-Auswahl zur Build-Zeit.
 *
 *   bun run build           → Arc Testnet (Standard, unveränderte Demo)
 *   bun run build:mainnet   → Arc Mainnet (echtes Geld), eigener Ordner dist-mainnet/
 *
 * Gesteuert über VITE_NETWORK ("testnet" | "mainnet"). Alles andere fällt auf Testnet zurück.
 */
import type { Address } from 'viem'
import { arc, arcTestnet } from 'viem/chains'

export type NetworkKind = 'testnet' | 'mainnet'

export const NETWORK: NetworkKind = import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
export const IS_MAINNET = NETWORK === 'mainnet'

/**
 * PLATZHALTER – MAINNET-SPLIT NOCH NICHT DEPLOYT.
 * Vor dem Mainnet-Build durch die echte ZahlknopfSplit-Adresse ersetzen (nach Deploy + Prüfung
 * von recipients()/shares()/usdc() und Bytecode). Solange hier die Null-Adresse steht, sperrt die
 * UI jede Zahlung.
 */
export const MAINNET_SPLIT_PLACEHOLDER = '0x0000000000000000000000000000000000000000' as Address

const TESTNET_SPLIT = '0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8' as Address

interface NetworkConfig {
  chain: typeof arc | typeof arcTestnet
  label: string
  rpcUrl: string
  explorerBase: string
  splitAddress: Address
  /** Obergrenze pro Zahlung in USDC (nur Mainnet, Schutz vor Tippfehlern). */
  maxAmountUsdc: string | null
}

const CONFIGS: Record<NetworkKind, NetworkConfig> = {
  testnet: {
    chain: arcTestnet, // 5042002
    label: 'Arc Testnet',
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorerBase: 'https://explorer.testnet.arc.io',
    splitAddress: TESTNET_SPLIT,
    maxAmountUsdc: null,
  },
  mainnet: {
    chain: arc, // 5042
    label: 'Arc Mainnet',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerBase: 'https://explorer.arc.io',
    splitAddress: MAINNET_SPLIT_PLACEHOLDER,
    maxAmountUsdc: '3',
  },
}

export const NET = CONFIGS[NETWORK]

export const SPLIT_IS_PLACEHOLDER = /^0x0{40}$/i.test(NET.splitAddress)
