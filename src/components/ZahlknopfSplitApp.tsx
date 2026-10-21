/**
 * arc-zahlknopf — USDC Zahlknopf UI
 * Reads recipients/shares from the deployed ZahlknopfSplit contract,
 * approves EXACTLY the entered amount, then calls pay().
 */
import { useState, useCallback } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, type Address } from 'viem'
import { ExternalLink, Loader2, CheckCircle2, AlertTriangle, Split } from 'lucide-react'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { NET, IS_MAINNET, SPLIT_IS_PLACEHOLDER } from '@/network'
import { Amount, parseAmount, formatAmount, usdcDecimalsFor } from '@/onchain-money'

// ---------------------------------------------------------------------------
// Contract config — Arc Testnet (5042002, Standard) oder Arc Mainnet (5042), siehe src/network.ts
// ---------------------------------------------------------------------------
const CHAIN_ID = NET.chain.id
const USDC_FACT = getUsdc(CHAIN_ID)
if (!USDC_FACT) throw new Error(`USDC not found for ${NET.label} in onchain-facts`)
const USDC_ADDRESS = USDC_FACT.address as Address
// USDC-ERC-20 auf Arc (Mainnet und Testnet identisch, 6 Dezimalen)
if (USDC_ADDRESS.toLowerCase() !== '0x3600000000000000000000000000000000000000') {
  throw new Error('Unerwartete USDC-Adresse – Abbruch')
}

const SPLIT_ADDRESS = NET.splitAddress

const SPLIT_ABI = [
  {
    type: 'function',
    name: 'recipients',
    inputs: [],
    outputs: [{ type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'shares',
    inputs: [],
    outputs: [{ type: 'uint16[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pay',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'orderId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const glass = {
  card: {
    background: 'rgba(255, 255, 255, 0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid rgba(18,45,69,0.10)',
    borderRadius: '24px',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(18,45,69,0.08)',
    borderRadius: '16px',
  } as React.CSSProperties,
}

function shortenAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace('.00', '')} %`
}

function parseOnchainError(err: unknown): string {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaktion abgelehnt.'
  if (msg.includes('insufficient') || msg.includes('exceeds balance')) return 'Unzureichendes Guthaben.'
  if (msg.includes('reverted')) {
    const m = msg.match(/error: ([^(]+)/)
    return m ? `Transaktion fehlgeschlagen: ${m[1].trim()}` : 'Transaktion fehlgeschlagen.'
  }
  if (msg.includes('network') || msg.includes('timeout')) return 'Netzwerkfehler. Bitte erneut versuchen.'
  return 'Fehler. Bitte erneut versuchen.'
}

// ---------------------------------------------------------------------------
// Recipient row
// ---------------------------------------------------------------------------
function RecipientRow({ addr, bps, index }: { addr: string; bps: number; index: number }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderBottom: index === 0 ? '1px solid rgba(18,45,69,0.07)' : 'none' }}
    >
      <div className="flex flex-col">
        <span className="mono text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          {shortenAddr(addr)}
        </span>
        <span className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
          {addr === '0x000000000000000000000000000000000000dEaD' ? 'Burn-Adresse' : 'Zahlungsempfänger'}
        </span>
      </div>
      <span
        className="display text-lg font-bold tabular-nums"
        style={{ color: 'var(--accent)' }}
      >
        {formatBps(bps)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ZahlknopfSplitApp() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [amount, setAmount] = useState('')
  const [orderRef, setOrderRef] = useState('')
  const [step, setStep] = useState<'idle' | 'approving' | 'paying' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [payTxHash, setPayTxHash] = useState<`0x${string}` | undefined>()

  // Read contract recipients & shares
  const { data: recipients } = useReadContract({
    address: SPLIT_ADDRESS,
    abi: SPLIT_ABI,
    functionName: 'recipients',
    chainId: CHAIN_ID,
    query: { enabled: !SPLIT_IS_PLACEHOLDER },
  })
  const { data: shares } = useReadContract({
    address: SPLIT_ADDRESS,
    abi: SPLIT_ABI,
    functionName: 'shares',
    chainId: CHAIN_ID,
    query: { enabled: !SPLIT_IS_PLACEHOLDER },
  })

  // wagmi write hooks — approve
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: isApprovePending,
  } = useWriteContract()

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } =
    useWaitForTransactionReceipt({ hash: approveTxHash })

  // wagmi write hooks — pay
  const {
    writeContract: writePay,
    data: payTxHashRaw,
    isPending: isPayPending,
  } = useWriteContract()

  const { isLoading: isPayConfirming, isSuccess: isPaySuccess } =
    useWaitForTransactionReceipt({ hash: payTxHashRaw })

  // When pay tx confirms
  const [paySubmitted, setPaySubmitted] = useState(false)
  if (payTxHashRaw && !paySubmitted) {
    setPaySubmitted(true)
    setPayTxHash(payTxHashRaw)
  }
  if (isPaySuccess && step === 'paying') {
    setStep('done')
  }

  // When approve confirms -> trigger pay
  const [approveHandled, setApproveHandled] = useState(false)
  const doCallPay = useCallback(
    (parsedAmount: bigint, orderId: `0x${string}`) => {
      writePay({
        address: SPLIT_ADDRESS,
        abi: SPLIT_ABI,
        functionName: 'pay',
        args: [parsedAmount, orderId],
        chainId: CHAIN_ID,
      })
      setStep('paying')
    },
    [writePay],
  )

  const [pendingPayArgs, setPendingPayArgs] = useState<
    { parsedAmount: bigint; orderId: `0x${string}` } | null
  >(null)

  if (isApproveSuccess && pendingPayArgs && !approveHandled) {
    setApproveHandled(true)
    doCallPay(pendingPayArgs.parsedAmount, pendingPayArgs.orderId)
  }

  const wrongChain = isConnected && chainId !== CHAIN_ID

  const handlePay = () => {
    setError(null)
    if (SPLIT_IS_PLACEHOLDER) {
      setError(`Auf ${NET.label} ist noch kein Split-Vertrag eingetragen. Zahlung gesperrt.`)
      return
    }
    if (wrongChain) {
      switchChain({ chainId: CHAIN_ID })
      return
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('Bitte Betrag eingeben.')
      return
    }

    let parsedAmount: bigint
    try {
      parsedAmount = parseAmount(CHAIN_ID, amount).raw
    } catch {
      setError('Ungültiger Betrag.')
      return
    }

    if (parsedAmount === 0n) {
      setError('Betrag muss größer als 0 sein.')
      return
    }

    if (NET.maxAmountUsdc !== null && parsedAmount > parseAmount(CHAIN_ID, NET.maxAmountUsdc).raw) {
      setError(`Höchstbetrag auf ${NET.label}: ${NET.maxAmountUsdc} USDC pro Zahlung.`)
      return
    }

    // Build a deterministic orderId from the ref or timestamp
    const refStr = orderRef.trim() || `zahlknopf-${Date.now()}`
    const encoder = new TextEncoder()
    const bytes = encoder.encode(refStr)
    const padded = new Uint8Array(32)
    padded.set(bytes.slice(0, 32))
    const orderId = ('0x' + Array.from(padded).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`

    // Reset state for fresh flow
    setPaySubmitted(false)
    setApproveHandled(false)
    setPendingPayArgs({ parsedAmount, orderId })
    setStep('approving')

    try {
      // Exakter Approve: genau der eingegebene Betrag, nie unbegrenzt (kein maxUint256).
      writeApprove({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [SPLIT_ADDRESS, parsedAmount],
        chainId: CHAIN_ID,
      })
    } catch (e) {
      setError(parseOnchainError(e))
      setStep('idle')
    }
  }

  const isLoading = isApprovePending || isApproveConfirming || isPayPending || isPayConfirming
  const decimals = usdcDecimalsFor(CHAIN_ID)

  const payTxUrl = payTxHash ? buildTxExplorerUrl(CHAIN_ID, payTxHash) : null

  const buttonLabel = () => {
    if (!isConnected) return 'Wallet verbinden'
    if (wrongChain) return `Zu ${NET.label} wechseln`
    if (step === 'approving' && isApprovePending) return 'Freigabe bestätigen…'
    if (step === 'approving' && isApproveConfirming) return 'Freigabe wird bestätigt…'
    if (step === 'paying' && isPayPending) return 'Zahlung bestätigen…'
    if (step === 'paying' && isPayConfirming) return 'Zahlung wird bestätigt…'
    if (SPLIT_IS_PLACEHOLDER) return 'Gesperrt: Vertrag fehlt'
    return IS_MAINNET ? 'Mit echtem USDC bezahlen' : 'Mit USDC bezahlen'
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3"
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-strong)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex size-7 items-center justify-center rounded-lg"
            style={{ background: 'var(--accent)' }}
          >
            <Split className="size-4 text-white" />
          </div>
          <span className="display text-base font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
            arc-zahlknopf
          </span>
        </div>
        <ConnectKitButton />
      </header>

      {/* Netzwerk-Hinweis */}
      {IS_MAINNET ? (
        <div
          role="alert"
          className="flex items-start gap-2 px-4 py-3 text-sm font-semibold"
          style={{ background: 'var(--danger)', color: '#fff' }}
        >
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>
            ARC MAINNET – ECHTES GELD. Zahlungen sind endgültig. Es wird genau der eingegebene Betrag freigegeben
            (kein unbegrenzter Approve), höchstens {NET.maxAmountUsdc} USDC pro Zahlung. Kein Audit.
            {SPLIT_IS_PLACEHOLDER && ' Split-Vertrag noch nicht deployt – Zahlungen sind gesperrt.'}
          </span>
        </div>
      ) : (
        <div className="px-4 py-2 text-xs text-center" style={{ background: 'rgba(18,45,69,0.06)', color: 'var(--ink-2)' }}>
          Demo auf Arc Testnet – kein echtes Geld.
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex items-start justify-center px-4 pt-8 pb-16">
        <div className="w-full max-w-md flex flex-col gap-4">

          {/* Recipients card */}
          <section style={glass.card} className="overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                Aufteilung
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--subtle)' }}>
                Jede Zahlung wird sofort und direkt verteilt.
              </p>
            </div>
            <div>
              {SPLIT_IS_PLACEHOLDER
                ? (
                  <div className="px-5 py-4 text-sm" style={{ color: 'var(--danger)' }}>
                    Platzhalter: Split-Vertrag auf {NET.label} noch nicht deployt.
                  </div>
                )
                : recipients && shares
                ? (recipients as Address[]).map((addr, i) => (
                    <RecipientRow
                      key={addr}
                      addr={addr}
                      bps={Number((shares)[i])}
                      index={i}
                    />
                  ))
                : (
                  <div className="px-5 py-4 flex items-center gap-2" style={{ color: 'var(--subtle)' }}>
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Lade Empfänger…</span>
                  </div>
                )}
            </div>
            <div className="px-5 pb-4 pt-2">
              <p className="text-xs mono" style={{ color: 'var(--subtle)' }}>
                Vertrag:{' '}
                <a
                  href={`${NET.explorerBase}/address/${SPLIT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                  style={{ color: 'var(--accent-hover)' }}
                >
                  {shortenAddr(SPLIT_ADDRESS)}
                  <ExternalLink className="size-3" />
                </a>
              </p>
            </div>
          </section>

          {/* Payment form */}
          {step !== 'done' ? (
            <section style={glass.card} className="p-5 flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                  Betrag (USDC)
                </p>
                <div style={glass.inner} className="p-4">
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
                    }}
                    placeholder="0.00"
                    disabled={isLoading}
                    className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-25 disabled:opacity-50"
                    style={{ color: 'var(--ink)' }}
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
                    {address && (
                      <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                        {NET.label} · {usdcDecimalsFor(CHAIN_ID) > 0 ? `${decimals} Dezimalstellen` : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                  Bestellreferenz <span className="font-normal normal-case" style={{ color: 'var(--subtle)' }}>(optional)</span>
                </p>
                <input
                  type="text"
                  value={orderRef}
                  onChange={(e) => setOrderRef(e.target.value)}
                  placeholder="z. B. Rechnung-2024-001"
                  disabled={isLoading}
                  className="w-full px-4 py-3 rounded-2xl text-sm outline-none placeholder:opacity-40 disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.55)',
                    border: '1px solid rgba(18,45,69,0.08)',
                    color: 'var(--ink)',
                  }}
                />
              </div>

              {/* Preview rows */}
              {amount && parseFloat(amount) > 0 && recipients && shares && (
                <div style={{ ...glass.inner, padding: '12px 16px' }} className="flex flex-col gap-2">
                  <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Vorschau der Aufteilung</p>
                  {(recipients as Address[]).map((addr, i) => {
                    const bps = Number((shares)[i])
                    let partStr = '—'
                    try {
                      const parsedAmt = parseAmount(CHAIN_ID, amount)
                      const dec = usdcDecimalsFor(CHAIN_ID)
                      const isLast = i === (recipients as Address[]).length - 1
                      if (!isLast) {
                        const part = (parsedAmt.raw * BigInt(bps)) / 10000n
                        partStr = formatAmount(CHAIN_ID, Amount.fromRaw(part, dec))
                      } else {
                        let distributed = 0n
                        for (let j = 0; j < i; j++) {
                          const b = Number((shares)[j])
                          distributed += (parsedAmt.raw * BigInt(b)) / 10000n
                        }
                        partStr = formatAmount(CHAIN_ID, Amount.fromRaw(parsedAmt.raw - distributed, dec))
                      }
                    } catch { /* ignore */ }
                    return (
                      <div key={addr} className="flex items-center justify-between">
                        <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>{shortenAddr(addr)}</span>
                        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
                          {partStr} USDC
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Error */}
              {error && (
                <div
                  className="flex items-start gap-2 px-4 py-3 rounded-2xl text-sm"
                  style={{ background: 'rgba(186,43,76,0.07)', color: 'var(--danger)' }}
                >
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Step indicator */}
              {isLoading && (
                <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl" style={{ background: 'rgba(18,45,69,0.04)' }}>
                  <div className="flex items-center gap-2 text-sm" style={{ color: (step === 'approving' && (isApprovePending || isApproveConfirming)) ? 'var(--accent)' : 'var(--subtle)' }}>
                    {step === 'approving' && (isApprovePending || isApproveConfirming)
                      ? <Loader2 className="size-4 animate-spin" />
                      : <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />}
                    <span>Schritt 1: USDC freigeben</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm" style={{ color: step === 'paying' ? 'var(--accent)' : 'var(--subtle)' }}>
                    {step === 'paying'
                      ? <Loader2 className="size-4 animate-spin" />
                      : <div className="size-4 rounded-full border-2 shrink-0" style={{ borderColor: 'var(--border-strong)' }} />}
                    <span>Schritt 2: Zahlung durchführen</span>
                  </div>
                </div>
              )}

              {/* CTA */}
              <button
                disabled={isLoading || SPLIT_IS_PLACEHOLDER}
                onClick={handlePay}
                className="w-full rounded-2xl py-4 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {buttonLabel()}
                  </span>
                ) : (
                  buttonLabel()
                )}
              </button>
            </section>
          ) : (
            /* Success receipt */
            <section style={glass.card} className="p-6 flex flex-col items-center gap-4 text-center">
              <div
                className="flex size-14 items-center justify-center rounded-full"
                style={{ background: 'rgba(26,128,71,0.10)' }}
              >
                <CheckCircle2 className="size-7" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <p className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Zahlung erfolgreich</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--subtle)' }}>
                  {amount} USDC wurden aufgeteilt und direkt überwiesen.
                </p>
              </div>
              {payTxUrl && (
                <a
                  href={payTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{ background: 'rgba(18,45,69,0.07)', color: 'var(--ink-2)' }}
                >
                  Transaktion ansehen
                  <ExternalLink className="size-3.5" />
                </a>
              )}
              <button
                onClick={() => {
                  setStep('idle')
                  setAmount('')
                  setOrderRef('')
                  setError(null)
                  setPayTxHash(undefined)
                  setPaySubmitted(false)
                  setApproveHandled(false)
                  setPendingPayArgs(null)
                }}
                className="text-sm font-semibold"
                style={{ color: 'var(--accent-hover)' }}
              >
                Neue Zahlung
              </button>
            </section>
          )}

          {/* Info note */}
          <p className="text-xs text-center px-4" style={{ color: 'var(--subtle)' }}>
            Der Vertrag hält kein Guthaben. Jede Zahlung wird im selben Block direkt an alle Empfänger weitergeleitet.
          </p>
        </div>
      </main>
    </div>
  )
}
