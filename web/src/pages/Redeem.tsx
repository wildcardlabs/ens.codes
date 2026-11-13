import { BudgetTooLowError, InvalidLabelError, NotRenewableError, type Quote, quoteRenewal } from 'ens-budget'
import { Check, ClipboardPaste, Copy, ExternalLink, HeartHandshake, Loader2, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { normalize } from 'viem/ens'
import type { Go } from '@/App'
import { CodeTicket } from '@/components/ds/CodeTicket'
import { ActionButton, Eyebrow, Field, FieldLabel, Hint, PageTitle, Rows, SPLIT_COLORS, SplitBar } from '@/components/ds/primitives'
import { Bean } from '@/components/ds/stickers'
import { Button } from '@/components/ui/button'
import { walletStep, WalletChoices } from '@/components/wallet'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { clean, format, parse, redeemLink } from '@/lib/code'
import { EXPLORER_URL, MAX_NAMES, publicClient, RENEWERS, USDC } from '@/lib/config'
import { cleanAmount, fmtBalance, fmtDateSecs, fmtDurationPrecise, fmtUsdcExact, parseUsdc, toInput } from '@/lib/format'
import { cn } from '@/lib/utils'
import { celebrate } from '@/lib/celebrate'
import { errorMessage } from '@/lib/util'
import { type Claim, findCode, outcomeOf, redeem, redeemRelayed, RelayError, relayerAddress, type Redemption } from '@/lib/vault'
import { sameAccount, useWallet } from '@/lib/wallet'

/** The typed code on the ticket: typed characters, then X for the rest. */
const preview = (input: string) => format((clean(input) + 'X'.repeat(25)).slice(0, 25))

const CENT = 10_000n
/**
 * Side by side on wide screens. The ticket keeps its own height and stays put; the panel beside it
 * starts at least that tall, so the two line up before anything is typed, and the panel alone grows
 * as names are added.
 */
const COLUMNS = 'grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14'

type Outcome = Awaited<ReturnType<typeof outcomeOf>>
/** A code found onchain. `state.amount` is its value while unused and 0 once redeemed or cancelled. */
type Loaded = { claim: Claim; state: { amount: bigint }; code: string; outcome: Outcome }
type Success = { items: { label: string; duration: bigint; amount: bigint }[]; spent: bigint; refunded: bigint; hash: string }

export default function Redeem({ go, initialCode }: { go: Go; initialCode?: string }) {
  const [codeInput, setCodeInput] = useState(initialCode ?? '')
  const [checking, setChecking] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [success, setSuccess] = useState<Success | null>(null)

  const parsed = parse(codeInput)

  async function apply(input = codeInput) {
    const parsed = parse(input)
    if (!parsed.ok) return
    setChecking(true)
    setCodeError(null)
    try {
      const claim = await findCode(input)
      if (!claim) return setCodeError('Code not found. Check it and try again.')
      setLoaded({ claim, state: { amount: claim.used ? 0n : claim.amount }, code: claim.code, outcome: claim.used ? await outcomeOf(claim) : null })
    } catch (err) {
      setCodeError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  // A code from a redeem link: apply it right away.
  useEffect(() => {
    if (initialCode) void apply(initialCode)
    // Runs once per mount; the page remounts for each new code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unused = !!loaded && loaded.state.amount > 0n && !success
  // What the code was worth: its amount while unused, and what it paid out once redeemed.
  const redeemed = loaded?.outcome?.kind === 'redeemed' ? loaded.outcome.redemption : null
  const value = loaded && loaded.state.amount > 0n ? loaded.state.amount : redeemed ? redeemed.spent + redeemed.refunded : null
  const ticket = (
    <CodeTicket
      tall
      amount={loaded ? value : null}
      code={loaded ? loaded.code : codeInput ? preview(codeInput) : null}
      qr={unused && loaded ? redeemLink(loaded.code) : undefined}
      stamp={loaded && !unused ? (loaded.outcome?.kind === 'cancelled' ? 'Cancelled' : 'Claimed') : undefined}
    />
  )

  return (
    <>
      <PageTitle title="Redeem a claim code." />
      <div className={COLUMNS}>
        <div className="flex min-w-0 flex-col">
          {success && loaded ? (
            <Renewed s={success} go={go} />
          ) : !loaded ? (
            <>
              <section className="panel flex flex-col justify-center p-5 sm:p-6 lg:flex-1">
                <FieldLabel htmlFor="code">Claim code</FieldLabel>
                <Field className="mt-2" invalid={!parsed.ok && !parsed.incomplete}>
                  <input
                    id="code"
                    className="t-code text-center text-[14px] uppercase sm:text-[16px]"
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={29}
                    value={codeInput}
                    onChange={(e) => {
                      const next = format(e.target.value)
                      setCodeInput(next)
                      setCodeError(null)
                      if (parse(next).ok) void apply(next)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && parsed.ok && void apply()}
                  />
                  {!codeInput && 'clipboard' in navigator && 'readText' in navigator.clipboard && (
                    <Button
                      variant="soft"
                      size="sm"
                      onClick={async () => {
                        try {
                          const next = format(await navigator.clipboard.readText())
                          setCodeInput(next)
                          setCodeError(null)
                          if (parse(next).ok) void apply(next)
                        } catch {
                          setCodeError('Paste into the box instead.')
                        }
                      }}
                    >
                      <ClipboardPaste aria-hidden="true" /> Paste
                    </Button>
                  )}
                </Field>
                <p className="mt-1.5 min-h-5 text-[13px] text-red">{codeError ?? (codeInput && !parsed.ok && !parsed.incomplete ? parsed.error : null)}</p>
                <ActionButton label={checking ? 'Checking…' : 'Continue'} busy={checking} action={parsed.ok && !checking ? () => void apply() : undefined} className="mt-3" />
              </section>
            </>
          ) : (
            <>
              <CodeSummary loaded={loaded} />
              {loaded.state.amount > 0n && <Spend loaded={loaded} onDone={setSuccess} onGone={() => void apply(loaded.code)} />}
            </>
          )}
        </div>
        {/* Phones: the ticket leads, so the code and its value are the first thing on the page. After a
            redemption it drops below the result. */}
        <aside className={cn('lg:sticky lg:top-28 lg:self-start', !success && 'max-lg:order-first')}>{ticket}</aside>
      </div>
    </>
  )
}

/** What happened to a code once it is used. An unused code needs no summary: the ticket shows it. */
function CodeSummary({ loaded }: { loaded: Loaded }) {
  const { state, outcome } = loaded
  if (state.amount > 0n) return null
  return (
    <section className="panel p-5 text-[15px] leading-[22px] text-body sm:p-6">
      {outcome?.kind === 'cancelled' ? 'The buyer cancelled this code.' : outcome?.kind === 'redeemed' ? <UsedOn r={outcome.redemption} /> : 'This code has already been used.'}
    </section>
  )
}

function Names({ items }: { items: { label: string; duration: bigint }[] }) {
  return (
    <ul className="fragment grid gap-2 p-4 text-[15px]">
      {items.map((x, i) => (
        <li key={i} className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-medium text-foreground">{x.label}.eth</span>
          <span className="whitespace-nowrap text-caption">+ {fmtDurationPrecise(x.duration)}</span>
        </li>
      ))}
    </ul>
  )
}

/** A transaction: a link to the explorer, or its hash to copy where there is none. */
function Tx({ hash }: { hash: string }) {
  const { copied, copy } = useCopyFeedback()
  const cls = 'inline-flex items-center gap-1.5 text-[14px] font-medium t-link'
  return EXPLORER_URL ? (
    <a className={cls} href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">
      View transaction <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  ) : (
    <button type="button" className={cls} onClick={() => void copy(hash)} title={hash}>
      {copied === hash ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied === hash ? 'Copied' : `Transaction ${hash.slice(0, 10)}…${hash.slice(-6)}`}
    </button>
  )
}

function UsedOn({ r }: { r: Redemption }) {
  return (
    <>
      <p className="mb-3">This code was redeemed on {fmtDateSecs(r.at)}. It renewed:</p>
      <Names items={r.renewals} />
      <div className="mt-3">
        <Tx hash={r.tx} />
      </div>
    </>
  )
}

type Row = { id: number; name: string; /** Typed amount; null means "share what is left". */ input: string | null; /** When the amount was last typed. */ at: number }
type RowState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; quote: Quote } | { status: 'error'; error: string }

/** Keep at least one row sharing what is left, so the total stays the whole code: free up the amount typed longest ago. */
function keepOneOpen(rows: Row[], except?: number): Row[] {
  if (rows.some((r) => r.input === null)) return rows
  const oldest = rows.filter((r) => r.id !== except).sort((a, b) => a.at - b.at)[0]
  return oldest ? rows.map((r) => (r.id === oldest.id ? { ...r, input: null } : r)) : rows
}

/** A name as typed -> its normalized label, or why it can't be used. */
function readName(input: string): { label: string | null; issue: string | null } {
  const raw = input.trim().replace(/\.eth$/i, '')
  if (!raw) return { label: null, issue: null }
  if (raw.includes('.')) return { label: null, issue: 'Enter a .eth name without subdomains.' }
  try {
    return { label: normalize(raw), issue: null }
  } catch {
    return { label: null, issue: 'That isn’t a valid ENS name.' }
  }
}

/**
 * Split the code's value across the rows. Rows with a typed amount keep it; the others share what is
 * left equally, to the cent, and the last of them takes the remainder, so the total is always the
 * whole code. Returns null amounts when the typed amounts leave nothing to share.
 */
function split(value: bigint, rows: Row[]): { amounts: (bigint | null)[]; issue: string | null } {
  const typed = rows.map((r) => (r.input === null ? null : parseUsdc(r.input)))
  const none = { amounts: rows.map(() => null) }
  if (rows.some((r, i) => r.input !== null && (typed[i] === null || typed[i] === 0n))) return { ...none, issue: 'Enter an amount for each name.' }
  const fixed = typed.reduce<bigint>((sum, t) => sum + (t ?? 0n), 0n)
  const autos = typed.filter((t) => t === null).length
  const left = value - fixed
  const share = autos ? (left / BigInt(autos) / CENT) * CENT : 0n
  if (left <= 0n || share <= 0n) return { ...none, issue: `The amounts add up to more than the code’s ${fmtBalance(value)}.` }
  let seen = 0
  return { amounts: typed.map((t) => (t !== null ? t : ++seen === autos ? left - share * BigInt(autos - 1) : share)), issue: null }
}

function Spend({ loaded, onDone, onGone }: { loaded: Loaded; onDone: (s: Success) => void; onGone: () => void }) {
  const { connected, wallets } = useWallet()
  const value = loaded.state.amount
  const nextId = useRef(1)
  const clock = useRef(0)
  const [rows, setRows] = useState<Row[]>([{ id: 0, name: '', input: null, at: 0 }])
  const [states, setStates] = useState<Record<number, RowState>>({})
  const [stage, setStage] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // The site's relayer, when it can pay the network fee: then no wallet is needed at all.
  const [relayer, setRelayer] = useState<Address | null>(null)

  useEffect(() => {
    let live = true
    void relayerAddress().then((a) => live && setRelayer(a))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (connected) setChoosing(false)
  }, [connected])

  const report = useCallback((id: number, s: RowState) => setStates((prev) => ({ ...prev, [id]: s })), [])

  const names = rows.map((r) => readName(r.name))
  /** A name already listed in an earlier row. */
  const duplicate = names.map((n, i) => !!n.label && names.findIndex((m) => m.label === n.label) < i)
  const { amounts, issue: splitIssue } = split(value, rows)

  const setName = (id: number, name: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, name } : r)))
  /**
   * Typed amounts stay as typed; the names whose amount hasn't been typed share what is left. If every
   * amount has been typed, the one typed longest ago adjusts instead, so the total is always the code.
   */
  const setAmount = (index: number, text: string) =>
    setRows((rs) => keepOneOpen(rs.map((r, i) => (i === index ? { ...r, input: text, at: ++clock.current } : r)), rs[index].id))
  const add = () => setRows((rs) => [...rs, { id: nextId.current++, name: '', input: null, at: 0 }])
  const remove = (id: number) => setRows((rs) => keepOneOpen(rs.filter((r) => r.id !== id)))

  const quotes = rows.map((r, i) => {
    const s = states[r.id]
    return s?.status === 'ok' && !duplicate[i] && names[i].label === s.quote.label ? s.quote : null
  })
  const ready = quotes.every((q) => q !== null) && !splitIssue
  const spent = ready ? quotes.reduce<bigint>((sum, q) => sum + q!.amount, 0n) : null
  const loading = rows.some((r) => states[r.id]?.status === 'loading')

  async function renew() {
    if ((!relayer && !connected) || !ready || spent === null) return
    setNotice(null)
    try {
      setStage('Preparing…')
      if (!relayer && connected) await sameAccount(connected)
      const fresh = await findCode(loaded.code)
      if (!fresh || fresh.used) return onGone()
      const items = quotes.map((q) => ({ renewer: q!.renewer, label: q!.label, duration: q!.duration, amount: q!.amount }))
      // The vault makes one call per renewal contract, so names on the same one go together.
      const ordered = [...items].sort((a, b) => a.renewer.toLowerCase().localeCompare(b.renewer.toLowerCase()))
      const renewals = ordered.map(({ renewer, label, duration }) => ({ renewer, label, duration }))
      const hash = relayer ? await redeemRelayed(relayer, fresh, renewals, spent, setStage) : await redeem(connected!.client, connected!.address, fresh, renewals, spent, setStage)
      onDone({ items, spent, refunded: value - spent, hash })
    } catch (err) {
      // The relayer can't help right now (out of gas, network too busy): offer the wallet route.
      if (err instanceof RelayError && err.stepAside) setRelayer(null)
      setNotice(err instanceof RelayError && err.stepAside ? `${err.message} You can renew with a wallet instead.` : errorMessage(err))
    } finally {
      setStage(null)
    }
  }

  const button = ((): { label: string; action?: () => void; busy?: boolean } => {
    if (stage) return { label: stage, busy: true }
    if (names.some((n) => !n.label)) return { label: rows.length > 1 ? 'Enter every name' : 'Enter a name' }
    if (splitIssue) return { label: 'Check the amounts' }
    if (duplicate.some(Boolean)) return { label: 'Remove the repeated name' }
    if (rows.some((r) => states[r.id]?.status === 'error')) return { label: rows.length > 1 ? 'Fix the name that can’t be renewed' : 'Can’t renew this name' }
    if (!ready) return { label: 'Getting prices…', busy: loading }
    if (!relayer && !connected) return walletStep(wallets, setChoosing, setNotice)
    return { label: rows.length > 1 ? `Renew ${rows.length} names` : `Renew ${quotes[0]!.label}.eth`, action: () => void renew() }
  })()

  return (
    <section className="panel flex flex-col p-5 sm:p-6 lg:flex-1" aria-busy={!!stage}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>{rows.length > 1 ? 'Which names should it renew?' : 'Which name should it renew?'}</FieldLabel>
        {rows.length > 1 && <span className="shrink-0 whitespace-nowrap text-[13px] text-caption">Splitting {fmtBalance(value)}</span>}
      </div>

      {rows.length > 1 && !splitIssue && (
        <SplitBar
          legend={false}
          className="mt-3"
          segments={rows.map((r, i) => ({ key: String(r.id), label: names[i].label ?? `Name ${i + 1}`, value: Number(amounts[i] ?? 0n), color: SPLIT_COLORS[i % SPLIT_COLORS.length] }))}
        />
      )}

      {/* One column that may be narrower than its rows' natural width: a text field's natural width is
          about 20 characters, and a plain grid column refuses to go below that, which pushed the amount
          boxes out of the panel on a phone. */}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1">
        {rows.map((r, i) => (
          <NameRow
            color={rows.length > 1 ? SPLIT_COLORS[i % SPLIT_COLORS.length] : undefined}
            key={r.id}
            row={r}
            index={i}
            count={rows.length}
            label={names[i].label}
            issue={names[i].issue ?? (duplicate[i] ? 'This name is already in the list.' : null)}
            amount={amounts[i]}
            disabled={!!stage}
            onName={setName}
            onAmount={setAmount}
            onRemove={remove}
            onState={report}
            state={states[r.id]}
          />
        ))}
      </div>
      {splitIssue && rows.length > 1 && <p className="mt-1 text-[13px] text-red">{splitIssue}</p>}

      <div className="mt-1 flex items-center justify-between gap-3">
        {rows.length < MAX_NAMES ? (
          <Button variant="ghost" size="sm" className="-ml-3" disabled={!!stage} onClick={add}>
            <Plus aria-hidden="true" /> Add another name
          </Button>
        ) : (
          <span />
        )}
        <span className="text-[13px] text-caption">Up to {MAX_NAMES} names.</span>
      </div>

      {spent !== null && (
        <Rows
          className="fragment mt-4 p-4"
          rows={[
            ['Pays ENS', fmtUsdcExact(spent)],
            ...(value > spent
              ? ([
                  [
                    <span key="left" className="inline-flex items-center gap-1.5">
                      Left over
                      <Hint label="What happens to what’s left over" text="ENS prices by the second, so a little can be left over. It’s refunded to whoever bought the code." />
                    </span>,
                    fmtUsdcExact(value - spent),
                  ],
                ] as [React.ReactNode, React.ReactNode][])
              : []),
          ]}
        />
      )}

      {/* The action sits on the panel's bottom edge; any spare height goes above it. */}
      <div className="mt-auto">
        <ActionButton {...button} />
        {choosing && !connected && !relayer && <WalletChoices onError={setNotice} className="mt-3" />}
        {notice && (
          <p role="alert" className="mt-3 text-[13px] text-red">
            {notice}
          </p>
        )}
        {relayer ? (
          <p className="mt-4 flex items-start gap-2 text-[13px] leading-[18px] text-caption">
            <HeartHandshake className="size-[18px] shrink-0 text-green" aria-hidden="true" />
            <span>
              <span className="font-medium text-foreground">Nothing to pay.</span> We cover the fee.
            </span>
          </p>
        ) : (
          <p className="mt-4 text-[13px] text-caption">A code can be used once. You pay only the network fee.</p>
        )}
      </div>
    </section>
  )
}

/**
 * One name and its share of the code. Checks the name with ENS as it is typed (is it registered and
 * renewable, and how long does this amount add) and reports the result up.
 */
function NameRow({
  row,
  index,
  count,
  color,
  label,
  issue,
  amount,
  disabled,
  state,
  onName,
  onAmount,
  onRemove,
  onState,
}: {
  row: Row
  index: number
  count: number
  /** This name's colour in the split bar. */
  color?: string
  label: string | null
  issue: string | null
  amount: bigint | null
  disabled: boolean
  state: RowState | undefined
  onName: (id: number, name: string) => void
  onAmount: (index: number, text: string) => void
  onRemove: (id: number) => void
  onState: (id: number, s: RowState) => void
}) {
  const seq = useRef(0)
  const blocked = !!issue

  useEffect(() => {
    const mine = ++seq.current
    if (!label || blocked || amount === null) return onState(row.id, { status: 'idle' })
    onState(row.id, { status: 'loading' })
    const t = setTimeout(async () => {
      try {
        const quote = await quoteRenewal(publicClient, { label, budget: amount, token: USDC, renewers: RENEWERS })
        if (mine === seq.current) onState(row.id, { status: 'ok', quote })
      } catch (err) {
        if (mine !== seq.current) return
        onState(row.id, {
          status: 'error',
          error:
            err instanceof NotRenewableError
              ? `${label}.eth isn’t registered, or it’s past its grace period.`
              : err instanceof BudgetTooLowError
                ? 'That amount is too small to renew this name.'
                : err instanceof InvalidLabelError
                  ? 'ENS doesn’t sell names of that length.'
                  : errorMessage(err),
        })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [label, blocked, amount, row.id, onState])

  const error = issue ?? (state?.status === 'error' ? state.error : null)
  return (
    <div>
      <div className="flex items-center gap-2">
        <Field className="min-w-0 flex-1" invalid={!!error}>
          {color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
          <input
            aria-label={count > 1 ? `Name ${index + 1}` : 'Name to renew'}
            placeholder={index === 0 ? 'vitalik' : 'nick'}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={row.name}
            disabled={disabled}
            onChange={(e) => onName(row.id, e.target.value)}
          />
          <span className="text-caption">.eth</span>
        </Field>
        {count > 1 && (
          <>
            <Field className="w-[88px] shrink-0 gap-1 px-2.5 sm:w-[104px] sm:px-3.5" invalid={row.input !== null && !parseUsdc(row.input)}>
              <span className="text-caption">$</span>
              <input
                aria-label={`Amount for name ${index + 1}`}
                inputMode="decimal"
                autoComplete="off"
                value={row.input ?? (amount !== null ? toInput(amount) : '')}
                disabled={disabled}
                onChange={(e) => onAmount(index, cleanAmount(e.target.value))}
              />
            </Field>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove name ${index + 1}`} disabled={disabled} onClick={() => onRemove(row.id)}>
              <X aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
      <p className="mt-1 min-h-5 text-[13px]">
        {error ? (
          <span className="text-red">{error}</span>
        ) : state?.status === 'loading' ? (
          <span className="inline-flex items-center gap-1.5 text-caption">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Checking {label}.eth…
          </span>
        ) : state?.status === 'ok' && label === state.quote.label ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-green">
            <Check className="size-3.5 shrink-0" aria-hidden="true" />
            Adds {fmtDurationPrecise(state.quote.duration)}
          </span>
        ) : null}
      </p>
    </div>
  )
}

function Renewed({ s, go }: { s: Success; go: Go }) {
  useEffect(celebrate, [])
  const one = s.items.length === 1
  return (
    <section className="panel px-6 pb-7 pt-8 text-center sm:px-8">
      <Bean size={104} className="mx-auto" />
      <Eyebrow hue="green" className="mb-2 mt-4">
        All done
      </Eyebrow>
      <h1 className="t-page">{one ? `${s.items[0].label}.eth is renewed.` : `${s.items.length} names are renewed.`}</h1>
      <div className="mx-auto mt-5 max-w-[400px] text-left">
        <Names items={s.items} />
      </div>
      {s.refunded > 0n && <p className="mt-4 text-[14px] text-caption">The {fmtUsdcExact(s.refunded)} left over was refunded to the code’s buyer.</p>}
      <div className="mt-3">
        <Tx hash={s.hash} />
      </div>
      <Button size="lg" className="mt-6 w-full justify-center" onClick={() => go('buy')}>
        Buy a claim code
      </Button>
    </section>
  )
}
