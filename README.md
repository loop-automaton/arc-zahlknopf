# arc-zahlknopf

> **DE:** Ein Projekt von Loop Automaton (KI-Agent, betrieben von Phelan Brunk). Gebaut mit Arc Studio, Code von KI geschrieben, geprüft und verantwortet vom Betreiber.
>
> **EN:** A project by Loop Automaton (an AI agent operated by Phelan Brunk). Built with Arc Studio; code written by AI, reviewed and owned by the operator.

**Deutsch** · [English](#english)

USDC-Zahlknopf mit festem Split auf [Arc](https://arc.io) (Circles Layer 1). Ein einziger `pay()`-Aufruf verteilt eine USDC-Zahlung atomar an feste Empfänger in festen Anteilen. Demo-UI: https://loop-automaton.github.io/arc-zahlknopf/ (Arc Testnet). Mainnet-UI: https://loop-automaton.github.io/arc-zahlknopf/mainnet/ (Arc Mainnet, siehe unten).

> ⚠️ Kein Audit. Auf Arc Mainnet nur ein Test des Betreibers (100 % an die eigene Wallet, max. 3 USDC pro Zahlung). Nicht für echte Zahlungen verwenden, ohne den Code selbst zu prüfen.

## Sicherheitsmodell
- **Kein Owner, kein Admin:** keine Rollen, kein Pause, kein Proxy/Upgrade, kein `selfdestruct`, kein `delegatecall`. Empfänger und Anteile werden im Konstruktor gesetzt und sind danach unveränderlich.
- **Hält keine Mittel:** `pay()` überweist per `transferFrom` direkt vom Zahler an die Empfänger. Der Contract hat nie ein Guthaben, nichts ist `payable`, es gibt keine Abhebe-Funktion.
- **Exakter Approve:** Die UI genehmigt immer genau den eingegebenen Betrag (`approve(contract, betrag)`), nie unbegrenzt.
- **Rundung:** Der Rundungsrest geht an den letzten Empfänger; die Summe entspricht immer exakt dem Betrag.
- **Risiko gesperrter Empfänger:** USDC kann Adressen sperren (Blocklist). Wird ein Empfänger nach dem Deploy gesperrt, schlägt jedes `pay()` dauerhaft fehl. Mangels Admin gibt es dann nur einen Weg: neuen Contract deployen.
- Schutz gegen Reentrancy (OpenZeppelin `ReentrancyGuard`), `SafeERC20`.

## Deployment (Arc Testnet)
| | |
|---|---|
| Contract | `ZahlknopfSplit` – [`0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8`](https://explorer.testnet.arc.io/address/0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8) |
| Chain | Arc Testnet, Chain-ID `5042002`, RPC `https://rpc.testnet.arc.io` |
| USDC (ERC-20, 6 Dezimalen) | `0x3600000000000000000000000000000000000000` |
| Demo-Split | 5 % → `0x000000000000000000000000000000000000dEaD`, 95 % → `0x800600637acE0c5afA6fa09c987D246Cf52C351b` (Testnet-Wegwerf-Wallet des Betreibers; letzter Empfänger, erhält den Rundungsrest) |
| Deploy-Tx | [`0x1003b853…cfe0a`](https://explorer.testnet.arc.io/tx/0x1003b853da77eef626d1fa263eb8f21780024dbc957a40b129f68fe1220cfe0a) (Foundry `forge create`) |
| Testzahlung 1 USDC | [`0x82c29df6…5212d`](https://explorer.testnet.arc.io/tx/0x82c29df6e47c64e0a6dba71cfbded48679e0e527f6c3d31f26f986b27ef5212d) – 0,95 → Wallet, 0,05 → dEaD, Contract-Saldo danach 0 |

## Mainnet-Build (Arc Mainnet, Chain 5042) – Branch `mainnet`
> ⚠️ Echtes Geld. Kein Audit. Nur für den eigenen Test des Betreibers (1 USDC, Obergrenze 3 USDC pro Zahlung).

- `bun run build:mainnet` baut eine getrennte UI nach `dist-mainnet/` (Pfad `/arc-zahlknopf/mainnet/`). Der Standard-Build bleibt die Testnet-Demo.
- Der Contract wird **über diese UI** deployt und im injizierten Wallet (MetaMask) signiert. Arc Studio schreibt und testet nur auf Testnet; der Mainnet-Deploy läuft deshalb über die eigene App.
- Fester Init-Code (Creation-Code + Konstruktor-Args `usdc = 0x3600000000000000000000000000000000000000`, `recipients = [0x713B265c525f5aED566A014DcE7E00d3197dA106]`, `shares = [10000]`) in `src/mainnet-deploy.ts`. Empfänger sind fest eingebaut, es gibt kein Eingabefeld.
- **Init-Code-Hash (keccak256): `0xbecdcba40f6e52c9f2ff4c7435b7217125c9ef5f7f23fdcff83e57efc87f2c55`**
- Reproduzieren: `bun run verify:initcode` (erzeugt den Init-Code per `forge inspect` + `cast abi-encode` neu und vergleicht ihn Byte für Byte).
- Nach dem Deploy prüft die UI `eth_getCode` (Runtime-Hash `0xf960295074a76b84e32eda31c86c9c223cd623a5b855abd9692908a3e45d560d`), `recipients()`, `shares()` und `usdc()`. Ohne bestandene Prüfung ist die Zahlung gesperrt. Approve immer exakt, nie unbegrenzt.

### Deployment (Arc Mainnet)
| | |
|---|---|
| Contract | `ZahlknopfSplit` – [`0xe09CaEC67CB6b5947136038f4e442a0B125C9389`](https://explorer.arc.io/address/0xe09CaEC67CB6b5947136038f4e442a0B125C9389) (fest eingetragen in `src/network.ts`) |
| Chain | Arc Mainnet, Chain-ID `5042`, RPC `https://rpc.mainnet.arc.io` |
| Split | 100 % → `0x713B265c525f5aED566A014DcE7E00d3197dA106` (Wallet des Betreibers; `shares = [10000]`) |
| Deploy-Tx | [`0xa960c239…f8561c`](https://explorer.arc.io/tx/0xa960c239980fc667de014bc5609dc91437ff0f5c7db050a196dbd5df1bf8561c) – über die Mainnet-UI, Block 27099159, Runtime-Hash wie oben |
| Approve-Tx | [`0x78a04944…631265`](https://explorer.arc.io/tx/0x78a04944567a2311d69dc2147e8c54775e0d06fed4fa863162e427a7b5631265) – exakt 1 USDC an den Contract |
| Testzahlung 1 USDC | [`0x0bf0cb6c…c046a0`](https://explorer.arc.io/tx/0x0bf0cb6ceb4917494aa903b8267b8dd081bdc75d0a9497c2208c952e1ac046a0) – `pay(1 USDC, "loop-mainnet-test-1")`, 1 USDC → Betreiber-Wallet, Allowance danach 0 |
| Mainnet-UI | https://loop-automaton.github.io/arc-zahlknopf/mainnet/ |

## Tests
```bash
bun install --frozen-lockfile --ignore-scripts   # OpenZeppelin 5.1.0 kommt aus node_modules
forge test                                         # Foundry 1.8.5: 28 Tests, alle grün
```
Abgedeckt: Splits (95/5, 50/30/20, 1 und 10 Empfänger), Rundung inkl. 2 Fuzz-Tests, Reentrancy, Null-Adressen, ungültige Anteile, Betrag 0, fehlende Allowance, Event.

## Frontend
```bash
bun run dev      # lokal
bun run build    # statischer Build nach dist/ (Base-Pfad /arc-zahlknopf/)
```
React, Vite, wagmi/viem, ConnectKit. Veröffentlichung über GitHub Pages aus dem Branch `gh-pages` (statischer Build).

Gebaut mit [Arc Studio](https://studio.arc.io), danach geprüft und aufgeräumt (siehe Kennzeichnung oben).

Lizenz: MIT, © 2026 Phelan Brunk.

---

## English

USDC pay button with a fixed split on [Arc](https://arc.io) (Circle's Layer 1). A single `pay()` call atomically forwards a USDC payment to fixed recipients in fixed shares. Demo UI: https://loop-automaton.github.io/arc-zahlknopf/ (Arc Testnet). Mainnet UI: https://loop-automaton.github.io/arc-zahlknopf/mainnet/ (Arc mainnet, see below).

> ⚠️ Not audited. On Arc mainnet this is only the operator's own test (100 % to the operator's wallet, max 3 USDC per payment). Review the code yourself before using it for real payments.

### Security model
- **No owner, no admin:** no roles, no pause, no proxy/upgrade, no `selfdestruct`, no `delegatecall`. Recipients and shares are set in the constructor and are immutable afterwards.
- **Holds no funds:** `pay()` moves USDC via `transferFrom` straight from the payer to the recipients. The contract never holds a balance, nothing is `payable`, there is no withdraw function.
- **Exact approval:** the UI always approves exactly the entered amount, never unlimited.
- **Rounding:** the rounding remainder goes to the last recipient; the parts always add up to the amount.
- **Blocked-recipient risk:** USDC can blocklist addresses. If a recipient is blocklisted after deployment, every `pay()` reverts permanently. With no admin, the only fix is deploying a new contract.
- Reentrancy guard (OpenZeppelin `ReentrancyGuard`), `SafeERC20`.

### Deployment (Arc Testnet)
Contract `ZahlknopfSplit` at [`0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8`](https://explorer.testnet.arc.io/address/0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8), chain ID `5042002`, USDC `0x3600000000000000000000000000000000000000`. Demo split: 5 % to `0x…dEaD`, 95 % to the operator's throwaway testnet wallet `0x800600637acE0c5afA6fa09c987D246Cf52C351b` (last recipient, gets the rounding remainder). Deployed with Foundry (`forge create`), [deploy tx](https://explorer.testnet.arc.io/tx/0x1003b853da77eef626d1fa263eb8f21780024dbc957a40b129f68fe1220cfe0a); [1 USDC test payment](https://explorer.testnet.arc.io/tx/0x82c29df6e47c64e0a6dba71cfbded48679e0e527f6c3d31f26f986b27ef5212d).

### Mainnet build (Arc mainnet, chain 5042) – branch `mainnet`
Real money, not audited. `bun run build:mainnet` builds a separate UI into `dist-mainnet/`; the default build stays the testnet demo. The contract is deployed **through this UI** and signed in the injected wallet; Arc Studio only writes and tests on testnet, so the mainnet deploy goes through our own app. Fixed init code (USDC `0x3600…0000`, recipients `[0x713B265c525f5aED566A014DcE7E00d3197dA106]`, shares `[10000]`) lives in `src/mainnet-deploy.ts`. **Init code hash: `0xbecdcba40f6e52c9f2ff4c7435b7217125c9ef5f7f23fdcff83e57efc87f2c55`**; reproduce with `bun run verify:initcode`. After deployment the UI checks code hash, `recipients()`, `shares()` and `usdc()` before enabling the exact approve and `pay()` (max 3 USDC).

### Deployment (Arc mainnet)
Contract `ZahlknopfSplit` at [`0xe09CaEC67CB6b5947136038f4e442a0B125C9389`](https://explorer.arc.io/address/0xe09CaEC67CB6b5947136038f4e442a0B125C9389) (fixed in `src/network.ts`), chain ID `5042`, USDC `0x3600000000000000000000000000000000000000`. Split: 100 % to the operator's wallet `0x713B265c525f5aED566A014DcE7E00d3197dA106`. Deployed through the mainnet UI: [deploy tx](https://explorer.arc.io/tx/0xa960c239980fc667de014bc5609dc91437ff0f5c7db050a196dbd5df1bf8561c), [exact 1 USDC approve](https://explorer.arc.io/tx/0x78a04944567a2311d69dc2147e8c54775e0d06fed4fa863162e427a7b5631265), [1 USDC test payment](https://explorer.arc.io/tx/0x0bf0cb6ceb4917494aa903b8267b8dd081bdc75d0a9497c2208c952e1ac046a0) (`pay(1 USDC, "loop-mainnet-test-1")`, allowance 0 afterwards).

### Tests
`bun install --frozen-lockfile --ignore-scripts && forge test` – 28 tests, all passing (Foundry 1.8.5).

Built with [Arc Studio](https://studio.arc.io), then reviewed and cleaned up (see the notice at the top).

License: MIT, © 2026 Phelan Brunk.
