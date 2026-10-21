/**
 * On-chain-Prüfung eines deployten ZahlknopfSplit gegen die fest eingebauten Erwartungen.
 * Reine Lese-Aufrufe (eth_getCode, eth_call). Ohne Pfad-Aliase, damit sie auch per `bun` lokal testbar ist.
 */
import { keccak256, isAddressEqual, type Address, type PublicClient } from 'viem'
import {
  EXPECTED_RECIPIENTS,
  EXPECTED_SHARES,
  RUNTIME_CODE_HASH,
  USDC_ADDRESS,
} from './mainnet-deploy'

export const SPLIT_READ_ABI = [
  { type: 'function', name: 'recipients', inputs: [], outputs: [{ type: 'address[]' }], stateMutability: 'view' },
  { type: 'function', name: 'shares', inputs: [], outputs: [{ type: 'uint16[]' }], stateMutability: 'view' },
  { type: 'function', name: 'usdc', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

export interface Check {
  label: string
  ok: boolean
  detail: string
}

export interface VerifyResult {
  ok: boolean
  checks: Check[]
}

export async function verifySplit(client: Pick<PublicClient, 'getCode' | 'readContract'>, address: Address): Promise<VerifyResult> {
  const checks: Check[] = []

  const code = await client.getCode({ address })
  const hasCode = !!code && code !== '0x'
  const codeHash = hasCode ? keccak256(code) : null
  checks.push({
    label: 'eth_getCode: Code vorhanden und = geprüfter Runtime-Code',
    ok: hasCode && codeHash === RUNTIME_CODE_HASH,
    detail: hasCode ? `keccak256 ${codeHash}` : 'kein Code an dieser Adresse',
  })
  if (!hasCode) return { ok: false, checks }

  const [recipients, shares, usdc] = await Promise.all([
    client.readContract({ address, abi: SPLIT_READ_ABI, functionName: 'recipients' }),
    client.readContract({ address, abi: SPLIT_READ_ABI, functionName: 'shares' }),
    client.readContract({ address, abi: SPLIT_READ_ABI, functionName: 'usdc' }),
  ])

  const recOk =
    recipients.length === EXPECTED_RECIPIENTS.length &&
    recipients.every((r, i) => isAddressEqual(r, EXPECTED_RECIPIENTS[i]))
  checks.push({ label: 'recipients()', ok: recOk, detail: `[${recipients.join(', ')}]` })

  const sharesNum = shares.map(Number)
  const sharesOk = sharesNum.length === EXPECTED_SHARES.length && sharesNum.every((s, i) => s === EXPECTED_SHARES[i])
  checks.push({ label: 'shares()', ok: sharesOk, detail: `[${sharesNum.join(', ')}]` })

  checks.push({ label: 'usdc()', ok: isAddressEqual(usdc, USDC_ADDRESS), detail: usdc })

  return { ok: checks.every((c) => c.ok), checks }
}
