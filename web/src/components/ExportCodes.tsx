import { FileSpreadsheet, Images, Loader2, Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Qr } from '@/components/ds/Qr'
import { Wordmark } from '@/components/ds/Wordmark'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { redeemLink } from '@/lib/code'
import { SITE_HOST } from '@/lib/config'
import { csvOf, type ExportItem, imagesZip } from '@/lib/export'
import { fmtUsdc } from '@/lib/format'
import { download } from '@/lib/share'
import { errorMessage } from '@/lib/util'
import { cn } from '@/lib/utils'

/**
 * Taking many codes out at once. Two questions, in the order a distributor thinks of them: which
 * codes, and in what form. The forms cover the three ways codes get handed out: a spreadsheet for
 * mail merges and tracking, vouchers to print and cut, and pictures to send one by one.
 */

/** A set of codes the person can choose to export, e.g. the unused ones. */
export type ExportScope = { key: string; label: string; items: ExportItem[] }

type Format = 'csv' | 'vouchers' | 'images'
type Paper = 'a4' | 'letter'
/** Sheets of ten to cut along crop marks, the same sheets bare (perforated card stock), or one card per page with bleed for a print shop. */
type Layout = 'marks' | 'plain' | 'single'

const FORMATS: { key: Format; icon: typeof Printer; title: string; body: string }[] = [
  { key: 'csv', icon: FileSpreadsheet, title: 'Spreadsheet', body: 'A CSV with each code, its link, value and number.' },
  { key: 'vouchers', icon: Printer, title: 'Printable vouchers', body: 'Card size. Sheets to cut, or one per page for a print shop.' },
  { key: 'images', icon: Images, title: 'Images', body: 'One picture per code, in a ZIP.' },
]

/** US Letter where it is the everyday paper, A4 everywhere else. */
const defaultPaper = (): Paper => (/^(en-US|en-CA|fr-CA|es-US|es-MX)$/i.test(navigator.language) ? 'letter' : 'a4')

const PER_PAGE = 10

const LAYOUTS: { key: Layout; label: string }[] = [
  { key: 'marks', label: 'Crop marks' },
  { key: 'plain', label: 'No marks' },
  { key: 'single', label: 'One per page' },
]

/** Safari is the one browser that may not make the page the size of the card. */
const isSafari = () => /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent)

function layoutHint(layout: Layout, paper: Paper): string {
  if (layout === 'marks') return 'Cut along the marks. Print at 100% scale.'
  if (layout === 'plain') return 'For perforated card sheets. Print at 100% scale.'
  if (isSafari()) return 'Safari may ignore the card page size. Use Chrome or Firefox for this one.'
  return `For print shops: ${paper === 'a4' ? '3 mm' : '0.125 in'} bleed on every side. Save as PDF.`
}

/** The paper the printer is told to use: a full sheet, or the card plus its bleed. */
function pageSize(layout: Layout, paper: Paper): string {
  if (layout === 'single') return paper === 'a4' ? '91mm 61mm' : '3.75in 2.25in'
  return paper === 'a4' ? 'A4 portrait' : 'letter portrait'
}

export function ExportDialog({
  open,
  onOpenChange,
  scopes,
  initial,
  note,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The sets to choose from; empty ones are not offered. */
  scopes: ExportScope[]
  /** Which set is chosen when the dialog opens. */
  initial?: string
  /** A line under the title, e.g. which purchase the sets are limited to. */
  note?: string
}) {
  const offered = scopes.filter((s) => s.items.length > 0)
  const [scopeKey, setScopeKey] = useState(initial)
  const [format, setFormat] = useState<Format>('csv')
  const [paper, setPaper] = useState<Paper>(defaultPaper)
  const [layout, setLayout] = useState<Layout>('marks')
  const [busy, setBusy] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ items: ExportItem[]; paper: Paper; layout: Layout } | null>(null)

  useEffect(() => {
    if (open) setScopeKey(initial)
  }, [open, initial])
  // Read through a ref, so a new callback from the parent doesn't restart a print in progress.
  const close = useRef(onOpenChange)
  close.current = onOpenChange

  const scope = offered.find((s) => s.key === scopeKey) ?? offered[0]
  const items = scope?.items ?? []
  const n = items.length

  // Printing: put the sheet on the page, hide everything else from the printer, open the print
  // dialog, and take it all away again when that closes.
  useEffect(() => {
    if (!sheet) return
    const page = document.createElement('style')
    page.textContent = `@page { size: ${pageSize(sheet.layout, sheet.paper)}; margin: 0 }`
    document.head.appendChild(page)
    document.documentElement.classList.add('printing-vouchers')
    let live = true
    const finish = () => {
      if (!live) return
      live = false
      setSheet(null)
      close.current(false)
    }
    window.addEventListener('afterprint', finish)
    // The fonts and the QR codes have to be on the page before the printer takes its picture.
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => live && window.print())))
    return () => {
      live = false
      window.removeEventListener('afterprint', finish)
      page.remove()
      document.documentElement.classList.remove('printing-vouchers')
    }
  }, [sheet])

  async function run() {
    if (n === 0 || busy) return
    try {
      if (format === 'csv') {
        download(new Blob([csvOf(items)], { type: 'text/csv' }), 'ens-codes.csv')
        onOpenChange(false)
      } else if (format === 'images') {
        setBusy(`Drawing 1 of ${n}…`)
        const blob = await imagesZip(items, (done) => setBusy(done < n ? `Drawing ${done + 1} of ${n}…` : 'Packing…'))
        download(blob, 'ens-codes.zip')
        onOpenChange(false)
      } else {
        setSheet({ items, paper, layout })
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const action = format === 'csv' ? 'Download CSV' : format === 'vouchers' ? `Print ${n} ${n === 1 ? 'voucher' : 'vouchers'}` : `Download ${n} ${n === 1 ? 'image' : 'images'}`

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent className="gap-0 p-7">
          <DialogTitle className="t-display text-[24px] leading-[28px]">Export codes</DialogTitle>
          <DialogDescription className={cn('mt-2 text-[14px] leading-5 text-caption', !note && 'sr-only')}>{note ?? 'Choose which codes and in what form.'}</DialogDescription>

          {offered.length > 1 && (
            <fieldset className="mt-5">
              <legend className="text-[14px] font-medium text-heading">Which codes</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {offered.map((s) => (
                  <Button key={s.key} variant={s.key === scope?.key ? 'default' : 'soft'} size="md" className="px-4" aria-pressed={s.key === scope?.key} disabled={!!busy} onClick={() => setScopeKey(s.key)}>
                    {s.label}
                    <span className={s.key === scope?.key ? 'opacity-70' : 'text-caption'}>{s.items.length}</span>
                  </Button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="mt-5">
            <legend className="text-[14px] font-medium text-heading">Format</legend>
            <div className="mt-2 grid gap-2">
              {FORMATS.map((f) => {
                const on = f.key === format
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={on}
                    disabled={!!busy}
                    onClick={() => setFormat(f.key)}
                    className={cn(
                      'flex items-center gap-3.5 rounded-xl px-4 py-3 text-left transition-shadow duration-100 disabled:opacity-60',
                      on ? 'bg-background shadow-[inset_0_0_0_2px_var(--foreground)]' : 'bg-card shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--caption)]',
                    )}
                  >
                    <f.icon className="size-5 shrink-0 text-heading" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-foreground">{f.title}</span>
                      <span className="block text-[13px] leading-[18px] text-caption">{f.body}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {format === 'vouchers' && (
            <div className="mt-4 grid gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex gap-1.5">
                  {LAYOUTS.map((l) => (
                    <Button key={l.key} variant={l.key === layout ? 'default' : 'soft'} size="sm" aria-pressed={l.key === layout} onClick={() => setLayout(l.key)}>
                      {l.label}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {(['a4', 'letter'] as const).map((p) => (
                    <Button key={p} variant={p === paper ? 'default' : 'soft'} size="sm" aria-pressed={p === paper} onClick={() => setPaper(p)}>
                      {layout === 'single' ? (p === 'a4' ? '85 × 55 mm' : '3.5 × 2 in') : p === 'a4' ? 'A4' : 'US Letter'}
                    </Button>
                  ))}
                </div>
              </div>
              <span className="text-[13px] leading-[18px] text-caption">{layoutHint(layout, paper)}</span>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button variant="soft" size="md" disabled={!!busy} onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button size="md" disabled={n === 0 || !!busy} onClick={() => void run()}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" /> {busy}
                </>
              ) : (
                action
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {sheet && createPortal(<VoucherSheet items={sheet.items} paper={sheet.paper} layout={sheet.layout} />, document.body)}
    </>
  )
}

/** How far the crop marks stand off the cards, and so how far past them a mark's far end is. */
const GAP = '2mm'
const REACH = '5mm'

/** A tick in the margin for every cut: above and below each column edge, left and right of each row edge. */
function CropMarks({ cols, rows }: { cols: number; rows: number }) {
  const x = (n: number) => `calc(var(--voucher-w) * ${n})`
  const y = (n: number) => `calc(var(--voucher-h) * ${n})`
  const marks: { dir: 'v' | 'h'; left: string; top: string }[] = []
  for (let c = 0; c <= cols; c++) {
    marks.push({ dir: 'v', left: x(c), top: `-${REACH}` }, { dir: 'v', left: x(c), top: `calc(${y(rows)} + ${GAP})` })
  }
  for (let r = 0; r <= rows; r++) {
    marks.push({ dir: 'h', left: `-${REACH}`, top: y(r) }, { dir: 'h', left: `calc(${x(cols)} + ${GAP})`, top: y(r) })
  }
  return (
    <>
      {marks.map((m, i) => (
        <span key={i} className="voucher-crop" data-dir={m.dir} style={{ left: m.left, top: m.top }} />
      ))}
    </>
  )
}

/**
 * The pages the printer sees. As sheets: vouchers ten to a page, two across, edge to edge, with
 * crop marks in the margins unless the paper is already cut. For a print shop: one voucher a page.
 */
function VoucherSheet({ items, paper, layout }: { items: ExportItem[]; paper: Paper; layout: Layout }) {
  const perPage = layout === 'single' ? 1 : PER_PAGE
  const pages: ExportItem[][] = []
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage))
  return (
    <div className="voucher-print">
      {pages.map((page, i) => (
        <div key={i} className="voucher-page" data-paper={paper} data-layout={layout}>
          <div className="voucher-grid">
            {layout === 'marks' && <CropMarks cols={Math.min(2, page.length)} rows={Math.ceil(page.length / 2)} />}
            {page.map((item) => (
              <div key={item.code} className="voucher">
                <div className="voucher-top">
                  <div>
                    <Wordmark className="voucher-mark" />
                    <div className="voucher-caption">Claim code for ENS renewals</div>
                    <div className="voucher-value">{fmtUsdc(item.amount)}</div>
                  </div>
                  <Qr value={redeemLink(item.code)} label={`QR code for voucher ${item.number}`} className="voucher-qr" />
                </div>
                <div>
                  <div className="voucher-code">{item.code}</div>
                  <div className="voucher-foot">
                    <span>Redeem at {SITE_HOST}/redeem</span>
                    <span>No. {item.number}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
