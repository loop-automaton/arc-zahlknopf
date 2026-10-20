# arc-zahlknopf

> **DE:** Ein Projekt von Loop Automaton (KI-Agent, betrieben von Phelan Brunk). Gebaut mit Arc Studio, Code von KI geschrieben, geprüft und verantwortet vom Betreiber.
>
> **EN:** A project by Loop Automaton (an AI agent operated by Phelan Brunk). Built with Arc Studio; code written by AI, reviewed and owned by the operator.

**Deutsch** · [English](#english)

USDC-Zahlknopf mit festem Split auf [Arc](https://arc.io) (Circles Layer 1). Ein einziger `pay()`-Aufruf verteilt eine USDC-Zahlung atomar an feste Empfänger in festen Anteilen. Demo-UI: https://loop-automaton.github.io/arc-zahlknopf/ (nur Arc Testnet).

> ⚠️ Nur Testnet. Kein Audit. Nicht für echte Zahlungen verwenden, ohne den Code selbst zu prüfen.

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

USDC pay button with a fixed split on [Arc](https://arc.io) (Circle's Layer 1). A single `pay()` call atomically forwards a USDC payment to fixed recipients in fixed shares. Demo UI: https://loop-automaton.github.io/arc-zahlknopf/ (Arc Testnet only).

> ⚠️ Testnet only. Not audited. Review the code yourself before using it for real payments.

### Security model
- **No owner, no admin:** no roles, no pause, no proxy/upgrade, no `selfdestruct`, no `delegatecall`. Recipients and shares are set in the constructor and are immutable afterwards.
- **Holds no funds:** `pay()` moves USDC via `transferFrom` straight from the payer to the recipients. The contract never holds a balance, nothing is `payable`, there is no withdraw function.
- **Exact approval:** the UI always approves exactly the entered amount, never unlimited.
- **Rounding:** the rounding remainder goes to the last recipient; the parts always add up to the amount.
- **Blocked-recipient risk:** USDC can blocklist addresses. If a recipient is blocklisted after deployment, every `pay()` reverts permanently. With no admin, the only fix is deploying a new contract.
- Reentrancy guard (OpenZeppelin `ReentrancyGuard`), `SafeERC20`.

### Deployment (Arc Testnet)
Contract `ZahlknopfSplit` at [`0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8`](https://explorer.testnet.arc.io/address/0x45364c0e727Fb6DEB933bD108c361a0F6413aEA8), chain ID `5042002`, USDC `0x3600000000000000000000000000000000000000`. Demo split: 5 % to `0x…dEaD`, 95 % to the operator's throwaway testnet wallet `0x800600637acE0c5afA6fa09c987D246Cf52C351b` (last recipient, gets the rounding remainder). Deployed with Foundry (`forge create`), [deploy tx](https://explorer.testnet.arc.io/tx/0x1003b853da77eef626d1fa263eb8f21780024dbc957a40b129f68fe1220cfe0a); [1 USDC test payment](https://explorer.testnet.arc.io/tx/0x82c29df6e47c64e0a6dba71cfbded48679e0e527f6c3d31f26f986b27ef5212d).

### Tests
`bun install --frozen-lockfile --ignore-scripts && forge test` – 28 tests, all passing (Foundry 1.8.5).

Built with [Arc Studio](https://studio.arc.io), then reviewed and cleaned up (see the notice at the top).

License: MIT, © 2026 Phelan Brunk.
