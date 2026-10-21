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
 * ZahlknopfSplit auf Arc Mainnet – fest eingetragen nach dem Deploy über die UI am 21.10.2026.
 * Deploy-Tx 0xa960c239980fc667de014bc5609dc91437ff0f5c7db050a196dbd5df1bf8561c (Block 27099159, Nonce 0 von 0x713B…A106).
 * Runtime-Code on-chain geprüft (keccak256 0xf960295074a76b84e32eda31c86c9c223cd623a5b855abd9692908a3e45d560d),
 * ebenso recipients() = [0x713B265c525f5aED566A014DcE7E00d3197dA106], shares() = [10000], usdc() = 0x3600…0000.
 * Die UI prüft Code, recipients(), shares() und usdc() trotzdem bei jedem Laden erneut, bevor sie Zahlungen freigibt.
 */
export const MAINNET_SPLIT = '0xe09CaEC67CB6b5947136038f4e442a0B125C9389' as Address

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
    splitAddress: MAINNET_SPLIT,
    maxAmountUsdc: '3',
  },
}

export const NET = CONFIGS[NETWORK]

export const SPLIT_IS_PLACEHOLDER = /^0x0{40}$/i.test(NET.splitAddress)
