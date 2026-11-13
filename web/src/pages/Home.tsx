import { BudgetTooLowError, getPricing, InvalidLabelError, NotRenewableError, type Pricing, quoteRenewal, solve } from 'ens-budget'
import { ArrowDown, ArrowRight, Check, Copy, ExternalLink, ImageDown, Link2, Printer } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { normalize } from 'viem/ens'
import type { Go, Page } from '@/App'
import { CodeTicket } from '@/components/ds/CodeTicket'
import { Eyebrow, Field, type Hue, Panel, Rows, Rule, SplitBar, StatusPill, TickList, Token, Wrap } from '@/components/ds/primitives'
import { Bean, Coin, Key, Spark, Star, Vault } from '@/components/ds/stickers'
import { EnsMark, Mark, Wordmark, WORDMARK_IN_HEADER } from '@/components/ds/Wordmark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { format, parse } from '@/lib/code'
import { EXPLORER_URL, MAX_NAMES, publicClient, RENEWERS, USDC, VAULT } from '@/lib/config'
import { QUESTIONS } from '@/lib/site'
import { cleanAmount, fmtDelivered, fmtUsdc, fmtUsdcExact, parseUsdc, truncAddress, YEAR_SECONDS } from '@/lib/format'
import { soldLengths } from '@/lib/pricing'
import { cn } from '@/lib/utils'
import { protocolFee } from '@/lib/vault'

/**
 * The landing page. Every section answers one question a visitor arrives with:
 *   Hero        "I have a code. Where does it go?"  (and the way in for buyers)
 *   Calculator  "How much should I put on a code?"
 *   Journey     "How does this work?"
 *   Money       "Who holds my money?"
 *   Events      "Does it work for a crowd?"
 *   Costs       "What does it cost?"
 *   Questions   the remaining doubts that stop people
 *   Closing     the same two doors as the hero
 */
export default function Home({ go, onCode }: { go: Go; onCode: (code: string) => void }) {
  return (
    <div className="overflow-x-hidden">
      <header className="sticky top-0 z-20 bg-background">
        <Wrap>
          <nav className="flex h-[72px] items-center gap-5">
            <Nav to="home" go={go} className={WORDMARK_IN_HEADER}>
              <Wordmark />
            </Nav>
            <Nav to="codes" go={go} className="ml-auto whitespace-nowrap text-[15px] font-medium text-heading transition-colors duration-200 hover:text-foreground/70">
              My codes
            </Nav>
            <Button asChild>
              <Nav to="buy" go={go}>
                Buy a code
              </Nav>
            </Button>
          </nav>
        </Wrap>
      </header>

      <main>
        <Hero go={go} onCode={onCode} />
        <Wrap>
          <Calculator go={go} />
          <Rule />
          <Journey />
          <Rule />
          <Money />
          <Rule />
          <Events go={go} />
          <Rule />
          <Costs />
          <Rule />
          <Questions />
        </Wrap>
        <Closing go={go} onCode={onCode} />
      </main>

      <footer className="py-12 text-[13px] text-caption">
        <Wrap className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <span className="inline-flex items-center gap-2">
            <Mark className="h-4" />© {new Date().getFullYear()} Namepass LLC. All rights reserved.
          </span>
          <span className="flex flex-wrap gap-x-6 gap-y-2 [&_a:hover]:text-foreground [&_a]:transition-colors [&_a]:duration-200">
            <Nav to="buy" go={go}>
              Buy
            </Nav>
            <Nav to="redeem" go={go}>
              Redeem
            </Nav>
            <Nav to="codes" go={go}>
              My codes
            </Nav>
            <a href="https://namepass.com" target="_blank" rel="noreferrer">
              Namepass
            </a>
            <a href="https://www.npmjs.com/package/ens-budget" target="_blank" rel="noreferrer">
              ens-budget
            </a>
          </span>
        </Wrap>
      </footer>
    </div>
  )
}

/** An in-page link that navigates without a reload. */
function Nav({ to, go, search, className, children }: { to: Page; go: Go; search?: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={(to === 'home' ? '/' : `/${to}`) + (search ?? '')}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        go(to, search)
      }}
    >
      {children}
    </a>
  )
}

/** A code being typed: formats as you go and hands a valid code on at once. */
function useCodeEntry(onCode: (code: string) => void) {
  const [value, setValue] = useState('')
  const parsed = parse(value)
  return {
    value,
    change: (raw: string) => {
      const next = format(raw)
      setValue(next)
      if (parse(next).ok) onCode(next)
    },
    ok: parsed.ok,
    error: value && !parsed.ok && !parsed.incomplete ? parsed.error : null,
  }
}

const codeInputProps = { autoComplete: 'off', autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false, maxLength: 29 } as const

/** `balance` evens out a two-line title's lines, for one that would otherwise leave a short tail. */
function SectionHead({ hue, eyebrow, title, lede, balance, className }: { hue: Hue; eyebrow: string; title: string; lede?: ReactNode; balance?: boolean; className?: string }) {
  return (
    <div className={className}>
      <Eyebrow hue={hue}>{eyebrow}</Eyebrow>
      <h2 className={cn('t-title', balance && 'text-balance')}>{title}</h2>
      {lede && <p className="t-lede mt-5">{lede}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ Hero */
/**
 * Most visitors arrive holding a code, so the hero's centrepiece is a ticket they can type it on:
 * redeeming starts here, with no page to find. Buyers get the one black pill above it.
 */
function Hero({ go, onCode }: { go: Go; onCode: (code: string) => void }) {
  const entry = useCodeEntry(onCode)
  return (
    <section className="pb-20 pt-10 text-center sm:pb-28 sm:pt-16">
      <Wrap>
        <Badge variant="secondary" className="mb-5 h-7 gap-2 px-2.5 text-[13px] font-medium text-heading">
          From $1
          <span className="size-1 rounded-full bg-caption" aria-hidden="true" />
          For any .eth name
        </Badge>
        <h1 className="t-hero mx-auto max-w-[940px] text-balance">Renewals you can hand over.</h1>
        <p className="mx-auto mt-5 max-w-[560px] text-[17px] font-medium leading-[26px] tracking-[-0.013em] text-body sm:text-[19px] sm:leading-[28px]">
          Claim codes for ENS renewals. Buy one, pass it on, and it renews any .eth name.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="px-6">
            <Nav to="buy" go={go}>
              Buy a claim code
            </Nav>
          </Button>
          <Button asChild size="lg" variant="soft" className="pl-6 pr-5">
            <a href="#calculator">
              See what it buys <ArrowDown aria-hidden="true" />
            </a>
          </Button>
        </div>

        <div className="relative mx-auto mt-14 max-w-[520px] sm:mt-16">
          {/* Value, a renewed name and a wallet: the three things a code connects. */}
          <Coin size={84} className="absolute -top-9 z-10 -rotate-12 max-sm:-right-2 max-sm:size-14 sm:-left-16" />
          <Coin size={44} className="absolute -top-7 left-[42%] z-10 rotate-12 max-sm:hidden" />
          <Bean size={132} className="absolute -right-10 top-[18%] z-10 rotate-6 max-sm:hidden sm:-right-28" />
          <Key size={96} className="absolute -bottom-7 -left-8 z-10 -rotate-[18deg] max-sm:hidden sm:-left-20" />
          <Star size={26} className="absolute -top-8 text-yellow max-sm:left-1 sm:right-6" />
          <Spark size={22} className="absolute -bottom-9 right-10 text-sky" />

          <CodeTicket
            caption="Have a code?"
            value={<span className="text-[clamp(26px,10.5cqw,50px)]">Redeem it here.</span>}
            strip={
              <label
                className={cn(
                  'flex h-[clamp(40px,11cqw,54px)] items-center rounded-md bg-background px-3 shadow-[inset_0_0_0_1px_var(--rule)] transition-shadow duration-100',
                  'focus-within:shadow-[inset_0_0_0_2px_var(--foreground)]',
                  entry.error && 'shadow-[inset_0_0_0_2px_var(--red)]',
                )}
              >
                <input
                  {...codeInputProps}
                  aria-label="Claim code"
                  placeholder="Type or paste your code"
                  className="t-code w-full min-w-0 bg-transparent text-center text-[clamp(11px,3.6cqw,17px)] uppercase text-foreground outline-none placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-caption"
                  value={entry.value}
                  onChange={(e) => entry.change(e.target.value)}
                />
                {entry.ok && <Check className="size-4 shrink-0 text-green" aria-hidden="true" />}
              </label>
            }
            footnote={entry.error ? <span className="text-red">{entry.error}</span> : undefined}
          />
        </div>
      </Wrap>
    </section>
  )
}

/* ------------------------------------------------------------ Calculator */
/** A stretch of time on a ruler with a tick per year, so amounts can be compared by eye. */
function TimeBar({ seconds, scale, color = 'var(--green)' }: { seconds: bigint; scale: bigint; color?: string }) {
  const years = Number(scale / YEAR_SECONDS)
  const pct = Math.max(1.5, Math.min(100, (Number(seconds) / Number(scale)) * 100))
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-pill">
      <div className="h-full rounded-full transition-[width] duration-300 ease-flavor" style={{ width: `${pct}%`, background: color }} />
      {years <= 12 &&
        Array.from({ length: years - 1 }, (_, i) => (
          <i key={i} className="absolute top-0 h-full w-px bg-background/70" style={{ left: `${((i + 1) / years) * 100}%` }} />
        ))}
    </div>
  )
}

/** Round a duration up to whole years, at least one: the ruler's length. */
const rulerFor = (longest: bigint) => {
  const years = (longest + YEAR_SECONDS - 1n) / YEAR_SECONDS
  return (years < 1n ? 1n : years) * YEAR_SECONDS
}

/**
 * ENS prices a name by its length, so nobody can tell whether $10 is generous or useless. This shows
 * the answer with live ENS prices before any money moves, for a typical name or a real one.
 */
function Calculator({ go }: { go: Go }) {
  const [amountInput, setAmountInput] = useState('25')
  const [nameInput, setNameInput] = useState('')
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [named, setNamed] = useState<{ label: string; duration: bigint } | { label: string; error: string } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    getPricing(publicClient, { token: USDC, renewers: RENEWERS }).then(setPricing, () => {})
  }, [])

  const amount = parseUsdc(amountInput)
  const budget = amount && amount >= 1_000_000n ? amount : null
  const raw = nameInput.trim().replace(/\.eth$/i, '')
  const label = useMemo(() => {
    if (!raw || raw.includes('.')) return null
    try {
      return normalize(raw)
    } catch {
      return null
    }
  }, [raw])

  const lengths = useMemo(() => {
    if (!pricing || !budget) return null
    return soldLengths(pricing).map((e) => {
      try {
        return { name: e.name, duration: solve(pricing, { label: e.label, budget }).duration }
      } catch {
        return { name: e.name, duration: 0n }
      }
    })
  }, [pricing, budget])

  // A real name: ask ENS what this amount adds to it.
  useEffect(() => {
    const mine = ++seq.current
    setNamed(null)
    if (!label || !budget) return
    const t = setTimeout(async () => {
      try {
        const q = await quoteRenewal(publicClient, { label, budget, token: USDC, renewers: RENEWERS })
        if (mine === seq.current) setNamed({ label, duration: q.duration })
      } catch (err) {
        if (mine !== seq.current) return
        const error =
          err instanceof NotRenewableError
            ? `${label}.eth isn’t registered.`
            : err instanceof BudgetTooLowError
              ? 'That amount is too small for this name.'
              : err instanceof InvalidLabelError
                ? 'ENS doesn’t sell names of that length.'
                : 'Couldn’t reach ENS for a price.'
        setNamed({ label, error })
      }
    }, 400)
    return () => clearTimeout(t)
  }, [label, budget])

  const result = named && 'duration' in named ? named : null
  const scale = rulerFor(result ? result.duration : (lengths ?? []).reduce((m, l) => (l.duration > m ? l.duration : m), 0n))

  return (
    <section id="calculator" className="grid items-stretch gap-10 py-20 mid:grid-cols-2 mid:gap-16 mid:py-24">
      <div>
        <SectionHead hue="green" eyebrow="What does it buy?" title="Dollars in, years out." lede="ENS prices a name by its length." />

        <Field className="mt-7 mid:max-w-[340px]" invalid={amountInput !== '' && !budget}>
          <span className="text-caption">$</span>
          <input aria-label="Amount in USDC" inputMode="decimal" autoComplete="off" value={amountInput} onChange={(e) => setAmountInput(cleanAmount(e.target.value))} />
          <span className="text-[14px] text-caption">USDC</span>
        </Field>
        <div className="mt-2 flex mid:max-w-[340px] gap-2">
          {['5', '10', '25', '50', '100'].map((p) => (
            <Button key={p} variant={amountInput === p ? 'default' : 'soft'} className="flex-1 px-0" aria-pressed={amountInput === p} onClick={() => setAmountInput(p)}>
              ${p}
            </Button>
          ))}
        </div>
        <Field className="mt-4 mid:max-w-[340px]" invalid={!!named && 'error' in named}>
          <input aria-label="A .eth name to try" placeholder="Try a name" autoComplete="off" autoCapitalize="none" spellCheck={false} value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
          <span className="text-caption">.eth</span>
        </Field>
        {named && 'error' in named && <p className="mt-1.5 text-[13px] text-red">{named.error}</p>}
      </div>

      <Panel className="flex flex-col p-6 sm:p-8">
        <div className="grid flex-1 content-center">
        {!budget ? (
          <p className="py-10 text-center text-[15px] text-caption">Enter an amount from $1.</p>
        ) : result ? (
          <div className="flex items-center gap-5">
            <Bean size={92} className="max-sm:hidden" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-foreground">{result.label}.eth gets</p>
              <p className="t-display text-[30px] leading-[36px] sm:text-[36px] sm:leading-[42px]">+ {fmtDelivered(result.duration)}</p>
              <div className="mt-4">
                <TimeBar seconds={result.duration} scale={scale} />
              </div>
            </div>
          </div>
        ) : lengths ? (
          <ul className="grid gap-5">
            {lengths.map((l) => (
              <li key={l.name}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium text-foreground">
                    {l.name} <span className="font-normal text-caption">name</span>
                  </span>
                  <span className="text-[15px] text-body">{l.duration > 0n ? fmtDelivered(l.duration) : '—'}</span>
                </div>
                <TimeBar seconds={l.duration} scale={scale} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-10 text-center text-[15px] text-caption">Getting live prices from ENS…</p>
        )}
        </div>
        {budget !== null && (
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-caption">
              <EnsMark className="text-[13px]" />
              Live ENS prices.
            </span>
            <Button asChild size="md">
              <Nav to="buy" go={go} search={`?amount=${amountInput}`}>
                Buy a {fmtUsdc(budget)} code <ArrowRight aria-hidden="true" />
              </Nav>
            </Button>
          </div>
        )}
      </Panel>
    </section>
  )
}

/* --------------------------------------------------------------- Journey */
/**
 * The idea is new, so it is told with the one object it is about: the same ticket in three states.
 * No adjectives, only what happens.
 */
function Journey() {
  const code = 'Q729F-CPAZZ-KG1MY-6EGGP-3V7TG'
  const steps: { title: string; body: string; ticket: ReactNode; sticker: ReactNode; chips: ReactNode[] }[] = [
    {
      title: 'Buy',
      body: 'Choose an amount and pay in USDC.',
      ticket: <CodeTicket amount={25_000000n} ens={false} shimmer={false} />,
      sticker: <Coin size={50} className="absolute -right-4 -top-4 rotate-12" />,
      chips: ['$5', '$10', '$25', '$50'],
    },
    {
      title: 'Hand it over',
      body: 'Send the code, a link, or the ticket as an image.',
      ticket: <CodeTicket amount={25_000000n} code={code} ens={false} shimmer={false} />,
      sticker: <Key size={64} className="absolute -right-5 -top-3 rotate-12" />,
      chips: [
        <>
          <Link2 className="size-3" aria-hidden="true" /> Link
        </>,
        <>
          <ImageDown className="size-3" aria-hidden="true" /> Image
        </>,
        <>
          <Printer className="size-3" aria-hidden="true" /> Print
        </>,
      ],
    },
    {
      title: 'Redeem',
      body: `They pick up to ${MAX_NAMES} .eth names to renew.`,
      ticket: <CodeTicket amount={25_000000n} code={code} stamp="Claimed" ens={false} shimmer={false} />,
      sticker: <Bean size={58} className="absolute -right-4 -top-5 rotate-6" />,
      chips: ['vitalik.eth', 'nick.eth'],
    },
  ]
  return (
    <section id="how" className="py-20 mid:py-24">
      <SectionHead hue="orange" eyebrow="How it works" title="One ticket, three stops." className="max-w-[520px]" />
      {/* Each step is one card with the same skeleton: ticket, a row of chips, then the words. */}
      <ol className="mt-12 grid gap-6 mid:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="panel flex flex-col p-5 sm:p-6">
            <div className="relative mx-auto w-full max-w-[260px]">
              {s.ticket}
              {s.sticker}
            </div>
            <div className="mt-4 flex h-7 justify-center gap-1.5 text-[12px] font-medium text-foreground">
              {s.chips.map((c, k) => (
                <span key={k} className="ringed inline-flex items-center gap-1 rounded-pill px-2.5">
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2.5">
              <Token color="var(--orange)" size={26} className="text-[13px]">
                {i + 1}
              </Token>
              <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-foreground">{s.title}</h3>
            </div>
            <p className="mt-2 text-[16px] leading-[24px] text-body">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ----------------------------------------------------------------- Money */
function Node({ art, title, body }: { art: ReactNode; title: string; body: ReactNode }) {
  return (
    <div className="fragment flex items-center gap-3.5 px-4 py-3 text-left">
      <span className="grid w-12 shrink-0 place-items-center">{art}</span>
      <span className="min-w-0">
        <b className="block text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</b>
        <span className="block text-[13px] leading-[18px] text-caption">{body}</span>
      </span>
    </div>
  )
}

const Down = () => (
  <svg viewBox="0 0 12 28" className="mx-auto h-7 w-3 text-caption" aria-hidden="true">
    <path d="M6 1v22M1.5 19.5 6 24l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * Paying a new site in crypto is the main reason people leave. A diagram answers "who holds it?"
 * faster than a paragraph: one vault, two exits, and an address anyone can check.
 */
function Money() {
  const { copied, copy } = useCopyFeedback()
  return (
    <section id="money" className="grid items-stretch gap-10 py-20 mid:grid-cols-2 mid:gap-16 mid:py-24">
      <Panel className="order-2 flex items-center px-5 py-8 sm:px-8 mid:order-1">
        <div className="mx-auto w-full max-w-[360px]">
          <Node art={<Key size={46} className="-rotate-12" />} title="Your wallet" body="Pays for the code in USDC." />
          <Down />
          <Node art={<Vault size={44} />} title="The vault" body="A contract, not us." />
          {/* Two exits, and only two. */}
          <svg viewBox="0 0 360 34" className="h-[34px] w-full text-caption" aria-hidden="true">
            <path d="M180 1v10M180 11H87v18M180 11h93v18M82.5 25 87 29.5 91.5 25M268.5 25 273 29.5 277.5 25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="grid grid-cols-2 gap-3">
            {/* ENS's own blue, here only: everywhere else the mark takes the text colour. */}
            <Node art={<EnsMark className="translate-y-0 bg-[#0080BC] text-[34px]" />} title="ENS" body="When it’s redeemed." />
            <Node art={<img src="/logos/usdc.svg" alt="" width={34} height={34} className="size-[34px]" />} title="You" body="If it’s unused." />
          </div>
        </div>
      </Panel>

      <div className="order-1 self-center mid:order-2">
        <SectionHead hue="blue" eyebrow="Where the money sits" title="Held by a contract. Not by us." balance lede="A code’s value waits in an onchain vault with two exits: it pays ENS for a renewal, or it returns to the buyer." />
        <TickList hue="blue" items={['Only ever pays ENS', 'Never held by us', 'Open for anyone to check']} className="mt-7" />
        {VAULT && (
          <p className="mt-7 flex flex-wrap items-center gap-2 text-[14px] text-caption">
            Vault
            {EXPLORER_URL ? (
              <a href={`${EXPLORER_URL}/address/${VAULT}`} target="_blank" rel="noreferrer" className="t-code inline-flex items-center gap-1.5 text-[13px] t-link">
                {truncAddress(VAULT)} <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <button type="button" onClick={() => void copy(VAULT)} title={VAULT} className="t-code inline-flex items-center gap-1.5 text-[13px] t-link">
                {truncAddress(VAULT)} {copied === VAULT ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- Events */
/**
 * Someone buying for a crowd needs proof it scales before reading on, so this shows the tool they
 * would use afterwards: the My codes table, with its status bar and bulk actions.
 */
function Events({ go }: { go: Go }) {
  const rows: [string, 'Redeemed' | 'Unused' | 'Cancelled', string][] = [
    ['$10', 'Redeemed', 'vitalik.eth'],
    ['$10', 'Redeemed', 'nick.eth +2'],
    ['$10', 'Unused', '—'],
    ['$10', 'Cancelled', '—'],
  ]
  const color = { Redeemed: 'var(--app-blue)', Unused: 'var(--green)', Cancelled: 'var(--caption)' }
  return (
    <section id="events" className="grid items-stretch gap-10 py-20 mid:grid-cols-2 mid:gap-16 mid:py-24">
      <div className="self-center">
        <SectionHead hue="gold" eyebrow="For events and teams" title="Two hundred codes? Fine." lede="Buy a batch, hand them out, and see which get used." />
        <TickList hue="gold" items={['200 codes per purchase', 'CSV or a printed sheet', 'Track every renewal', 'Unused value isn’t lost']} two className="mt-7" />
        <Button asChild variant="soft" size="md" className="mt-8">
          <Nav to="buy" go={go} search="?qty=100">
            Buy a batch <ArrowRight aria-hidden="true" />
          </Nav>
        </Button>
      </div>

      <Panel className="flex overflow-hidden pl-5 pt-6 sm:pl-8 sm:pt-8" aria-hidden="true">
        <div className="fragment flex-1 rounded-b-none rounded-tr-none p-5 pb-0">
          <div className="flex items-baseline justify-between">
            <span className="t-display text-[26px] leading-[30px]">200 codes</span>
            <span className="text-[13px] text-caption">
              <span className="font-medium text-foreground">$640.00</span> still out there
            </span>
          </div>
          <SplitBar
            className="mt-3"
            segments={[
              { key: 'r', label: 'Redeemed', detail: 131, value: 131, color: color.Redeemed },
              { key: 'u', label: 'Unused', detail: 64, value: 64, color: color.Unused },
              { key: 'c', label: 'Cancelled', detail: 5, value: 5, color: color.Cancelled },
            ]}
          />
          <div className="mt-4 border-t border-rule text-[13px]">
            {rows.map(([value, status, name], i) => (
              <div key={i} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-0">
                <span className="w-9 font-medium text-foreground">{value}</span>
                <span className="t-code flex-1 truncate text-[11px] text-caption/60">•••••-•••••-•••••</span>
                <span className="flex w-[96px] justify-end">
                  <StatusPill color={color[status]}>{status}</StatusPill>
                </span>
                <span className="w-[92px] truncate text-caption max-sm:hidden">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </section>
  )
}

/* ----------------------------------------------------------------- Costs */
/** Hidden fees are the fear, so the whole bill is shown as what it is: a short receipt. */
function Costs() {
  const [fee, setFee] = useState(50_000n)
  useEffect(() => {
    if (VAULT) protocolFee().then(setFee, () => {})
  }, [])
  const value = 10_000000n
  return (
    <section id="costs" className="grid items-stretch gap-10 py-20 mid:grid-cols-2 mid:gap-16 mid:py-24">
      <Panel className="order-2 grid place-items-center px-5 py-10 mid:order-1">
        <div className="relative w-full max-w-[300px] -rotate-2">
          <Coin size={50} className="absolute -right-5 -top-5 z-10 rotate-12" />
          <div className="rounded-t-md bg-background px-5 pb-4 pt-5">
            <p className="font-display text-[17px] font-semibold tracking-[-0.02em] text-heading">Receipt</p>
            <Rows
              className="mt-3 border-t border-dashed border-rule pt-3 [&_dd]:font-normal"
              rows={[
                ['Code value', fmtUsdcExact(value)],
                ['Service fee', fmtUsdcExact(fee)],
                ['Network fee', 'a few cents'],
              ]}
            />
            <div className="mt-3 flex items-center justify-between border-t border-dashed border-rule pt-3 text-[15px] font-semibold text-foreground">
              <span>You pay</span>
              <span>{fmtUsdcExact(value + fee)} + network</span>
            </div>
          </div>
          {/* The torn edge. */}
          <svg className="block h-2.5 w-full text-background" aria-hidden="true">
            <defs>
              <pattern id="torn" width="14" height="10" patternUnits="userSpaceOnUse">
                <path d="M0 0h14L7 10z" fill="currentColor" />
              </pattern>
            </defs>
            <rect width="100%" height="10" fill="url(#torn)" />
          </svg>
        </div>
      </Panel>
      <div className="order-1 self-center mid:order-2">
        <SectionHead hue="purple" eyebrow="What it costs" title="The whole bill fits on a receipt." lede={`A flat ${fmtUsdcExact(fee)} per code. A $10 code renews $10 of ENS.`} />
        <TickList hue="purple" items={['No percentage cut', 'No subscription', 'No fee to redeem']} className="mt-7" />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- Questions */
/** Only the doubts that stop someone from acting. Each answer is one or two sentences. */
function Questions() {
  return (
    <section id="questions" className="grid gap-10 py-20 mid:grid-cols-2 mid:gap-16 mid:py-24">
      <SectionHead hue="pink" eyebrow="Questions" title="Before you ask." className="max-w-[360px]" />
      <div>
        {QUESTIONS.map(([q, a], i) => (
          <details key={q} open={i === 0} className="group border-b border-rule">
            <summary className={cn('flex cursor-pointer list-none gap-5 py-[18px] text-[19px] tracking-[-0.01em] text-foreground [&::-webkit-details-marker]:hidden', i === 0 && 'pt-1')}>
              <span className="w-3.5 flex-none text-[26px] font-light leading-[.9] text-pink group-open:hidden">+</span>
              <span className="hidden w-3.5 flex-none text-[26px] font-light leading-[.9] text-pink group-open:inline">−</span>
              {q}
            </summary>
            <p className="pb-[18px] pl-[34px] text-[16px] leading-[25px]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/* --------------------------------------------------------------- Closing */
/** Whoever reads this far has decided. The page ends on the same two doors it opened with. */
function Closing({ go, onCode }: { go: Go; onCode: (code: string) => void }) {
  const entry = useCodeEntry(onCode)
  return (
    <section className="bg-card py-16 sm:py-20">
      <Wrap>
        <h2 className="t-title text-center">Ready when you are.</h2>
        <div className="mx-auto mt-10 grid max-w-[760px] gap-4 mid:grid-cols-2">
          <div className="ringed flex flex-col rounded-xl p-6">
            <p className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">Have a code?</p>
            <p className="mt-1 flex-1 text-[15px] leading-[22px] text-body">Redeem it on any .eth name.</p>
            <Field className="mt-4" invalid={!!entry.error}>
              <input
                {...codeInputProps}
                aria-label="Claim code"
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                className="t-code text-[13px] uppercase sm:text-[14px]"
                value={entry.value}
                onChange={(e) => entry.change(e.target.value)}
              />
            </Field>
            {entry.error && <p className="mt-1.5 text-[13px] text-red">{entry.error}</p>}
          </div>
          <div className="ringed flex flex-col rounded-xl p-6">
            <p className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">Giving one?</p>
            <p className="mt-1 flex-1 text-[15px] leading-[22px] text-body">From $1 a code. Takes less than a minute.</p>
            <Button asChild size="lg" className="mt-4 justify-center">
              <Nav to="buy" go={go}>
                Buy a claim code
              </Nav>
            </Button>
          </div>
        </div>
      </Wrap>
    </section>
  )
}
