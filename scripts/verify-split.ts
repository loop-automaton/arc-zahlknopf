/**
 * Lokaler Test der UI-Prüflogik (src/mainnet-verify.ts) gegen beliebigen RPC – nur Lese-Aufrufe.
 *   bun scripts/verify-split.ts <rpc-url> <contract-adresse>
 * Exit 0 = alle Prüfungen ok, sonst Fehler-Exit (Exception).
 */
import { createPublicClient, http, isAddress } from 'viem'
import { verifySplit } from '../src/mainnet-verify'

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv
const [rpc, address] = argv.slice(2)
if (!rpc || !address || !isAddress(address)) {
  throw new Error('Aufruf: bun scripts/verify-split.ts <rpc-url> <adresse>')
}
const client = createPublicClient({ transport: http(rpc) })
const res = await verifySplit(client, address)
for (const c of res.checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.label}: ${c.detail}`)
console.log(res.ok ? 'ERGEBNIS: geprüft' : 'ERGEBNIS: NICHT bestanden')
if (!res.ok) throw new Error('Prüfung nicht bestanden')
