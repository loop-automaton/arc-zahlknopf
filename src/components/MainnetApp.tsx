/**
 * arc-zahlknopf – Mainnet-UI (nur im Build `bun run build:mainnet`).
 *
 * Ablauf, jeder Schritt einzeln und mit Vorschau VOR der Signatur:
 *   1. Deploy: fester Init-Code (Empfänger fest eingebaut, kein Eingabefeld) als Contract-Erstellung.
 *   2. Adresse aus dem Receipt lesen, on-chain prüfen (Code, recipients, shares, usdc), lokal speichern.
 *   3. Exakter approve(Split, Betrag) – nie unbegrenzt.
 *   4. pay(Betrag, orderId) – höchstens 3 USDC.
 *
 * Signiert wird ausschließlich im injizierten EIP-1193-Wallet (window.ethereum, z. B. MetaMask-In-App-Browser).
 * Keine Keys, keine Seeds, nichts wird automatisch ausgelöst.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getContractAddress,
  isAddress,
  isAddressEqual,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from 'viem'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, ShieldAlert } from 'lucide-react'
import { NET, SPLIT_IS_PLACEHOLDER, arcMainnet } from '@/network'
import {
  EXPECTED_ADDRESS_NONCE0,
  EXPECTED_DEPLOYER,
  EXPECTED_RECIPIENTS,
  EXPECTED_SHARES,
  INIT_CODE,
  INIT_CODE_HASH,
  MAINNET_CHAIN_ID,
  MAX_AMOUNT_RAW,
  USDC_ADDRESS,
} from '@/mainnet-deploy'
import { verifySplit } from '@/mainnet-verify'

const CHAIN_HEX = '0x13b2' // 5042
const STORAGE_KEY = 'arc-zahlknopf:mainnet:split'
const EXPLORER = 'https://explorer.arc.io'

const PAY_ABI = [
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

// Selbstprüfung beim Laden: Konstante und Hash müssen zusammenpassen.
const INIT_CODE_SELF_CHECK = keccak256(INIT_CODE) === INIT_CODE_HASH

// ---------------------------------------------------------------------------
// EIP-1193 (window.ethereum) – nur für Chain-Abfrage und Netzwechsel
// ---------------------------------------------------------------------------
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}
function injectedProvider(): Eip1193 | undefined {
  return (window as unknown as { ethereum?: Eip1193 }).ethereum
}

async function walletChainId(): Promise<number | null> {
  const eth = injectedProvider()
  if (!eth) return null
  const id = (await eth.request({ method: 'eth_chainId' })) as string
  return Number.parseInt(id, 16)
}

/** Wechselt auf Arc Mainnet; falls unbekannt, mit den offiziellen Daten hinzufügen (docs.arc.io). */
async function switchToArc(): Promise<void> {
  const eth = injectedProvider()
  if (!eth) throw new Error('Kein Wallet gefunden (window.ethereum). Seite im MetaMask-Browser öffnen.')
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] })
  } catch (err) {
    const code = (err as { code?: number; data?: { originalError?: { code?: number } } })?.code
    const inner = (err as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code
    if (code !== 4902 && inner !== 4902) throw err
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: 'Arc',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: ['https://rpc.mainnet.arc.io'],
          blockExplorerUrls: [EXPLORER],
        },
      ],
    })
  }
}

// ---------------------------------------------------------------------------
// Lokaler Speicher (nur Adresse + Deploy-Tx, keine Secrets)
// ---------------------------------------------------------------------------
interface Stored {
  address?: Address
  deployTx?: Hex
}
function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const v = JSON.parse(raw) as Stored
    return {
      address: v.address && isAddress(v.address) ? v.address : undefined,
      deployTx: v.deployTx && /^0x[0-9a-fA-F]{64}$/.test(v.deployTx) ? v.deployTx : undefined,
    }
  } catch {
    return {}
  }
}
function saveStored(s: Stored) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// ---------------------------------------------------------------------------
// UI-Bausteine
// ---------------------------------------------------------------------------
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(18,45,69,0.12)',
  borderRadius: '20px',
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</span>
        <button onClick={() => void copy()} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>
          <Copy className="size-3" /> {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      <textarea
        readOnly
        value={value}
        rows={value.length > 200 ? 5 : 2}
        className="mono w-full rounded-xl p-2 text-[11px] break-all"
        style={{ background: 'rgba(18,45,69,0.05)', border: '1px solid rgba(18,45,69,0.10)', color: 'var(--ink-2)' }}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  )
}

interface Preview {
  title: string
  to: string
  amount: string
  data: Hex
  extra?: { label: string; value: string }[]
}

function TxPreview({ p }: { p: Preview }) {
  const summary = [
    `${p.title}`,
    `Chain-ID: ${MAINNET_CHAIN_ID} (Arc Mainnet)`,
    `Ziel: ${p.to}`,
    `Betrag: ${p.amount}`,
    ...(p.extra ?? []).map((e) => `${e.label}: ${e.value}`),
    `Calldaten: ${p.data}`,
  ].join('\n')
  return (
    <div className="flex flex-col gap-2 rounded-2xl p-3" style={{ background: 'rgba(186,43,76,0.05)', border: '1px solid rgba(186,43,76,0.25)' }}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--danger)' }}>
        Vorschau vor der Signatur – an Grok schicken, auf OK warten
      </p>
      <table className="text-xs w-full" style={{ color: 'var(--ink-2)' }}>
        <tbody>
          <tr><td className="pr-2 font-semibold align-top">Chain-ID</td><td className="mono">{MAINNET_CHAIN_ID} (Arc Mainnet)</td></tr>
          <tr><td className="pr-2 font-semibold align-top">Ziel</td><td className="mono break-all">{p.to}</td></tr>
          <tr><td className="pr-2 font-semibold align-top">Betrag</td><td className="mono">{p.amount}</td></tr>
          {(p.extra ?? []).map((e) => (
            <tr key={e.label}><td className="pr-2 font-semibold align-top">{e.label}</td><td className="mono break-all">{e.value}</td></tr>
          ))}
        </tbody>
      </table>
      <CopyBox label={`Calldaten (${(p.data.length - 2) / 2} Bytes)`} value={p.data} />
      <CopyBox label="Alles zusammen (für Grok)" value={summary} />
    </div>
  )
}

function TxLink({ hash }: { hash?: Hex }) {
  if (!hash) return null
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline mono" style={{ color: 'var(--accent-hover)' }}>
      Tx {short(hash)} <ExternalLink className="size-3" />
    </a>
  )
}

// ---------------------------------------------------------------------------
// Haupt-Komponente
// ---------------------------------------------------------------------------
export default function MainnetApp() {
  const { address: account, isConnected, chainId } = useAccount()
  const client = usePublicClient({ chainId: MAINNET_CHAIN_ID })
  const { sendTransactionAsync } = useSendTransaction()

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // --- Deploy-Receipt (falls ein Deploy gesendet, aber noch keine Adresse gespeichert ist) ---
  const [stored, setStored] = useState<Stored>(() => loadStored())
  const deployReceipt = useWaitForTransactionReceipt({ hash: stored.address ? undefined : stored.deployTx, chainId: MAINNET_CHAIN_ID })
  const receiptAddress =
    deployReceipt.data?.status === 'success' ? (deployReceipt.data.contractAddress ?? undefined) : undefined
  const deployFailed = !!deployReceipt.data && deployReceipt.data.status !== 'success'
  useEffect(() => {
    // nur externer Speicher, kein React-State
    if (receiptAddress && !stored.address) saveStored({ ...stored, address: receiptAddress })
  }, [receiptAddress, stored])

  // --- Split-Adresse: fest eingetragen > lokal gespeichert > aus Receipt; immer on-chain geprüft ---
  const candidate: Address | undefined = !SPLIT_IS_PLACEHOLDER ? NET.splitAddress : (stored.address ?? receiptAddress)
  const verifyQ = useQuery({
    queryKey: ['verify-split', candidate],
    queryFn: async () => {
      try {
        return await verifySplit(client!, candidate!)
      } catch (e) {
        return { ok: false, checks: [{ label: 'Prüfung', ok: false, detail: (e as Error).message }] }
      }
    },
    enabled: !!client && !!candidate,
  })
  const verify = verifyQ.data ?? null
  const verifying = verifyQ.isFetching
  const verifiedSplit: Address | undefined = verify?.ok && candidate ? candidate : undefined

  // --- Nonce → vorab berechnete Adresse ---
  const nonceQ = useQuery({
    queryKey: ['nonce', account, stored.deployTx],
    queryFn: () => client!.getTransactionCount({ address: account! }),
    enabled: !!client && !!account,
  })
  const nonce = nonceQ.data ?? null
  const predicted = account && nonce !== null ? getContractAddress({ from: account, nonce: BigInt(nonce) }) : undefined

  // --- Betrag / orderId ---
  const [amountStr, setAmountStr] = useState('1')
  const [orderRef, setOrderRef] = useState('loop-mainnet-test-1')
  const amount = useMemo(() => {
    try {
      const v = parseUnits(amountStr.trim(), 6)
      return v > 0n && v <= MAX_AMOUNT_RAW ? v : null
    } catch {
      return null
    }
  }, [amountStr])
  const orderId = useMemo<Hex | null>(() => {
    const ref = orderRef.trim()
    if (!ref || new TextEncoder().encode(ref).length > 32) return null
    return stringToHex(ref, { size: 32 })
  }, [orderRef])

  // --- Allowance / Saldo (neu lesen nach jeder bestätigten Tx) ---
  const [approveTx, setApproveTx] = useState<Hex | undefined>()
  const [payTx, setPayTx] = useState<Hex | undefined>()
  const approveReceipt = useWaitForTransactionReceipt({ hash: approveTx, chainId: MAINNET_CHAIN_ID })
  const payReceipt = useWaitForTransactionReceipt({ hash: payTx, chainId: MAINNET_CHAIN_ID })
  const tokenQ = useQuery({
    queryKey: ['token', account, verifiedSplit, approveReceipt.data?.transactionHash, payReceipt.data?.transactionHash],
    queryFn: async () => {
      const [b, a] = await Promise.all([
        client!.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account!] }),
        verifiedSplit
          ? client!.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [account!, verifiedSplit] })
          : Promise.resolve(null),
      ])
      return { balance: b, allowance: a }
    },
    enabled: !!client && !!account,
  })
  const balance = tokenQ.data?.balance ?? null
  const allowance = tokenQ.data?.allowance ?? null

  // --- Calldaten ---
  const approveData = verifiedSplit && amount
    ? encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [verifiedSplit, amount] })
    : null
  const payData = amount && orderId
    ? encodeFunctionData({ abi: PAY_ABI, functionName: 'pay', args: [amount, orderId] })
    : null

  // --- Signieren (immer erst Chain prüfen) ---
  const onArc = isConnected && chainId === MAINNET_CHAIN_ID
  async function guardedSend(params: { to?: Address; data: Hex }): Promise<Hex | null> {
    setError(null)
    const id = await walletChainId()
    if (id !== MAINNET_CHAIN_ID) {
      setError(`Wallet ist auf Chain ${id ?? '–'}, nicht ${MAINNET_CHAIN_ID}. Erst wechseln.`)
      return null
    }
    setBusy(true)
    try {
      return await sendTransactionAsync({ ...params, value: 0n, chainId: arcMainnet.id })
    } catch (e) {
      const msg = (e as Error).message ?? ''
      setError(/reject|denied/i.test(msg) ? 'Signatur abgelehnt.' : `Fehler: ${msg.split('\n')[0]}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function doDeploy() {
    if (!INIT_CODE_SELF_CHECK) return setError('Init-Code-Selbstprüfung fehlgeschlagen – Abbruch.')
    const hash = await guardedSend({ data: INIT_CODE })
    if (hash) {
      const next: Stored = { deployTx: hash }
      saveStored(next)
      setStored(next)
    }
  }
  async function doApprove() {
    if (!approveData) return
    const hash = await guardedSend({ to: USDC_ADDRESS, data: approveData })
    if (hash) setApproveTx(hash)
  }
  async function doPay() {
    if (!payData || !verifiedSplit) return
    if (allowance === null || amount === null || allowance < amount) return setError('Freigabe (Allowance) reicht nicht – erst approve.')
    const hash = await guardedSend({ to: verifiedSplit, data: payData })
    if (hash) setPayTx(hash)
  }
  function forgetStored() {
    localStorage.removeItem(STORAGE_KEY)
    setStored({})
  }

  const deviatesFromNonce0 = !!verifiedSplit && !isAddressEqual(verifiedSplit, EXPECTED_ADDRESS_NONCE0)
  const predictedDeviates = !!predicted && !isAddressEqual(predicted, EXPECTED_ADDRESS_NONCE0)
  const wrongDeployer = !!account && !isAddressEqual(account, EXPECTED_DEPLOYER)

  const btn = 'w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      <header className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-strong)' }}>
        <span className="display text-base font-bold" style={{ color: 'var(--ink)' }}>arc-zahlknopf · Mainnet</span>
        <ConnectKitButton />
      </header>

      <div role="alert" className="flex items-start gap-2 px-4 py-3 text-sm font-semibold" style={{ background: 'var(--danger)', color: '#fff' }}>
        <AlertTriangle className="size-4 mt-0.5 shrink-0" />
        <span>
          ARC MAINNET – ECHTES GELD. Jede Transaktion ist endgültig. Exakter Approve (nie unbegrenzt), höchstens 3 USDC pro
          Zahlung. Kein Audit. Vor jeder Signatur die Vorschau an Grok schicken.
        </span>
      </div>

      <main className="flex-1 flex justify-center px-4 pt-6 pb-16">
        <div className="w-full max-w-md flex flex-col gap-4">
          {!INIT_CODE_SELF_CHECK && (
            <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>Init-Code passt nicht zum Hash – nichts signieren!</p>
          )}

          {/* Netzwerk */}
          <section style={card} className="p-4 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Netzwerk</p>
            {!isConnected ? (
              <p className="text-sm">Wallet verbinden (MetaMask-In-App-Browser).</p>
            ) : onArc ? (
              <p className="text-sm flex items-center gap-1" style={{ color: 'var(--success)' }}>
                <CheckCircle2 className="size-4" /> Arc Mainnet, Chain-ID {MAINNET_CHAIN_ID} · Konto <span className="mono">{short(account!)}</span>
              </p>
            ) : (
              <>
                <p className="text-sm" style={{ color: 'var(--danger)' }}>Falsche Chain ({chainId}). Erwartet: {MAINNET_CHAIN_ID}. Signieren gesperrt.</p>
                <button className={btn} style={{ background: 'var(--accent)' }} onClick={() => { switchToArc().catch((e: Error) => setError(e.message)) }}>
                  Zu Arc (5042) wechseln / hinzufügen
                </button>
                <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                  Daten: Name „Arc“, RPC https://rpc.mainnet.arc.io, Chain-ID 5042, Symbol USDC, Explorer https://explorer.arc.io
                </p>
              </>
            )}
            {isConnected && balance !== null && (
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>USDC-Saldo: {formatUnits(balance, 6)} USDC</p>
            )}
          </section>

          {/* Schritt 1: Deploy */}
          <section style={card} className="p-4 flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Schritt 1 · Contract deployen</p>
            <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
              Fest eingebaut: Empfänger {EXPECTED_RECIPIENTS.map((r) => <span key={r} className="mono">{r}</span>)} mit{' '}
              {EXPECTED_SHARES.map((s) => s / 100).join(' / ')} % · USDC <span className="mono">{short(USDC_ADDRESS)}</span>
            </p>
            <CopyBox label="Init-Code-Hash (keccak256)" value={INIT_CODE_HASH} />

            {candidate ? (
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                Contract bereits vorhanden ({SPLIT_IS_PLACEHOLDER ? 'lokal gespeichert' : 'fest eingetragen'}) – kein neuer Deploy nötig.
              </p>
            ) : stored.deployTx ? (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" /> Warte auf Bestätigung des Deploys… <TxLink hash={stored.deployTx} />
              </div>
            ) : (
              <>
                {wrongDeployer && (
                  <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                    Achtung: Verbundenes Konto ist nicht {short(EXPECTED_DEPLOYER)}. Abbrechen und Grok fragen.
                  </p>
                )}
                {predicted && (
                  <p className="text-xs" style={{ color: predictedDeviates ? 'var(--danger)' : 'var(--ink-2)' }}>
                    Nonce {nonce} → erwartete Contract-Adresse <span className="mono">{predicted}</span>
                    {predictedDeviates && ` – WEICHT AB von ${short(EXPECTED_ADDRESS_NONCE0)} (Nonce 0). Grok informieren.`}
                  </p>
                )}
                <TxPreview
                  p={{
                    title: 'Deploy ZahlknopfSplit',
                    to: 'Contract-Erstellung (kein Empfänger)',
                    amount: '0 USDC',
                    data: INIT_CODE,
                    extra: [
                      { label: 'Init-Code-Hash', value: INIT_CODE_HASH },
                      { label: 'Erwartete Adresse', value: predicted ?? EXPECTED_ADDRESS_NONCE0 },
                    ],
                  }}
                />
                <button className={btn} style={{ background: 'var(--danger)' }} disabled={!onArc || busy || !INIT_CODE_SELF_CHECK} onClick={() => void doDeploy()}>
                  {busy ? 'In MetaMask bestätigen…' : 'Deploy in MetaMask signieren (erst nach Groks OK)'}
                </button>
              </>
            )}
          </section>

          {/* Prüfung */}
          {candidate && (
            <section style={card} className="p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Contract-Prüfung</p>
              <p className="text-xs mono break-all">
                <a href={`${EXPLORER}/address/${candidate}`} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent-hover)' }}>{candidate}</a>
              </p>
              {verifying && <p className="text-xs flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> prüfe on-chain…</p>}
              {verify?.checks.map((c) => (
                <p key={c.label} className="text-xs" style={{ color: c.ok ? 'var(--success)' : 'var(--danger)' }}>
                  {c.ok ? '✓' : '✗'} {c.label}: <span className="mono break-all">{c.detail}</span>
                </p>
              ))}
              {verify && !verify.ok && (
                <p className="text-sm font-bold flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                  <ShieldAlert className="size-4" /> Prüfung fehlgeschlagen – Zahlung gesperrt. Grok informieren.
                </p>
              )}
              {deviatesFromNonce0 && (
                <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                  Warnung: Adresse weicht von der vorab berechneten {EXPECTED_ADDRESS_NONCE0} ab. Approve nutzt die tatsächliche Adresse oben.
                </p>
              )}
              {SPLIT_IS_PLACEHOLDER && (
                <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                  Adresse ist nur lokal gespeichert. Sie wird später per Commit fest eingetragen.{' '}
                  <button className="underline" onClick={forgetStored}>Lokale Adresse vergessen</button>
                </p>
              )}
            </section>
          )}

          {/* Schritt 2 + 3 */}
          <section style={card} className="p-4 flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Schritt 2 · Exakter Approve · Schritt 3 · Zahlung</p>
            {!verifiedSplit ? (
              <p className="text-sm" style={{ color: 'var(--danger)' }}>Gesperrt: kein geprüfter Contract.</p>
            ) : (
              <>
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Betrag (USDC, max. 3)
                  <input value={amountStr} inputMode="decimal" onChange={(e) => setAmountStr(e.target.value.replace(',', '.'))}
                    className="mt-1 w-full rounded-xl px-3 py-2 text-sm mono" style={{ border: '1px solid var(--border)' }} />
                </label>
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Bestellreferenz (max. 32 Zeichen)
                  <input value={orderRef} onChange={(e) => setOrderRef(e.target.value)}
                    className="mt-1 w-full rounded-xl px-3 py-2 text-sm mono" style={{ border: '1px solid var(--border)' }} />
                </label>
                {amount === null && <p className="text-xs" style={{ color: 'var(--danger)' }}>Betrag muss &gt; 0 und ≤ 3 USDC sein.</p>}
                {orderId === null && <p className="text-xs" style={{ color: 'var(--danger)' }}>Referenz fehlt oder ist länger als 32 Bytes.</p>}
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Aktuelle Freigabe: {allowance === null ? '–' : `${formatUnits(allowance, 6)} USDC`}
                </p>

                {approveData && amount !== null && (
                  <>
                    <TxPreview
                      p={{
                        title: 'approve (exakt)',
                        to: `USDC ${USDC_ADDRESS}`,
                        amount: '0 USDC (native)',
                        data: approveData,
                        extra: [
                          { label: 'Spender', value: verifiedSplit },
                          { label: 'Freigabe', value: `${formatUnits(amount, 6)} USDC (${amount} Einheiten) – exakt` },
                        ],
                      }}
                    />
                    <button className={btn} style={{ background: 'var(--accent)' }} disabled={!onArc || busy || approveReceipt.isLoading} onClick={() => void doApprove()}>
                      Approve in MetaMask signieren (erst nach Groks OK)
                    </button>
                    <TxLink hash={approveTx} />
                  </>
                )}

                {payData && amount !== null && orderId && (
                  <>
                    <TxPreview
                      p={{
                        title: 'pay',
                        to: `ZahlknopfSplit ${verifiedSplit}`,
                        amount: `${formatUnits(amount, 6)} USDC (100 % an ${short(EXPECTED_RECIPIENTS[0])})`,
                        data: payData,
                        extra: [{ label: 'orderId', value: orderId }],
                      }}
                    />
                    <button className={btn} style={{ background: 'var(--accent)' }}
                      disabled={!onArc || busy || allowance === null || allowance < amount || payReceipt.isLoading} onClick={() => void doPay()}>
                      Zahlung in MetaMask signieren (erst nach Groks OK)
                    </button>
                    {allowance !== null && allowance < amount && (
                      <p className="text-xs" style={{ color: 'var(--subtle)' }}>Erst Approve bestätigen.</p>
                    )}
                    <TxLink hash={payTx} />
                    {payReceipt.data?.status === 'success' && (
                      <p className="text-sm flex items-center gap-1" style={{ color: 'var(--success)' }}><CheckCircle2 className="size-4" /> Zahlung bestätigt.</p>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          {deployFailed && (
            <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>Deploy-Transaktion fehlgeschlagen (Receipt-Status ≠ success). Grok informieren.</p>
          )}
          {error && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-2xl text-sm" style={{ background: 'rgba(186,43,76,0.07)', color: 'var(--danger)' }}>
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
