import type { ReactNode } from 'react'
import { parse } from '@/lib/code'
import { fmtUsdc } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Qr } from './Qr'
import { EnsMark, Wordmark } from './Wordmark'

const BLANK = 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX'

/**
 * A claim code drawn as a paper ticket: stone paper, punched notches (holes cut by `ticket-notched`'s mask), the value in the display face
 * and the code on a white strip. It is the product's one recurring object, so it doubles as an input:
 * `value` replaces the amount (Buy lets you write it in) and `strip` replaces the code (the home page
 * lets you type one). `count` > 1 peeks more tickets behind; `stamp` marks it used; `qr` adds a QR
 * code of a link beside the value, as on the downloaded ticket. The paper has a satin finish; `shimmer`
 * adds a faint band of light that drifts slowly across it.
 */
export function CodeTicket({
  amount,
  code,
  caption,
  value,
  strip,
  footnote,
  count = 1,
  stamp,
  qr,
  ens = true,
  fill,
  tall,
  shimmer = true,
  className,
}: {
  amount?: bigint | null
  code?: string | null
  caption?: ReactNode
  value?: ReactNode
  strip?: ReactNode
  footnote?: ReactNode
  count?: number
  stamp?: string
  /** A link to show as a QR code beside the value. */
  qr?: string
  /** Show ENS's mark in the corner. Off for the small tickets in "How it works". */
  ens?: boolean
  /** On wide screens, take the height of the row instead of the ticket's own proportions. */
  fill?: boolean
  /** On wide screens, a slightly taller ticket: it sits beside a form and should start no shorter than it. */
  tall?: boolean
  /** The slow band of light. Off for the small tickets in "How it works". */
  shimmer?: boolean
  className?: string
}) {
  // A complete, valid code (X is a real code character, so placeholders can't be told apart by it).
  const real = !!code && parse(code).ok
  return (
    <div className={cn('@container relative w-full', fill && 'lg:h-full', className)}>
      {/* The cards behind are polished metal, platinum then graphite, without notches. Their position and finish are
          `ticket-behind` in index.css. */}
      {count > 2 && <div className="ticket-behind ticket-behind-2" aria-hidden="true" />}
      {count > 1 && <div className="ticket-behind ticket-behind-1" aria-hidden="true" />}
      <div
        className={cn('ticket-paper ticket-notched @container relative flex aspect-[1.62] flex-col justify-between overflow-clip rounded-[22px] bg-stone p-[6.5%] text-foreground', tall && 'lg:aspect-[1.45]', fill && 'lg:aspect-auto lg:h-full')}
      >
        {/* Under everything else, so it never crosses the code or the QR. */}
        {shimmer && <span className="ticket-sheen print:hidden" aria-hidden="true" />}

        <div className="relative flex items-center justify-between">
          <Wordmark className="text-[clamp(13px,4.6cqw,19px)]" />
          {/* What the code is for: ENS's own mark, on every ticket. */}
          <span className="flex items-center gap-[2.5cqw] text-[clamp(13px,4.6cqw,19px)] leading-none">
            {count > 1 && <span className="rounded-pill bg-background px-[3cqw] py-[1cqw] text-[clamp(11px,3.4cqw,14px)] font-semibold text-heading">× {count}</span>}
            {ens && <EnsMark />}
          </span>
        </div>

        <div className="relative flex items-center justify-between gap-[4cqw]">
          <div className="min-w-0 flex-1">
            <div className="text-[clamp(11px,3.4cqw,14px)] font-semibold tracking-[-0.01em] text-gold">{caption ?? 'Claim code for ENS renewals'}</div>
            <div className="t-display text-[clamp(34px,15cqw,64px)] leading-[1.05] text-heading">{value ?? (amount ? fmtUsdc(amount) : '$—')}</div>
          </div>
          {qr && <Qr value={qr} label="QR code of the redeem link" className="w-[26cqw] shrink-0 rounded-[2cqw] p-[1.7cqw]" />}
        </div>

        <div className="relative">
          {strip ?? (
            <div
              className={cn('t-code rounded-md bg-background px-[3%] py-[2.2%] text-center text-[clamp(9px,3.5cqw,15px)]', real ? 'text-foreground' : 'text-caption')}
              aria-label={real ? code! : undefined}
            >
              {code || BLANK}
            </div>
          )}
          {footnote && <div className="mt-[2.5%] text-center text-[clamp(10px,3cqw,13px)] text-caption">{footnote}</div>}
        </div>

        {stamp && (
          <span
            className="absolute right-[7%] top-[30%] rotate-[-14deg] rounded-md border-[3px] border-red px-[3cqw] py-[0.6cqw] font-display text-[clamp(14px,6cqw,26px)] font-semibold tracking-[-0.02em] text-red"
            aria-hidden="true"
          >
            {stamp}
          </span>
        )}
      </div>
    </div>
  )
}
