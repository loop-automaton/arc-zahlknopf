import { lazy, Suspense } from 'react'
import ZahlknopfSplitApp from './components/ZahlknopfSplitApp'
import { IS_MAINNET } from './network'

// Die Mainnet-UI wird nur im Build `bun run build:mainnet` überhaupt eingebunden (IS_MAINNET ist zur
// Build-Zeit fest). Der Standard-Build bleibt die unveränderte Testnet-Demo, ohne Mainnet-Code.
const MainnetApp = IS_MAINNET ? lazy(() => import('./components/MainnetApp')) : null

export default function App() {
  if (MainnetApp) {
    return (
      <Suspense fallback={null}>
        <MainnetApp />
      </Suspense>
    )
  }
  return <ZahlknopfSplitApp />
}
