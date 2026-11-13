import { getPricing, type Pricing, solve } from 'ens-budget'
import { Check, Copy, Download, Link2, Minus, Plus } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import type { Go } from '@/App'
import { CodeTicket } from '@/components/ds/CodeTicket'
import { ActionButton, Eyebrow, FieldLabel, Hint, PageTitle, Rows } from '@/components/ds/primitives'
import { Coin, Seal } from '@/components/ds/stickers'
import { ExportDialog } from '@/components/ExportCodes'
import { ShareActions } from '@/components/ShareCode'
import { useSignExplainer } from '@/components/SignExplainer'
import { Button } from '@/components/ui/button'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { codeFor, keyForSecret, redeemLink } from '@/lib/code'
import { publicClient, RENEWERS, SITE_HOST, USDC, VAULT_DEPLOY_BLOCK } from '@/lib/config'
import { cleanAmount, fmtBalance, fmtDelivered, fmtUsdc, fmtUsdcExact, parseUsdc } from '@/lib/format'
import { merkleRoot } from '@/lib/merkle'
import { soldLengths } from '@/lib/pricing'
import { errorMessage } from '@/lib/util'
import { celebrate } from '@/lib/celebrate'
import { cn } from '@/lib/utils'
import { batchId, createCodes, maxBatch, maxCodeAmount, protocolFee, purchasesBy, readBatch, usdcBalance } from '@/lib/vault'
import { sameAccount, useWallet } from '@/lib/wallet'
import { isUnlocked, unlockCodes, walletSecret } from '@/lib/walletCodes'

const PRESETS = ['5', '10', '25', '50']
const MIN_AMOUNT = 1_000_000n

/** A prefilled choice from the landing page: /buy?amount=25 or /buy?qty=100. */
function fromUrl(key: string, fallback: string, ok: RegExp): string {
  const v = new URLSearchParams(location.search).get(key)
  return v && ok.test(v) ? v : fallback
}

const DEFAULT_AMOUNT = '10'
const DEFAULT_QTY = '1'

/** `first` is the wallet's code number of the first code: the number My codes shows for it. */
type Done = { codes: string[]; amount: bigint; first: number }

export default function Buy({ go }: { go: Go }) {
  const { connected } = useWallet()
  const [amountInput, setAmountInput] = useState(() => fromUrl('amount', DEFAULT_AMOUNT, /^\d{1,4}(\.\d{1,6})?$/))
  const [qtyInput, setQtyInput] = useState(() => fromUrl('qty', DEFAULT_QTY, /^\d{1,3}$/))
  const [maxQty, setMaxQty] = useState(100)
  const [max, setMax] = useState(500_000000n)
  /** Paid per code on top of its value; read from the vault. */
  const [fee, setFee] = useState(50_000n)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const explainer = useSignExplainer()

  // The prefill is used once. Left in the address, a reload would bring back that amount or quantity
  // over whatever was chosen since, including after a purchase.
  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname)
  }, [])
  useEffect(() => {
    maxCodeAmount().then(setMax, () => {})
    maxBatch().then((n) => setMaxQty(Number(n)), () => {})
    protocolFee().then(setFee, () => {})
    getPricing(publicClient, { token: USDC, renewers: RENEWERS }).then(setPricing, () => {})
  }, [])
  useEffect(() => {
    setBalance(null)
    if (connected) usdcBalance(connected.address).then(setBalance, () => {})
  }, [connected, done])

  const amount = parseUsdc(amountInput)
  const qty = /^\d+$/.test(qtyInput) ? Number(qtyInput) : 0
  /** What the buyer pays: each code's value plus the fee. */
  const total = amount !== null ? (amount + fee) * BigInt(qty || 1) : null
  const valid = amount !== null && amount >= MIN_AMOUNT && amount <= max && qty >= 1 && qty <= maxQty
  const examples = useMemo(() => {
    if (!pricing || !amount || amount < MIN_AMOUNT) return null
    return soldLengths(pricing).map((e) => {
      try {
        const { duration } = solve(pricing, { label: e.label, budget: amount })
        // Under 90 days, days say more than "1 month" or "2 months".
        return { ...e, text: duration > 0n ? `about ${fmtDelivered(duration, 90)}` : '—' }
      } catch {
        return { ...e, text: '—' }
      }
    })
  }, [pricing, amount])

  async function buy() {
    if (!connected || !amount || qty < 1) return
    setNotice(null)
    // Say why before the wallet asks. Skipped when this visit already unlocked the codes.
    if (!isUnlocked(connected.address) && !(await explainer.ask('buy'))) return
    let root: ReturnType<typeof merkleRoot> | null = null
    try {
      await sameAccount(connected)
      // One signature per visit unlocks this wallet's codes; code #i comes from it.
      setStage('Sign in your wallet to unlock your codes…')
      const master = await unlockCodes(connected.client, connected.address)
      setStage('Preparing your codes…')
      // Next code numbers follow the codes this wallet has already bought.
      const start = (await purchasesBy(connected.address, VAULT_DEPLOY_BLOCK)).reduce((n, p) => n + p.count, 0)
      const secrets = Array.from({ length: qty }, (_, i) => walletSecret(master, start + i))
      // Only the addresses of the codes' keys go onchain, committed together as one purchase.
      const addresses = secrets.map((s) => keyForSecret(s).address)
      root = merkleRoot(addresses)
      const { block } = await createCodes(connected.client, connected.address, addresses, amount, setStage)
      // A code ends with the block it was bought in, so it can be found again without a search.
      const where = Number(block - VAULT_DEPLOY_BLOCK)
      setDone({ codes: secrets.map((s) => codeFor(s, where)), amount, first: start + 1 })
    } catch (err) {
      // The purchase may have landed even if the page saw an error.
      const made = root ? await readBatch(batchId(connected.address, root)).catch(() => null) : null
      setNotice(made ? 'Your purchase went through. See My codes.' : errorMessage(err))
    } finally {
      setStage(null)
    }
  }

  const short = balance !== null && total !== null && balance < total
  const button = ((): { label: string; action?: () => void; busy?: boolean } => {
    if (stage) return { label: stage, busy: true }
    if (amount === null || amount === 0n) return { label: 'Enter an amount' }
    if (amount < MIN_AMOUNT) return { label: 'The smallest code is $1' }
    if (amount > max) return { label: `The largest code is ${fmtUsdc(max)}` }
    if (qty < 1) return { label: 'Enter how many codes' }
    if (qty > maxQty) return { label: `Up to ${maxQty} codes per purchase` }
    if (short) return { label: 'Not enough USDC in this wallet' }
    return { label: qty > 1 ? `Buy ${qty} codes · ${fmtUsdc(total!)}` : `Buy ${fmtUsdc(amount)} claim code · ${fmtUsdc(total!)}`, action: () => void buy() }
  })()

  /** Back to an empty form: the last purchase's value and quantity don't carry over. */
  const another = () => {
    setAmountInput(DEFAULT_AMOUNT)
    setQtyInput(DEFAULT_QTY)
    setNotice(null)
    setDone(null)
  }
  if (done) return done.codes.length > 1 ? <BatchReady done={done} onAnother={another} go={go} /> : <Ready done={done} onAnother={another} go={go} />

  const amountBad = amountInput !== '' && amount === null

  return (
    <>
      {explainer.dialog}
      <PageTitle title="Buy a claim code." />
      {/* Wide screens: the ticket and the receipt share a row and a height; the controls sit under the ticket. */}
      <div className="grid gap-x-14 gap-y-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* The ticket is the form: what you fill in is what the recipient gets. */}
        <section className="lg:col-start-1 lg:row-start-1" aria-busy={!!stage}>
          <CodeTicket
            fill
            count={qty}
            caption={qty > 1 ? `${qty} claim codes, each worth` : 'Claim code worth'}
            value={
              // A dashed line to write on. It only darkens a little while you type (the caret shows where you
              // are) and turns red if the amount won't do. No box, no coloured line.
              <label
                className={cn(
                  '-mx-[2cqw] inline-flex cursor-text items-baseline border-b-2 px-[2cqw] transition-colors duration-100',
                  amountBad ? 'border-dashed border-red' : 'border-dashed border-foreground/20 focus-within:border-foreground/45',
                )}
              >
                <span aria-hidden="true">$</span>
                <input
                  aria-label="Amount in USDC"
                  inputMode="decimal"
                  autoComplete="off"
                  // The field's own height and line are set together: left to inherit the ticket's line, the
                  // field came out shorter than its text and could be scrolled inside itself. 1.05em is the
                  // ticket's own line, so the caret runs the full height of the line, down to the dashes.
                  className="h-[1.05em] bg-transparent leading-[1.05] outline-none placeholder:text-caption/50"
                  style={{ width: `${Math.max(1, amountInput.length) + 0.4}ch` }}
                  placeholder="0"
                  value={amountInput}
                  disabled={!!stage}
                  onChange={(e) => setAmountInput(cleanAmount(e.target.value))}
                />
              </label>
            }
          />
        </section>

        <section className="lg:col-start-1 lg:row-start-2">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <FieldLabel>Amount</FieldLabel>
              <div className="mt-2 flex gap-2">
                {PRESETS.map((p) => (
                  <Button key={p} variant={amountInput === p ? 'default' : 'soft'} size="md" className="flex-1 px-0" aria-pressed={amountInput === p} disabled={!!stage} onClick={() => setAmountInput(p)}>
                    ${p}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="qty">How many</FieldLabel>
              <div className="mt-2 flex h-10 w-fit items-center gap-1 rounded-pill bg-pill px-1">
                <Button variant="ghost" size="icon" aria-label="One code fewer" disabled={!!stage || qty <= 1} onClick={() => setQtyInput(String(Math.max(1, qty - 1)))}>
                  <Minus aria-hidden="true" />
                </Button>
                <input
                  id="qty"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-10 bg-transparent text-center text-[15px] font-medium text-foreground outline-none"
                  value={qtyInput}
                  disabled={!!stage}
                  onChange={(e) => setQtyInput(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
                <Button variant="ghost" size="icon" aria-label="One code more" disabled={!!stage || qty >= maxQty} onClick={() => setQtyInput(String(Math.min(maxQty, (qty || 0) + 1)))}>
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
          {amountBad && <p className="mt-2 text-[13px] text-red">Enter an amount like 25 or 12.50.</p>}

          {examples && (
            <div className="mt-8 border-t border-rule pt-6">
              <Eyebrow hue="green" className="mb-2.5 flex items-center gap-1.5">
                What {fmtUsdc(amount!)} renews
                <Hint label="About these examples" text="ENS prices names by length. Longer renewals cost less per year." />
              </Eyebrow>
              <Rows className="[&_dd]:font-normal [&_dt]:text-body" rows={examples.map((e) => [e.name, e.text])} />
            </div>
          )}
        </section>

        {/* The receipt: the whole bill, then the one action. */}
        <aside className="panel relative p-5 sm:p-6 lg:col-start-2 lg:row-start-1">
          <Coin size={52} className="absolute -right-3 -top-4 rotate-12" />
          <p className="font-display text-[19px] font-semibold tracking-[-0.02em] text-heading">Receipt</p>
          <Rows
            className="mt-4 border-t border-dashed border-border pt-4 [&_dd]:font-normal"
            rows={[
              [qty > 1 && amount ? `${qty} codes × ${fmtUsdc(amount)}` : 'Code value', valid ? fmtUsdc(amount! * BigInt(qty)) : '—'],
              [
                <span key="fee" className="inline-flex items-center gap-1.5">
                  Service fee{qty > 1 ? ` (${fmtUsdcExact(fee)} each)` : ''}
                  <Hint label="About the service fee" text="A flat fee per code." />
                </span>,
                valid ? fmtUsdcExact(fee * BigInt(qty)) : '—',
              ],
            ]}
          />
          <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-border pt-4">
            <span className="text-[15px] font-semibold text-foreground">Total</span>
            <span className="t-display text-[26px] leading-[30px]">{valid ? fmtUsdcExact(total!) : '—'}</span>
          </div>
          {balance !== null && <p className={cn('mt-1 text-right text-[13px]', short ? 'text-red' : 'text-caption')}>USDC balance {fmtBalance(balance)}</p>}

          <ActionButton {...button} />
          {notice && (
            <p role="alert" className="mt-3 text-[13px] text-red">
              {notice}
            </p>
          )}
          {stage && <p className="mt-3 text-[13px] text-caption">Keep this page open until the purchase confirms.</p>}
        </aside>
      </div>
    </>
  )
}

/** Copy icon that flips to a tick for a moment. */
function CopyIcon({ done }: { done: boolean }) {
  return done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />
}

const LINKS = 't-link'
/**
 * Purchase complete. Side by side on wide screens, and then both columns are one height: the grid
 * stretches them, and each side has one place that takes up the difference. The ticket keeps its
 * own proportions, so the right side is usually the taller one and the left panel spreads its
 * spacing; if the left is taller, the summary on the right drops to the bottom edge.
 */
const COLUMNS = 'grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14'
/** The panel's last row: links centred between the rule above and the panel's bottom edge. */
const FOOTER = 'no-print -mb-2 mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-rule pt-4 text-[15px] font-medium sm:-mb-3 sm:pt-5'

function Ready({ done, onAnother, go }: { done: Done; onAnother: () => void; go: Go }) {
  const code = done.codes[0]
  const { copied, copy } = useCopyFeedback()
  const redeemAt = `${SITE_HOST}/redeem`
  useEffect(celebrate, [])

  return (
    <div className={COLUMNS}>
      <section className="panel flex flex-col p-6 sm:p-8">
        <Eyebrow hue="green" className="flex items-center gap-2">
          <Seal size={26} />
          Purchase complete
        </Eyebrow>
        <h1 className="t-page">Your claim code is ready.</h1>
        <p className="mt-2 text-[17px] leading-[26px] text-body">Send this code to the recipient.</p>

        {/* Any spare height goes evenly above and below the code. */}
        <div className="my-auto pt-6">
          <FieldLabel className="block">Claim code</FieldLabel>
          <div className="fragment mt-2 flex items-center gap-3 py-2 pl-4 pr-2">
            <span className="t-code min-w-0 flex-1 text-[15px] text-foreground sm:text-[16px]">
              {code.split('-').map((g, i) => (
                <span key={i} className="inline-block whitespace-nowrap">
                  {i > 0 && '-'}
                  {g}
                </span>
              ))}
            </span>
            <Button size="md" className="no-print shrink-0 px-4" onClick={() => void copy(code)}>
              <CopyIcon done={copied === code} />
              {copied === code ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <ShareActions code={code} amount={done.amount} copy={copy} copied={copied} className="mt-3" />
        </div>

        <div className={FOOTER}>
          <button type="button" className={LINKS} onClick={onAnother}>
            Buy another
          </button>
          <button type="button" className={LINKS} onClick={() => go('codes')}>
            See my codes
          </button>
        </div>
      </section>

      <aside className="flex flex-col">
        <CodeTicket amount={done.amount} code={code} qr={redeemLink(code)} />
        {/* Keeps its gap under the ticket, and sits on the bottom edge if the left side is taller. */}
        <div className="pt-5 lg:mt-auto">
          <Rows
            className="panel p-4"
            rows={[
              ['Value', fmtUsdc(done.amount)],
              ['Expires', 'Never'],
              ['Redeem at', redeemAt],
            ]}
          />
        </div>
      </aside>
    </div>
  )
}

/** After a bulk purchase: every code, with the same exports My codes offers, and copy-all. */
function BatchReady({ done, onAnother, go }: { done: Done; onAnother: () => void; go: Go }) {
  const { copied, copy } = useCopyFeedback()
  const [exporting, setExporting] = useState(false)
  useEffect(celebrate, [])
  const n = done.codes.length
  const all = done.codes.join('\n')
  const links = done.codes.map(redeemLink).join('\n')
  const scopes = useMemo(() => [{ key: 'all', label: 'All', items: done.codes.map((code, i) => ({ number: done.first + i, code, amount: done.amount })) }], [done])

  return (
    <div className={COLUMNS}>
      <section className="panel flex flex-col p-6 sm:p-8">
        <Eyebrow hue="green" className="flex items-center gap-2">
          <Seal size={26} />
          Purchase complete
        </Eyebrow>
        <h1 className="t-page">Your {n} claim codes are ready.</h1>
        <p className="mt-2 text-[17px] leading-[26px] text-body">You can see these codes again in My codes.</p>

        <div className="no-print mt-5 grid gap-2 sm:grid-cols-3">
          <Button size="md" className="px-0" onClick={() => setExporting(true)}>
            <Download aria-hidden="true" /> Export
          </Button>
          <Button variant="soft" size="md" className="px-0" onClick={() => void copy(all)}>
            <CopyIcon done={copied === all} />
            {copied === all ? 'Copied' : 'Copy all'}
          </Button>
          <Button variant="soft" size="md" className="px-0" onClick={() => void copy(links)}>
            {copied === links ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            {copied === links ? 'Copied' : 'Copy links'}
          </Button>
        </div>
        <ExportDialog open={exporting} onOpenChange={setExporting} scopes={scopes} />

        {/* Wide screens: the list fills the height the ticket side sets, and scrolls inside it. */}
        <div className="relative mt-5 lg:min-h-[calc(var(--rows)*45px+2px)] lg:flex-1 print:min-h-0" style={{ '--rows': Math.min(n, 4) } as CSSProperties}>
          <ol className="fragment max-h-[360px] overflow-auto lg:absolute lg:inset-x-0 lg:top-0 lg:max-h-full print:static print:max-h-none print:overflow-visible">
            {done.codes.map((c, i) => (
              <li key={c} className={cn('flex items-center gap-3 px-3 py-2', i > 0 && 'border-t border-rule')}>
                <span className="w-7 shrink-0 text-right text-[12px] tabular-nums text-caption">{done.first + i}</span>
                <span className="t-code min-w-0 flex-1 text-[13px] text-foreground">{c}</span>
                <Button variant="ghost" size="icon-sm" className="no-print" aria-label={`Copy code ${done.first + i}`} onClick={() => void copy(c)}>
                  <CopyIcon done={copied === c} />
                </Button>
                <Button variant="ghost" size="icon-sm" className="no-print" aria-label={`Copy redeem link ${done.first + i}`} onClick={() => void copy(redeemLink(c))}>
                  {copied === redeemLink(c) ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
                </Button>
              </li>
            ))}
          </ol>
        </div>

        <div className={FOOTER}>
          <button type="button" className={LINKS} onClick={onAnother}>
            Buy more
          </button>
          <button type="button" className={LINKS} onClick={() => go('codes')}>
            Manage in My codes
          </button>
        </div>
      </section>

      <aside className="no-print flex flex-col">
        <CodeTicket amount={done.amount} code={done.codes[0]} count={n} />
        <div className="pt-14 lg:mt-auto">
          <Rows
            className="panel p-4"
            rows={[
              ['Codes', String(n)],
              ['Each code', fmtUsdc(done.amount)],
              ['Total value', fmtUsdc(done.amount * BigInt(n))],
              ['Expire', 'Never'],
            ]}
          />
        </div>
      </aside>
    </div>
  )
}
