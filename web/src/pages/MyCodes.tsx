import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Eye, Link2, Loader2, MoreHorizontal, Search, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
import type { Go } from '@/App'
import { PageTitle, SplitBar, StatusPill } from '@/components/ds/primitives'
import { Ticky } from '@/components/ds/stickers'
import { ExportDialog, type ExportScope } from '@/components/ExportCodes'
import { DownloadImageItem, hasShareSheet, ShareSheetItem } from '@/components/ShareCode'
import { type SignReason, useSignExplainer } from '@/components/SignExplainer'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollX } from '@/components/ui/scroll-x'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { clean, codeFor, keyForSecret, redeemLink } from '@/lib/code'
import { EXPLORER_URL, VAULT_DEPLOY_BLOCK } from '@/lib/config'
import { fmtBalance, fmtDateSecs, fmtDelivered, fmtUsdc } from '@/lib/format'
import { merkleRoot } from '@/lib/merkle'
import type { ExportItem } from '@/lib/export'
import { errorMessage } from '@/lib/util'
import { cn } from '@/lib/utils'
import { blockTimes, cancelCodes, cancelledBits, purchasesBy, type Redemption, redemptionsOf, usedBits } from '@/lib/vault'
import { sameAccount, useWallet } from '@/lib/wallet'
import { isUnlocked, unlockCodes, walletSecret } from '@/lib/walletCodes'

/**
 * One code this wallet bought. The vault stores purchases, not codes, so a code is known by its
 * purchase (`root`) and its position in it (`index`). `id` is that pair as a string, for React.
 */
type Row = {
  id: string
  root: Hex
  index: number
  /** The purchase's block: where the code was bought, which the code itself ends with. */
  block: bigint
  amount: bigint
  tx: Hex
  bought: bigint | null
  /** This wallet's code number, counting from 1 in purchase order. The code is derived from it. */
  order: number
  state: 'unused' | 'redeemed' | 'cancelled'
  redemption: Redemption | null
}

const STATUS = {
  unused: { text: 'Unused', color: 'var(--green)', rank: 0 },
  redeemed: { text: 'Redeemed', color: 'var(--app-blue)', rank: 1 },
  cancelled: { text: 'Cancelled', color: 'var(--caption)', rank: 2 },
} as const

/** Views a distributor needs, all from chain state: what is still out there, what got used, what came back. */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unused', label: 'Unused' },
  { key: 'redeemed', label: 'Redeemed' },
  { key: 'cancelled', label: 'Cancelled' },
] as const
type Filter = (typeof FILTERS)[number]['key']

type SortKey = 'bought' | 'amount' | 'status'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

/** Rows per page the tables offer; the first is the default. */
const PAGE_SIZES = [10, 25, 50, 100]

/** A table's rows-per-page choice, remembered in this browser. */
function usePageSize(key: string): [number, (n: number) => void] {
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      return PAGE_SIZES.includes(saved) ? saved : PAGE_SIZES[0]
    } catch {
      return PAGE_SIZES[0]
    }
  })
  return [
    size,
    (n) => {
      setSize(n)
      try {
        localStorage.setItem(key, String(n))
      } catch {
        // Private windows may refuse storage; the choice still holds for this visit.
      }
    },
  ]
}
/** Resolves when this page is the focused window again, or after three seconds if it never is. */
const focusBack = () =>
  document.hasFocus()
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const done = () => {
          window.removeEventListener('focus', done)
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(done, 3000)
        window.addEventListener('focus', done)
      })

/** The purchase filter and the Reveal codes / Export button sit one above the other, so they share a width. */
const SIDE_BUTTON = 'w-[150px]'
/**
 * Table rules, the same in both tables: rows are 48px; the first column is medium and dark; every
 * other cell is regular 14px in the body colour; a status is a 12px badge. Only the Code column uses
 * the mono face, at 13px so it looks the same height as the 14px text (it runs larger than Inter).
 */
const MONO = 't-code text-[13px]'

/** "vitalik.eth" or "vitalik.eth +2" for a redemption's names. */
const namesOf = (r: Redemption) => `${r.renewals[0].label}.eth${r.renewals.length > 1 ? ` +${r.renewals.length - 1}` : ''}`

export default function MyCodes({ go }: { go: Go }) {
  const { connected } = useWallet()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Codes waiting for the cancel confirmation: one from a row menu, or many from the toolbar. */
  const [confirm, setConfirm] = useState<Row[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = usePageSize('ens.codes:rows:codes')
  const [filter, setFilter] = useState<Filter>('all')
  const [batch, setBatch] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'bought', dir: 'desc' })
  /** Code address -> code, once the wallet has signed; `null` until shown. */
  const [codes, setCodes] = useState<Map<string, string> | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [exporting, setExporting] = useState(false)
  const explainer = useSignExplainer()
  const { copied, copy } = useCopyFeedback()
  const [shareSheet] = useState(hasShareSheet)

  const load = useCallback(async () => {
    setRows(null)
    setError(null)
    setCodes(null)
    setSelected(new Set())
    if (!connected) return
    try {
      const purchases = await purchasesBy(connected.address, VAULT_DEPLOY_BLOCK)
      const ids = purchases.map((p) => p.id)
      const [used, cancelled, redemptions, times] = await Promise.all([
        usedBits(ids),
        cancelledBits(connected.address, VAULT_DEPLOY_BLOCK),
        redemptionsOf(ids, VAULT_DEPLOY_BLOCK),
        blockTimes(purchases.map((p) => p.block)),
      ])
      const redeemed = new Map(redemptions.map((r) => [`${r.id}:${r.index}`, r]))
      const bit = (bits: bigint | undefined, index: number) => ((bits ?? 0n) >> BigInt(index)) % 2n === 1n
      const list: Row[] = []
      for (const p of purchases) {
        for (let index = 0; index < p.count; index++) {
          const id = `${p.id}:${index}`
          const redemption = redeemed.get(id) ?? null
          list.push({
            id,
            root: p.root,
            index,
            block: p.block,
            amount: p.amount,
            tx: p.tx,
            bought: times.get(p.block) ?? null,
            order: list.length + 1,
            // The vault's used bit is the truth; the events say which kind of used.
            state: redemption ? 'redeemed' : bit(cancelled.get(p.id), index) ? 'cancelled' : bit(used.get(p.id), index) ? 'redeemed' : 'unused',
            redemption,
          })
        }
      }
      // Newest first.
      setRows(list.reverse())
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [connected])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Re-derive this wallet's codes. Code number n comes from the wallet's signature and n; a purchase's
   * codes are shown only if they reproduce the root the vault stored for it, which proves they are
   * the codes that were bought.
   */
  async function showCodes(reason: SignReason = 'view'): Promise<Map<string, string> | null> {
    if (!connected || !rows) return null
    // The dialog names what the person pressed, so a signature after Export or Copy link isn't a surprise.
    if (!isUnlocked(connected.address) && !(await explainer.ask(reason))) return null
    setUnlocking(true)
    setError(null)
    try {
      await sameAccount(connected)
      const master = await unlockCodes(connected.client, connected.address)
      const byPurchase = new Map<string, Row[]>()
      for (const r of rows) byPurchase.set(r.root, [...(byPurchase.get(r.root) ?? []), r])
      const found = new Map<string, string>()
      for (const [root, list] of byPurchase) {
        const inOrder = [...list].sort((x, y) => x.index - y.index)
        const secrets = inOrder.map((r) => walletSecret(master, r.order - 1))
        if (merkleRoot(secrets.map((secret) => keyForSecret(secret).address)) !== root) continue
        inOrder.forEach((r, i) => found.set(r.id, codeFor(secrets[i], Number(r.block - VAULT_DEPLOY_BLOCK))))
      }
      setCodes(found)
      if (found.size === 0 && rows.length > 0) setError('These codes can’t be recovered with this wallet. Unused ones can still be cancelled.')
      return found
    } catch (err) {
      setError(errorMessage(err))
      return null
    } finally {
      setUnlocking(false)
    }
  }

  /** One row's code, showing the codes first (one signature) if they aren't yet. Null if that was declined or the code can't be recovered. */
  async function codeOf(r: Row, reason: SignReason): Promise<string | null> {
    return (codes ?? (await showCodes(reason)))?.get(r.id) ?? null
  }

  /**
   * Copy, and say so: after a menu closes or a signature, nothing else on the page shows it worked.
   *
   * After a signature the copy can be refused, for two reasons. A wallet signs in its own window, and
   * a browser won't let a page that isn't the focused window touch the clipboard: so wait for the
   * focus to come back, which it does as the wallet's window closes. Some browsers go further and
   * only allow a copy straight after a click; for those the message carries a button, and pressing
   * it is that click.
   */
  async function copyAndSay(value: string, done: string, justRevealed: boolean, again = 'Copy') {
    if (justRevealed) await focusBack()
    if (await copy(value)) return void toast.success(done)
    if (justRevealed) toast('Your codes are revealed.', { duration: 20_000, action: { label: again, onClick: () => void copyAndSay(value, done, false) } })
    else toast('Couldn’t copy. Select it and copy it by hand.')
  }

  /** Copy one row's code or link, revealing the codes first if they are hidden. */
  async function copyRow(r: Row, what: 'copy' | 'link') {
    const hidden = !codes
    const code = await codeOf(r, what)
    if (code) await copyAndSay(what === 'copy' ? code : redeemLink(code), what === 'copy' ? 'Code copied' : 'Link copied', hidden, what === 'copy' ? 'Copy code' : 'Copy link')
  }

  async function copySelected(list: Row[]) {
    const hidden = !codes
    const map = codes ?? (await showCodes('codes'))
    const found = map ? list.flatMap((r) => map.get(r.id) ?? []) : []
    if (found.length) await copyAndSay(found.join('\n'), found.length === 1 ? 'Code copied' : `${found.length} codes copied`, hidden, found.length === 1 ? 'Copy code' : 'Copy codes')
  }

  async function copyLinks(list: Row[]) {
    const hidden = !codes
    const map = codes ?? (await showCodes('links'))
    const found = map ? list.flatMap((r) => map.get(r.id) ?? []) : []
    if (found.length) await copyAndSay(found.map(redeemLink).join('\n'), found.length === 1 ? 'Link copied' : `${found.length} links copied`, hidden, found.length === 1 ? 'Copy link' : 'Copy links')
  }

  /** Exports need the codes themselves, so this shows them first (one signature) if they aren't yet. */
  async function openExport() {
    if (codes ?? (await showCodes('export'))) setExporting(true)
  }

  async function cancelMany(list: Row[]) {
    if (!connected || list.length === 0) return
    setError(null)
    setBulkStage('Preparing…')
    try {
      await sameAccount(connected)
      // One entry per purchase, with a bit for each of its codes to cancel.
      const masks = new Map<Hex, bigint>()
      for (const r of list) masks.set(r.root, (masks.get(r.root) ?? 0n) | (1n << BigInt(r.index)))
      const done = await cancelCodes(
        connected.client,
        connected.address,
        [...masks].map(([root, mask]) => ({ root, mask })),
        setBulkStage,
      )
      // Mark what the transaction itself reports as cancelled: no waiting on a second read.
      const gone = (r: Row) => ((done.get(r.id.slice(0, r.id.indexOf(':')).toLowerCase() as Hex) ?? 0n) >> BigInt(r.index)) % 2n === 1n
      setRows((prev) => prev && prev.map((r) => (r.state === 'unused' && gone(r) ? { ...r, state: 'cancelled' } : r)))
      setSelected(new Set())
      // A code that was skipped was redeemed in the meantime: read everything again to show by whom.
      if (!list.every(gone)) await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBulkStage(null)
    }
  }

  const batches = useMemo(() => {
    const byTx = new Map<string, { tx: string; count: number; amount: bigint; bought: bigint | null; order: number }>()
    for (const r of rows ?? []) {
      const b = byTx.get(r.tx)
      if (b) b.count++
      else byTx.set(r.tx, { tx: r.tx, count: 1, amount: r.amount, bought: r.bought, order: r.order })
    }
    return [...byTx.values()].sort((a, b) => b.order - a.order)
  }, [rows])
  const batchShort = (b: { count: number; amount: bigint }) => `${b.count} × ${fmtUsdc(b.amount)}`
  /** "10 Nov, 15:42 · 12 × $10": the time tells apart purchases made on the same day. */
  const batchLabel = (b: (typeof batches)[number]) => {
    const when = b.bought ? new Date(Number(b.bought) * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
    return `${when} · ${b.count} × ${fmtUsdc(b.amount)}`
  }

  const matches = (r: Row, f: Filter) => f === 'all' || r.state === f
  const scoped = (rows ?? []).filter((r) => !batch || r.tx === batch)
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, scoped.filter((r) => matches(r, f.key)).length])) as Record<Filter, number>
  const q = clean(query)
  const view = scoped
    .filter((r) => matches(r, filter))
    .filter((r) => {
      // Search finds codes, so it applies only once the codes are shown.
      if (!q || !codes) return true
      const code = codes.get(r.id)
      return !!code && clean(code).includes(q)
    })
    .sort((a, b) => {
      const v = (r: Row): number | bigint => (sort.key === 'amount' ? r.amount : sort.key === 'status' ? STATUS[r.state].rank : r.order)
      const x = v(a)
      const y = v(b)
      const c = x === y ? a.order - b.order : x < y ? -1 : 1
      return sort.dir === 'asc' ? c : -c
    })
  const setSortKey = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'status' ? 'asc' : 'desc' }))
  useEffect(() => setPage(0), [filter, batch, query, sort, pageSize])

  const sum = (list: Row[]) => list.reduce((t, r) => t + r.amount, 0n)
  const unused = (r: Row) => r.state === 'unused'
  const allUnused = rows?.filter(unused) ?? []
  const allUnusedHere = scoped.some(unused)
  /** Said in the export dialog when a purchase is chosen, since the sets are then limited to it. */
  const chosenBatch = batch ? batches.find((b) => b.tx === batch) : undefined
  const batchNote = chosenBatch ? `From the purchase of ${batchLabel(chosenBatch)}.` : undefined
  /** Unused codes in the current view, on every page: what "Cancel N unused" covers. */
  const cancellable = view.filter(unused)
  /** Selected codes in the view (any status), and the ones among them that can be cancelled. */
  const chosen = view.filter((r) => selected.has(r.id))
  const picked = chosen.filter(unused)
  /** A row as it goes into an export. Codes this wallet can't reproduce are left out. */
  const toItems = (list: Row[]): ExportItem[] =>
    [...list]
      .sort((a, b) => a.order - b.order)
      .flatMap((r) => {
        const code = codes?.get(r.id)
        if (!code) return []
        return {
          number: r.order,
          code,
          amount: r.amount,
          status: STATUS[r.state].text,
          renewed: r.redemption?.renewals.map((x) => `${x.label}.eth`).join(' '),
          bought: r.bought ? new Date(Number(r.bought) * 1000).toISOString().slice(0, 10) : undefined,
        }
      })
  /** What Export offers: within the chosen purchase if there is one, whatever tab or search is showing. */
  const exportScopes: ExportScope[] = exporting
    ? [
        { key: 'selected', label: 'Selected', items: toItems(chosen) },
        { key: 'unused', label: 'Unused', items: toItems(scoped.filter(unused)) },
        { key: 'all', label: 'All', items: toItems(scoped) },
      ]
    : []
  const pages = Math.max(1, Math.ceil(view.length / pageSize))
  const current = Math.min(page, pages - 1)
  const pageRows = view.slice(current * pageSize, (current + 1) * pageSize)
  /** The header checkbox covers every code in the view, on all pages. */
  const allPicked = view.length > 0 && chosen.length === view.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <PageTitle title="My codes." />

      {rows && rows.length > 0 && (
        // One bar answers a distributor's first question: how many are still out there?
        <section className="panel mb-8 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="t-display text-[28px] leading-[32px]">
              {rows.length} {rows.length === 1 ? 'code' : 'codes'}
            </span>
            <span className="text-[14px] text-caption">
              <span className="font-medium text-foreground">{fmtBalance(sum(allUnused))}</span> still out there
            </span>
          </div>
          <SplitBar
            className="mt-4"
            segments={(['unused', 'redeemed', 'cancelled'] as const).map((k) => {
              const n = rows.filter((r) => r.state === k).length
              return { key: k, label: STATUS[k].text, detail: n, value: n, color: STATUS[k].color }
            })}
          />
        </section>
      )}

      <section className="ringed overflow-hidden rounded-xl">
        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-rule py-2.5 pl-3 pr-4">
            <ScrollX className="flex items-center gap-1" role="tablist" aria-label="Filter codes">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[14px] font-medium transition-colors duration-100',
                    filter === f.key ? 'bg-pill text-foreground' : 'text-caption hover:text-foreground',
                  )}
                >
                  {f.label}
                  <span className="text-caption">{counts[f.key]}</span>
                </button>
              ))}
            </ScrollX>
            {(codes || batches.length > 1) && (
              <div className="flex items-center gap-2">
                {batches.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="soft" className={cn(SIDE_BUTTON, 'justify-between text-[14px] tracking-normal')}>
                        <span className="truncate">{batch ? batchShort(batches.find((b) => b.tx === batch)!) : 'All purchases'}</span>
                        <ChevronDown className="size-3.5 text-caption" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[230px]">
                      <DropdownMenuLabel className="text-[12px] font-medium text-caption">Purchase</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem checked={!batch} onCheckedChange={() => setBatch(null)}>
                        All purchases
                      </DropdownMenuCheckboxItem>
                      {batches.map((b) => (
                        <DropdownMenuCheckboxItem key={b.tx} checked={batch === b.tx} onCheckedChange={() => setBatch(b.tx)}>
                          {batchLabel(b)}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {codes && (
                  <label className="flex h-8 w-[200px] items-center gap-2 rounded-pill bg-pill px-3 focus-within:shadow-[inset_0_0_0_2px_var(--foreground)]">
                    <Search className="size-3.5 shrink-0 text-caption" aria-hidden="true" />
                    <input
                      className="t-code min-w-0 flex-1 bg-transparent text-[13px] uppercase outline-none placeholder:font-sans placeholder:text-[14px] placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-caption"
                      placeholder="Find a code"
                      aria-label="Find a code"
                      autoComplete="off"
                      spellCheck={false}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-rule px-4 py-2.5">
          <span className="whitespace-nowrap text-[14px] font-medium text-foreground">{rows ? `${view.length} ${view.length === 1 ? 'code' : 'codes'}` : 'Codes'}</span>
          {rows && rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2 [&_button]:text-[14px] [&_button]:tracking-normal">
              {bulkStage ? (
                <span className="inline-flex items-center gap-1.5 text-[14px] text-caption">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {bulkStage}
                </span>
              ) : chosen.length > 0 ? (
                <>
                  <Button variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                  <Button variant="soft" disabled={unlocking} onClick={() => void copySelected(chosen)}>
                    <Copy aria-hidden="true" /> Copy codes
                  </Button>
                  <Button variant="soft" disabled={unlocking} onClick={() => void copyLinks(chosen)}>
                    <Link2 aria-hidden="true" /> Copy links
                  </Button>
                  <Button variant="soft" disabled={unlocking} onClick={() => void openExport()}>
                    <Download aria-hidden="true" /> Export
                  </Button>
                  {picked.length > 0 && (
                    <Button variant="destructive" onClick={() => setConfirm(picked)} title={picked.length < chosen.length ? 'Only unused codes can be cancelled.' : undefined}>
                      <Undo2 aria-hidden="true" /> Cancel {picked.length} unused · {fmtBalance(sum(picked))}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {cancellable.length > 1 && (
                    // Acts on the current view (purchase, tab, search), so it never reaches codes you can't see.
                    <Button variant="soft" onClick={() => setConfirm(cancellable)}>
                      <Undo2 aria-hidden="true" /> Cancel {cancellable.length} unused
                    </Button>
                  )}
                  {/* Always offered: exporting shows the codes first (one signature) if they aren't yet. */}
                  <Button variant="soft" className={codes ? SIDE_BUTTON : undefined} disabled={unlocking} onClick={() => void openExport()}>
                    <Download aria-hidden="true" /> Export
                  </Button>
                  {!codes && (
                    <Button className={SIDE_BUTTON} disabled={unlocking} onClick={() => void showCodes()}>
                      {unlocking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      Reveal codes
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {error && <p className="mx-4 mt-3 rounded-md bg-card px-3 py-2 text-[14px] text-red">{error}</p>}

        {rows === null && !error ? (
          <div className="flex items-center gap-2 px-4 py-8 text-[14px] text-caption">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading your codes…
          </div>
        ) : rows && rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Ticky size={96} className="mx-auto -rotate-6" />
            <p className="mt-4 text-[14px] text-body">No codes from this wallet yet.</p>
            <Button className="mt-4" onClick={() => go('buy')}>
              Buy a claim code
            </Button>
          </div>
        ) : rows && view.length === 0 ? (
          <div className="px-4 py-12 text-center text-[14px] text-caption">No codes match this view.</div>
        ) : (
          rows && (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      aria-label="Select all codes"
                      checked={allPicked ? true : chosen.length > 0 ? 'indeterminate' : false}
                      disabled={view.length === 0 || !!bulkStage}
                      onCheckedChange={() => setSelected(allPicked ? new Set() : new Set(view.map((r) => r.id)))}
                    />
                  </TableHead>
                  {/* The same number that is printed on its voucher and in its picture's file name. */}
                  <TableHead className="w-12">No.</TableHead>
                  <TableHead>
                    <SortButton label="Value" k="amount" sort={sort} onSort={setSortKey} />
                  </TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>
                    <SortButton label="Status" k="status" sort={sort} onSort={setSortKey} />
                  </TableHead>
                  <TableHead>Renewed</TableHead>
                  <TableHead>
                    <SortButton label="Bought" k="bought" sort={sort} onSort={setSortKey} />
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => {
                  const s = STATUS[r.state]
                  const code = codes?.get(r.id) ?? null
                  return (
                    <TableRow key={r.id} data-state={selected.has(r.id) ? 'selected' : undefined}>
                      <TableCell className="pl-4">
                        <Checkbox aria-label={`Select ${fmtUsdc(r.amount)} code number ${r.order}`} checked={selected.has(r.id)} disabled={!!bulkStage} onCheckedChange={() => toggle(r.id)} />
                      </TableCell>
                      <TableCell className="tabular-nums text-caption">{r.order}</TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground">{fmtUsdc(r.amount)}</span>
                      </TableCell>
                      <TableCell>
                        {code ? (
                          <button type="button" className={cn(MONO, 'group inline-flex items-center gap-1.5 whitespace-nowrap text-foreground')} onClick={() => void copy(code)} title="Copy code">
                            {code}
                            {copied === code ? (
                              <Check className="size-3.5 text-green" aria-hidden="true" />
                            ) : (
                              <Copy className="size-3.5 text-caption opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <span className={cn(MONO, 'whitespace-nowrap text-caption/60')}>{codes ? 'not recoverable' : '•••••-•••••-•••••'}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusPill color={s.color}>{s.text}</StatusPill>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={r.redemption?.renewals.map((x) => `${x.label}.eth`).join(', ')}>
                        {r.redemption ? namesOf(r.redemption) : '—'}
                      </TableCell>
                      <TableCell>{r.bought ? fmtDateSecs(r.bought) : '—'}</TableCell>
                      <TableCell className="pr-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Code actions">
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[250px]">
                            {/* Offered before the codes are showing too: each one shows them first (one signature). */}
                            {(code || !codes) && (
                              <>
                                <DropdownMenuItem onSelect={() => void copyRow(r, 'copy')}>
                                  <Copy aria-hidden="true" /> Copy code
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void copyRow(r, 'link')}>
                                  <Link2 aria-hidden="true" /> Copy redeem link
                                </DropdownMenuItem>
                                {r.state === 'unused' &&
                                  (shareSheet ? <ShareSheetItem code={code ?? (() => codeOf(r, 'share'))} amount={r.amount} /> : <DownloadImageItem code={code ?? (() => codeOf(r, 'image'))} amount={r.amount} />)}
                              </>
                            )}
                            {r.state === 'unused' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => setConfirm([r])}>
                                  <Undo2 aria-hidden="true" /> Cancel and get back {fmtBalance(r.amount)}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )
        )}

        <Pager total={view.length} current={current} onPage={setPage} size={pageSize} onSize={setPageSize} noun="codes" note={chosen.length > 0 ? `${chosen.length} selected` : undefined} />
      </section>

      {rows && rows.length > 0 && <RenewedNames rows={rows} />}

      {explainer.dialog}
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        scopes={exportScopes}
        initial={chosen.length > 0 ? 'selected' : allUnusedHere ? 'unused' : 'all'}
        note={batchNote}
      />
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="gap-0 p-7">
          <DialogTitle className="t-display text-[24px] leading-[28px]">{confirm && confirm.length > 1 ? `Cancel ${confirm.length} claim codes?` : 'Cancel this claim code?'}</DialogTitle>
          <DialogDescription className="mt-2 text-[15px] leading-[22px] text-body">
            {confirm && (
              <>
                {confirm.length > 1 ? 'They stop' : 'It stops'} working and {fmtBalance(sum(confirm))} returns to your wallet. The service fee isn’t refunded.
              </>
            )}
          </DialogDescription>
          {confirm && confirm.length > 1 && (
            <p className="mt-2 text-[13px] leading-5 text-caption">
              {confirm.length > 100 ? `${Math.ceil(confirm.length / 100)} transactions. ` : ''}Codes redeemed before this confirms are skipped.
            </p>
          )}
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button variant="soft" size="md" onClick={() => setConfirm(null)}>
              Keep {confirm && confirm.length > 1 ? 'codes' : 'code'}
            </Button>
            <Button
              size="md"
              onClick={() => {
                const list = confirm
                setConfirm(null)
                if (list) void cancelMany(list)
              }}
            >
              Cancel {confirm && confirm.length > 1 ? `${confirm.length} codes` : 'code'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The names these codes have renewed, newest first, from the vault's own Redeemed events. */
function RenewedNames({ rows }: { rows: Row[] }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = usePageSize('ens.codes:rows:renewals')
  const { copied, copy } = useCopyFeedback()

  const redeemed = rows.flatMap((r) => (r.redemption ? [{ order: r.order, amount: r.amount, redemption: r.redemption }] : []))
  redeemed.sort((a, b) => (a.redemption.block === b.redemption.block ? b.redemption.logIndex - a.redemption.logIndex : a.redemption.block < b.redemption.block ? 1 : -1))
  const renewals = redeemed.flatMap(({ order, amount, redemption }) => redemption.renewals.map((x, i) => ({ ...x, order, amount, redemption, key: `${redemption.tx}-${redemption.logIndex}-${i}` })))
  const names = new Set(renewals.map((r) => r.label)).size
  const current = Math.min(page, Math.max(0, Math.ceil(renewals.length / pageSize) - 1))
  const shown = renewals.slice(current * pageSize, (current + 1) * pageSize)

  return (
    <section className="ringed mt-10 overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 className="text-[14px] font-medium text-foreground">Renewed names</h2>
        {renewals.length > 0 && (
          <span className="text-[14px] text-caption">
            {renewals.length} renewal{renewals.length === 1 ? '' : 's'} · {names} name{names === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {renewals.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-caption">No names renewed yet.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Code used</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-10">Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="max-w-[220px] truncate pl-4 font-medium text-foreground">
                    <a href={`https://app.ens.domains/${r.label}.eth`} target="_blank" rel="noreferrer" className="hover:underline">
                      {r.label}.eth
                    </a>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums" title={`Onchain ID ${r.redemption.code}`}>
                    No. {r.order} <span className="text-caption">· {fmtUsdc(r.amount)}</span>
                  </TableCell>
                  <TableCell>{fmtDelivered(r.duration)}</TableCell>
                  <TableCell>{fmtDateSecs(r.redemption.at)}</TableCell>
                  <TableCell>
                    {EXPLORER_URL ? (
                      <a href={`${EXPLORER_URL}/tx/${r.redemption.tx}`} target="_blank" rel="noreferrer" className="inline-flex text-caption hover:text-foreground" aria-label={`View the ${r.label}.eth renewal transaction`} title="View transaction">
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <button type="button" className="inline-flex text-caption hover:text-foreground" aria-label={`Copy the ${r.label}.eth renewal transaction hash`} title="Copy transaction hash" onClick={() => void copy(r.redemption.tx)}>
                        {copied === r.redemption.tx ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager total={renewals.length} current={current} onPage={setPage} size={pageSize} onSize={(n) => (setPageSize(n), setPage(0))} noun="renewals" />
        </>
      )}
    </section>
  )
}

/**
 * Under a table: "1–10 of 34", a rows-per-page choice and page buttons. It shows once there are more
 * rows than the smallest page holds, so there is always a way back after choosing a bigger page.
 */
function Pager({
  total,
  current,
  onPage,
  size,
  onSize,
  noun,
  note,
}: {
  total: number
  current: number
  onPage: (n: number) => void
  size: number
  onSize: (n: number) => void
  /** What the rows are, plural: the control reads "Show 10 codes". */
  noun: string
  note?: string
}) {
  if (total <= PAGE_SIZES[0]) return null
  const pages = Math.ceil(total / size)
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule px-4 py-2.5 text-[14px] text-caption">
      <span>
        {current * size + 1}–{Math.min(total, (current + 1) * size)} of {total}
        {note && <span className="text-foreground"> · {note}</span>}
      </span>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          Show
          <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
            <SelectTrigger size="sm" aria-label={`${noun} per page`} className="h-7 w-[68px] rounded-pill border-0 bg-pill px-2.5 text-[14px] font-medium text-foreground shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {noun}
        </label>
        {pages > 1 && (
          <nav className="flex items-center gap-1" aria-label="Pages">
            <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={current === 0} onClick={() => onPage(current - 1)}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            {pageList(current, pages).map((n, i) =>
              n === null ? (
                <span key={`gap${i}`} className="px-1">
                  …
                </span>
              ) : (
                <Button key={n} variant={n === current ? 'soft' : 'ghost'} size="icon-sm" className="text-[14px]" aria-current={n === current ? 'page' : undefined} onClick={() => onPage(n)}>
                  {n + 1}
                </Button>
              ),
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={current >= pages - 1} onClick={() => onPage(current + 1)}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        )}
      </div>
    </div>
  )
}

/** A column header that sorts: the arrow sits after the label. */
function SortButton({ label, k, sort, onSort }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void }) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <button type="button" className={cn('inline-flex items-center gap-1 transition-colors hover:text-foreground', sort.key === k && 'text-foreground')} onClick={() => onSort(k)}>
      {label}
      <Icon className="size-3" aria-hidden="true" />
    </button>
  )
}

/** Page numbers to show: first, last, and the current one with its neighbours; null marks a gap. */
function pageList(current: number, pages: number): (number | null)[] {
  const keep = new Set([0, pages - 1, current - 1, current, current + 1].filter((n) => n >= 0 && n < pages))
  const out: (number | null)[] = []
  let prev = -1
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push(null)
    out.push(n)
    prev = n
  }
  return out
}
