/* Formatters. Amounts are 6dp USDC units. */

export const YEAR_SECONDS = 31_536_000n
const MONTH_SECONDS = YEAR_SECONDS / 12n
const DAY = 86_400n

export function fmtDate(ms: number | bigint): string {
  return new Date(Number(ms)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Unix seconds to a date. */
export const fmtDateSecs = (secs: bigint | number) => fmtDate(Number(secs) * 1000)

/** Whole-dollar when exact, else 2dp. */
export function fmtUsdc(micro: bigint): string {
  const cents = (micro + 5_000n) / 10_000n
  const whole = cents / 100n
  const fraction = (cents % 100n).toString().padStart(2, '0')
  return `$${whole.toLocaleString('en-US')}${fraction === '00' ? '' : `.${fraction}`}`
}

/** Always 2dp, rounded down: for balances, so a code never shows more than it holds. */
export function fmtBalance(micro: bigint): string {
  const cents = micro / 10_000n
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`
}

/** Rounded up to the cent: for thresholds, so "$27.01" really reaches the tier. */
export function fmtUsdcCeil(micro: bigint): string {
  const cents = (micro + 9_999n) / 10_000n
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`
}

/** Every micro-unit, where the exact amount decides something. */
export function fmtUsdcExact(micro: bigint): string {
  const whole = micro / 1_000_000n
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `$${whole.toLocaleString('en-US')}.${frac.padEnd(2, '0')}`
}

/**
 * "9 days" · "8 months" · "4 years 6 months". Whole months, and a length within a day of the next
 * whole month counts as that month: ENS prices by the second, so a round amount often buys a little
 * less than a round length, and "1 year 11 months" for two years less a few seconds reads as a
 * month gone missing.
 *
 * `daysBelow` keeps short lengths in days: with 90, anything under 90 days reads "45 days", not
 * "1 month".
 */
export function fmtDelivered(seconds: bigint, daysBelow = 0): string {
  if (seconds < DAY) {
    const hours = seconds / 3_600n
    return hours > 0n ? `${hours} hour${hours === 1n ? '' : 's'}` : `${seconds} second${seconds === 1n ? '' : 's'}`
  }
  const months = ((seconds + DAY) * 12n) / YEAR_SECONDS
  if (months === 0n || seconds < BigInt(daysBelow) * DAY) {
    const days = (seconds + DAY / 2n) / DAY
    return `${days} day${days === 1n ? '' : 's'}`
  }
  const y = months / 12n
  const m = months % 12n
  const yPart = `${y} year${y === 1n ? '' : 's'}`
  const mPart = `${m} month${m === 1n ? '' : 's'}`
  return y === 0n ? mPart : m > 0n ? `${yPart} ${mPart}` : yPart
}

/** Day-accurate: "4 years, 6 months, 11 days". Rounded to the nearest day, never up to a month. */
export function fmtDurationPrecise(seconds: bigint): string {
  if (seconds < DAY) return 'less than a day'
  const whole = ((seconds + DAY / 2n) / DAY) * DAY
  const years = whole / YEAR_SECONDS
  const afterYears = whole % YEAR_SECONDS
  const months = afterYears / MONTH_SECONDS
  const days = (afterYears % MONTH_SECONDS) / DAY
  const parts: string[] = []
  if (years) parts.push(`${years} year${years === 1n ? '' : 's'}`)
  if (months) parts.push(`${months} month${months === 1n ? '' : 's'}`)
  if (days) parts.push(`${days} day${days === 1n ? '' : 's'}`)
  return parts.join(', ')
}

export const truncAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** "25", "2.50", "$10" → USDC units; null when not a plain amount. */
export function parseUsdc(input: string): bigint | null {
  const m = input.trim().replace(/^\$/, '').replace(/,/g, '').match(/^(\d+)(?:\.(\d{0,6}))?$/)
  if (!m) return null
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))
}

/**
 * Cleans what is typed into an amount field: digits and one decimal point, at most 6 decimals
 * (USDC's precision). "$1,234.5678901" becomes "1234.567890".
 */
export function cleanAmount(raw: string): string {
  const s = raw.replace(/[^0-9.]/g, '')
  const dot = s.indexOf('.')
  if (dot === -1) return s
  return `${s.slice(0, dot)}.${s.slice(dot + 1).replace(/\./g, '').slice(0, 6)}`
}

/** USDC units to an input value: "25", "24.99". */
export function toInput(micro: bigint): string {
  const s = fmtUsdcExact(micro).slice(1).replace(/,/g, '')
  return s.endsWith('.00') ? s.slice(0, -3) : s
}
