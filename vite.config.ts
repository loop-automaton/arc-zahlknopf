import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => ({
  // GitHub Pages project site: https://loop-automaton.github.io/arc-zahlknopf/
  // Mainnet-Build (bun run build:mainnet) landet getrennt in dist-mainnet/ unter /arc-zahlknopf/mainnet/,
  // die Testnet-Demo (dist/) bleibt unverändert.
  base: mode === 'mainnet' ? '/arc-zahlknopf/mainnet/' : '/arc-zahlknopf/',
  build: { outDir: mode === 'mainnet' ? 'dist-mainnet' : 'dist', sourcemap: false },
  // Netzwerk fest in den Build schreiben (keine .env-Datei nötig, siehe src/network.ts)
  define: { 'import.meta.env.VITE_NETWORK': JSON.stringify(mode === 'mainnet' ? 'mainnet' : 'testnet') },
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'lucide-react',
      'sonner',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    host: '127.0.0.1',
  },
}))
