import type { ReactNode, SVGProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Stickers: flat fills, no outlines, no gradients, at most a glare stripe.
 *
 * Each one has a single job, so it carries meaning wherever it appears:
 *   Ticky  a claim code
 *   Bean   a name that just got more time
 *   Coin   value (USDC)
 *   Key    your wallet and its signature
 *   Vault  the contract that holds a code's value
 *   Seal   done and confirmed onchain
 * Star and Spark are confetti and mean nothing.
 */
type StickerProps = SVGProps<SVGSVGElement> & { size?: number }

const svg = (viewBox: string, children: ReactNode) =>
  function Sticker({ size = 64, className, ...props }: StickerProps) {
    return (
      <svg viewBox={viewBox} width={size} height={size} aria-hidden="true" className={cn('block shrink-0', className)} {...props}>
        {children}
      </svg>
    )
  }

const eyes = (cx1: number, cx2: number, cy: number, rx = 6, ry = 9) => (
  <>
    <ellipse cx={cx1} cy={cy} rx={rx} ry={ry} fill="var(--heading)" />
    <ellipse cx={cx2} cy={cy} rx={rx} ry={ry} fill="var(--heading)" />
  </>
)

/** Value. Gold coin with two diagonal glare bars. */
export const Coin = svg(
  '0 0 60 60',
  <>
    <ellipse cx="32" cy="33" rx="26" ry="25" fill="var(--gold)" />
    <ellipse cx="29" cy="29" rx="26" ry="25" fill="var(--yellow)" />
    <path d="M12 16l30 30M20 9l30 30" stroke="var(--background)" strokeOpacity=".45" strokeWidth="7" />
  </>,
)

/** A claim code: a notched sky ticket with a square blue face. */
export const Ticky = svg(
  '0 0 200 160',
  <>
    <path
      d="M24 8h152a16 16 0 0 1 16 16v32a24 24 0 0 0 0 48v32a16 16 0 0 1-16 16H24a16 16 0 0 1-16-16v-32a24 24 0 0 0 0-48V24A16 16 0 0 1 24 8z"
      fill="var(--sky)"
    />
    <rect x="58" y="36" width="88" height="88" rx="10" fill="var(--app-blue)" transform="rotate(-6 102 80)" />
    {eyes(86, 118, 80, 7, 10)}
    <path d="M34 26l22 22M46 20l14 14" stroke="var(--background)" strokeOpacity=".35" strokeWidth="7" strokeLinecap="round" />
  </>,
)

/** A name that just got more time: green, happy, eyes closed in two arches (the same arch as the mark's wink). */
export const Bean = svg(
  '0 0 160 190',
  <>
    <path d="M80 6c44 0 70 38 70 90s-26 88-70 88-70-36-70-88S36 6 80 6z" fill="var(--green)" transform="rotate(8 80 95)" />
    <path d="M52 93q11 -11 22 0M90 89q11 -11 22 0" stroke="var(--heading)" strokeWidth="6" fill="none" strokeLinecap="round" />
    <path d="M44 44l18-14" stroke="var(--background)" strokeOpacity=".35" strokeWidth="9" strokeLinecap="round" />
  </>,
)

/** Your wallet and its signature. */
export const Key = svg(
  '0 0 90 44',
  <>
    <circle cx="22" cy="22" r="20" fill="var(--pink)" />
    <circle cx="22" cy="22" r="8" fill="var(--background)" />
    <rect x="38" y="16" width="48" height="12" rx="6" fill="var(--pink)" />
    <rect x="62" y="24" width="9" height="14" rx="4" fill="var(--pink)" />
    <rect x="76" y="24" width="9" height="11" rx="4" fill="var(--pink)" />
  </>,
)

/** The contract that holds a code's value: a box with a coin slot. */
export const Vault = svg(
  '0 0 120 110',
  <>
    <rect x="8" y="26" width="104" height="78" rx="14" fill="var(--blue)" />
    <rect x="2" y="12" width="116" height="30" rx="12" fill="var(--sky)" />
    <rect x="40" y="22" width="40" height="9" rx="4.5" fill="var(--heading)" />
    <path d="M22 58l22 22M34 54l14 14" stroke="var(--background)" strokeOpacity=".3" strokeWidth="7" strokeLinecap="round" />
  </>,
)

/** Done and confirmed: a scalloped green seal with a tick, like the stamp on a certificate. */
export const Seal = svg(
  '0 0 100 100',
  <>
    <g fill="var(--green)">
      <circle cx="50" cy="50" r="40" />
      <circle cx="87.0" cy="50.0" r="11.5" /><circle cx="82.0" cy="68.5" r="11.5" /><circle cx="68.5" cy="82.0" r="11.5" /><circle cx="50.0" cy="87.0" r="11.5" /><circle cx="31.5" cy="82.0" r="11.5" /><circle cx="18.0" cy="68.5" r="11.5" /><circle cx="13.0" cy="50.0" r="11.5" /><circle cx="18.0" cy="31.5" r="11.5" /><circle cx="31.5" cy="18.0" r="11.5" /><circle cx="50.0" cy="13.0" r="11.5" /><circle cx="68.5" cy="18.0" r="11.5" /><circle cx="82.0" cy="31.5" r="11.5" />
    </g>
    <path d="M30 26l16 16M41 20l10 10" stroke="var(--background)" strokeOpacity=".3" strokeWidth="6" strokeLinecap="round" />
    <path d="M33 52l12 12 23-26" fill="none" stroke="var(--background)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
  </>,
)

export const Star = svg('0 0 20 20', <path d="M10 1l2.6 6 6.4.6-4.8 4.3 1.4 6.3L10 15l-5.6 3.2 1.4-6.3L1 7.6 7.4 7z" fill="currentColor" />)

export const Spark = svg('0 0 20 20', <path d="M10 0c1 6 4 9 10 10-6 1-9 4-10 10C9 14 6 11 0 10c6-1 9-4 10-10z" fill="currentColor" />)
