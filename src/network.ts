/**
 * Netzwerk-Auswahl zur Build-Zeit.
 *
 *   bun run build           → Arc Testnet (Standard, unveränderte Demo)
 *   bun run build:mainnet   → Arc Mainnet (echtes Geld), eigener Ordner dist-mainnet/
 *
 * Gesteuert über VITE_NETWORK ("testnet" | "mainnet"). Alles andere fällt auf Testnet zurück.
 */
import { defineChain, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'

/**
 * Arc Mainnet nur mit den offiziellen Daten aus docs.arc.io (ein RPC, ein Explorer).
 * Diese Werte gehen auch in wallet_addEthereumChain.
 */
export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

export type NetworkKind = 'testnet' | 'mainnet'

export const NETWORK: NetworkKind = import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
export const IS_MAINNET = NETWORK === 'mainnet'

/**
 * PLATZHALTER – MAINNET-SPLIT NOCH NICHT FEST EINGETRAGEN.
 * Nach dem Deploy (über die UI) und der Prüfung von Code/recipients()/shares()/usdc() in einem kleinen
 * zweiten Commit durch die echte ZahlknopfSplit-Adresse ersetzen. Bis dahin nutzt die Mainnet-UI nur
 * eine Adresse, die sie selbst aus dem Deploy-Receipt gelesen UND on-chain geprüft hat (localStorage);
 * ohne geprüfte Adresse ist die Zahlung gesperrt.
 */
export const MAINNET_SPLIT_PLACEHOLDER = '0x0000000000000000000000000000000000000000' as Address

const TESTNET_SPLIT = '0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8' as Address

interface NetworkConfig {
  chain: typeof arcMainnet | typeof arcTestnet
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
    chain: arcMainnet, // 5042
    label: 'Arc Mainnet',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerBase: 'https://explorer.arc.io',
    splitAddress: MAINNET_SPLIT_PLACEHOLDER,
    maxAmountUsdc: '3',
  },
}

export const NET = CONFIGS[NETWORK]

export const SPLIT_IS_PLACEHOLDER = /^0x0{40}$/i.test(NET.splitAddress)
