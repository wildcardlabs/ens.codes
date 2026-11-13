import { MARK_BOX, MARK_PATH } from '@/lib/mark'
import { cn } from '@/lib/utils'

/** The mark: a tilted ticket that winks. Its eyes are holes, so the surface behind shows through them. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.width} ${MARK_BOX.height}`}
      className={cn('h-[18px] w-auto shrink-0', className)}
      style={{ aspectRatio: `${MARK_BOX.width} / ${MARK_BOX.height}` }}
      aria-hidden="true"
    >
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

/**
 * Mark and name. Sizes are in em, so setting a font size scales the whole thing.
 *
 * The mark is centred on the middle of the lowercase letters (the x-height of "ens"), not on the
 * line box, which sits higher because it also makes room for ascenders. For Plus Jakarta Sans that
 * middle is 0.125em below the line's centre.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[0.36em] font-display text-[18px] font-semibold leading-none tracking-[-0.02em] text-heading', className)}>
      <Mark className="h-[1.3em] translate-y-[0.125em]" />
      {/* Set 1px low by eye: beside the mark and the menu, the letters read as sitting high otherwise. */}
      <span className="translate-y-px">ens.codes</span>
    </span>
  )
}

/**
 * ENS's mark in the site's own ink, drawn from the logo file as a mask so it takes the text colour.
 *
 * It is a tall shape, so it is sized and placed against the letters it sits beside, not the line
 * box: 0.9em tall and centred between the baseline and the top of the tall letters (for Plus Jakarta
 * Sans that is 0.043em below the line's centre). It then reaches as high as the "d" in ens.codes and
 * rests just below the baseline, the same as the ticket in the site's own mark.
 */
export function EnsMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="ENS"
      className={cn('inline-block h-[0.9em] w-[0.79em] shrink-0 translate-y-[0.043em] bg-heading', className)}
      style={{ mask: 'url(/logos/ens.svg) center / contain no-repeat', WebkitMask: 'url(/logos/ens.svg) center / contain no-repeat' }}
    />
  )
}

/**
 * For the link that wraps the wordmark in a header. It centres the wordmark in the row, then lifts
 * it 2px so its letters sit on the same baseline as the 15px menu items and buttons beside it (the
 * 18px display face has a deeper baseline than 15px Inter when both are centred).
 */
export const WORDMARK_IN_HEADER = 'flex items-center -translate-y-[2px]'
