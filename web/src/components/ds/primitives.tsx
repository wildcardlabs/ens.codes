import { CircleHelp, Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** One saturated hue per section: its eyebrow and its tick list share it. */
export type Hue = 'green' | 'orange' | 'blue' | 'gold' | 'pink' | 'purple' | 'red' | 'sky'
const HUE: Record<Hue, string> = {
  green: 'text-green',
  orange: 'text-orange',
  blue: 'text-blue',
  gold: 'text-gold',
  pink: 'text-pink',
  purple: 'text-purple',
  red: 'text-red',
  sky: 'text-sky',
}
export const hueText = (hue: Hue) => HUE[hue]

/** The 1024px column with 24px gutters. */
export function Wrap({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-[1072px] px-6', className)} {...props} />
}

/** 1px rule between sections inside the column. */
export const Rule = ({ className }: { className?: string }) => <hr className={cn('m-0 h-px border-0 bg-rule', className)} />

export function Eyebrow({ hue = 'blue', className, children }: { hue?: Hue; className?: string; children: ReactNode }) {
  return <p className={cn('t-eyebrow mb-3', HUE[hue], className)}>{children}</p>
}

const Tick = () => (
  <svg viewBox="0 0 17 13" className="h-[13px] w-[17px] shrink-0" aria-hidden="true">
    <path d="M1.5 6.5l5 5 9-10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Coloured tick list: 17px/500 in the section hue. */
export function TickList({ hue, items, two, className }: { hue: Hue; items: ReactNode[]; two?: boolean; className?: string }) {
  return (
    <ul className={cn('grid gap-x-3.5 gap-y-2.5', two && 'sm:grid-cols-2', HUE[hue], className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-4 text-[17px] font-medium tracking-[-0.01em]">
          <Tick />
          {item}
        </li>
      ))}
    </ul>
  )
}

/** Beige 12px panel. No border, no shadow. */
export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('panel', className)} {...props} />
}

/** The colours a split bar hands out, in order. */
export const SPLIT_COLORS = ['var(--green)', 'var(--app-blue)', 'var(--purple)', 'var(--pink)', 'var(--yellow)']

export type Segment = { key: string; label: ReactNode; detail?: ReactNode; value: number; color: string }

/**
 * A whole divided into parts: one rounded bar, one segment per part, a legend underneath. It makes
 * "the parts always add up to the whole" visible, for a code split across names or a batch of codes
 * by status.
 */
export function SplitBar({ segments, legend = true, className }: { segments: Segment[]; legend?: boolean; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div className={className}>
      <div className="flex h-3 gap-[3px] overflow-hidden rounded-full bg-pill" role="img" aria-label="Breakdown">
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => <span key={s.key} className="h-full min-w-1.5 transition-[flex-grow] duration-200 ease-flavor" style={{ flexGrow: s.value, flexBasis: 0, background: s.color }} />)}
      </div>
      {legend && (
        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          {segments.map((s) => (
            <li key={s.key} className="flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              <span className="truncate font-medium text-foreground">{s.label}</span>
              {s.detail !== undefined && <span className="whitespace-nowrap text-caption">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A round token: an initial or emoji on a hue. */
export function Token({ color, size = 36, className, children }: { color: string; size?: number; className?: string; children: ReactNode }) {
  return (
    <i
      className={cn('grid flex-none place-items-center rounded-full font-sans text-[13px] font-semibold not-italic text-background', className)}
      style={{ width: size, height: size, background: color }}
    >
      {children}
    </i>
  )
}

/** Small "?" with a tooltip. */
export function Hint({ label, text }: { label: string; text: string }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={label} className="inline-flex text-caption transition-colors hover:text-foreground">
            <CircleHelp className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-[13px] leading-5">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * A form field: one bordered row holding a prefix, the input and anything after it.
 * Put a real <input> (or <button>) inside; the row draws the focus and error states.
 */
export function Field({ invalid, className, ...props }: ComponentProps<'div'> & { invalid?: boolean }) {
  return (
    <div
      data-invalid={invalid || undefined}
      className={cn(
        'flex h-12 items-center gap-2 rounded-xl bg-background px-3.5 text-[16px] text-foreground shadow-[inset_0_0_0_1px_var(--border)] transition-shadow duration-100',
        'focus-within:shadow-[inset_0_0_0_2px_var(--foreground)] data-[invalid]:shadow-[inset_0_0_0_2px_var(--red)]',
        '[&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:outline-none [&_input]:placeholder:text-caption [&_input:disabled]:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-[14px] font-medium text-heading', className)} {...props} />
}

/** Status pill: a coloured dot and a quiet label. */
export function StatusPill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="ringed inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-0.5 text-[12px] font-medium text-foreground">
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Label / value rows inside a panel. */
export function Rows({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid gap-2 text-[14px]', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <dt className="text-caption">{k}</dt>
          <dd className="text-right font-medium text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The big action at the bottom of a form: a black pill, or a spinner with the current step. */
export function ActionButton({ label, action, busy, className }: { label: string; action?: () => void; busy?: boolean; className?: string }) {
  return (
    <Button size="lg" className={cn('mt-5 w-full justify-center px-6', className)} disabled={!action || busy} onClick={action}>
      {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </Button>
  )
}

/** App page heading: title with a full stop, optional one-line lede. */
export function PageTitle({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <header className={cn('mb-8', className)}>
      <h1 className="t-page">{title}</h1>
      {children && <p className="mt-2 text-[17px] leading-[26px] tracking-[-0.01em] text-body">{children}</p>}
    </header>
  )
}
