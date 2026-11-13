import { type Address, getAddress, type Hex, type WalletClient } from 'viem'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { type Day, MAX_SESSION, SIGN_IN_STATEMENT, type Stats } from '../../../api/_lib/statsShared'
import { CHAIN_ID } from './config'
import { ensureChainFor } from './wallet'

export type { Activity, Bucket, Buyer, Day, Stats } from '../../../api/_lib/statsShared'

/**
 * The dashboard's sign-in and its numbers.
 *
 * Signing in is one Sign-In with Ethereum message. The signed message is the session: it is sent
 * with every request, the server checks it each time, and it stops working when it expires. It is a
 * different message from the one that unlocks a wallet's codes, and it can't stand in for it.
 */
export type Session = { address: Address; message: string; signature: Hex; expires: number }

const KEY = 'ens.codes:dashboard'

export function savedSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null
    if (s && typeof s.message === 'string' && typeof s.signature === 'string' && s.expires * 1000 > Date.now()) return s
  } catch {
    // Unreadable or storage is off: signed out.
  }
  return null
}

export function signOut() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing was kept.
  }
}

export async function signIn(wallet: WalletClient, address: Address): Promise<Session> {
  await ensureChainFor(wallet)
  const now = Date.now()
  const expires = Math.floor(now / 1000) + MAX_SESSION
  const message = createSiweMessage({
    domain: window.location.host,
    uri: window.location.origin,
    address: getAddress(address),
    chainId: CHAIN_ID,
    version: '1',
    statement: SIGN_IN_STATEMENT,
    nonce: generateSiweNonce(),
    issuedAt: new Date(now),
    expirationTime: new Date(expires * 1000),
  })
  const signature = await wallet.signMessage({ account: address, message })
  const session = { address: getAddress(address), message, signature, expires }
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // Storage is off: the sign-in lasts until the page is closed.
  }
  return session
}

/** `sign_in`: the session is missing or over. `forbidden`: this wallet isn't the owner's. */
export class DashboardError extends Error {
  constructor(readonly kind: 'sign_in' | 'forbidden' | 'unavailable') {
    super(kind)
  }
}

export async function loadStats(session: Session): Promise<Stats> {
  let res: Response
  try {
    res = await fetch('/api/stats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: session.message, signature: session.signature }),
    })
  } catch {
    throw new DashboardError('unavailable')
  }
  if (res.status === 401) throw new DashboardError('sign_in')
  if (res.status === 403) throw new DashboardError('forbidden')
  if (!res.ok) throw new DashboardError('unavailable')
  return (await res.json()) as Stats
}

// ------------------------------------------------------------------------------------ periods

export type Range = '7d' | '30d' | '90d' | 'all'
export const RANGES: { value: Range; label: string; days: number | null }[] = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: 'all', label: 'All time', days: null },
]

/** Quiet days added in front, so a young vault still fills the period it is shown in. */
function padded(days: Day[], length: number): Day[] {
  if (days.length === 0 || days.length >= length) return days
  const first = Date.parse(`${days[0].day}T00:00:00Z`)
  const front: Day[] = []
  for (let i = length - days.length; i >= 1; i--) front.push({ day: new Date(first - i * 86_400_000).toISOString().slice(0, 10), ...ZERO })
  return [...front, ...days]
}

/**
 * A period: its days, the same number of days just before it (null when the vault isn't old enough
 * to have a full "before"), and every day up to its end.
 */
export function period(days: Day[], range: Range): { all: Day[]; now: Day[]; before: Day[] | null } {
  const n = RANGES.find((r) => r.value === range)!.days
  if (n === null) return { all: days, now: days, before: null }
  const all = padded(days, n)
  // Only compare against a full period: half of one would make everything look like growth.
  return { all, now: all.slice(-n), before: days.length >= 2 * n ? days.slice(-2 * n, -n) : null }
}

export type Totals = Omit<Day, 'day'>
const ZERO: Totals = { purchases: 0, codes: 0, sold: 0, fees: 0, newBuyers: 0, redeemed: 0, relayed: 0, names: 0, seconds: 0, spent: 0, change: 0, cancelled: 0, cancelledValue: 0 }

export function totals(days: Day[]): Totals {
  const sum = { ...ZERO }
  for (const d of days) for (const k of Object.keys(ZERO) as (keyof Totals)[]) sum[k] += d[k]
  return sum
}

/** Change against the period before, as a fraction. Null when there is nothing to compare with. */
export const change = (now: number, before: number | undefined): number | null => (before === undefined || before === 0 ? null : (now - before) / before)

export type Point = { key: string; label: string } & Totals & { boughtTotal: number; redeemedTotal: number; cancelledTotal: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-11-03" as "3 Nov". */
export const dayLabel = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`

/**
 * A period as points for a chart: one per day, or one per week once there are more than about
 * three months of them. Each point also carries the running totals of codes since the vault's
 * first day, so a line of them shows how far apart buying and redeeming are.
 */
export function series(all: Day[], shown: Day[]): { points: Point[]; weekly: boolean } {
  const weekly = shown.length > 100
  const start = all.length - shown.length
  const running = totals(all.slice(0, start))
  let bought = running.codes
  let redeemed = running.redeemed
  let cancelled = running.cancelled
  const points: Point[] = []
  for (let i = 0; i < shown.length; i += weekly ? 7 : 1) {
    const chunk = shown.slice(i, i + (weekly ? 7 : 1))
    const t = totals(chunk)
    bought += t.codes
    redeemed += t.redeemed
    cancelled += t.cancelled
    points.push({ key: chunk[0].day, label: weekly ? `Week of ${dayLabel(chunk[0].day)}` : dayLabel(chunk[0].day), ...t, boughtTotal: bought, redeemedTotal: redeemed, cancelledTotal: cancelled })
  }
  return { points, weekly }
}

// ---------------------------------------------------------------------------------- formatting

/** 0.1234 as "12%", small ones as "0.4%". */
export const fmtPercent = (fraction: number) => `${Math.abs(fraction) < 0.1 && fraction !== 0 ? (fraction * 100).toFixed(1) : Math.round(fraction * 100)}%`

/** Wei as ETH with up to four decimals: "0.1042 ETH". */
export function fmtEth(wei: bigint): string {
  const tenThousandths = (wei + 50_000_000_000_000n) / 100_000_000_000_000n
  const frac = (tenThousandths % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
  return `${(tenThousandths / 10_000n).toLocaleString('en-US')}${frac ? `.${frac}` : ''} ETH`
}

/** Seconds as the largest unit that fits: "40 min", "5 hours", "12 days". */
export function fmtWait(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} ${Math.round(seconds / 3600) === 1 ? 'hour' : 'hours'}`
  return `${Math.round(seconds / 86_400)} ${Math.round(seconds / 86_400) === 1 ? 'day' : 'days'}`
}

/** How long ago, against `now` (both Unix seconds): "just now", "3h ago", "12 Nov". */
export function fmtAgo(at: number, now: number): string {
  const s = Math.max(0, now - at)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`
  return new Date(at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: now - at > 300 * 86_400 ? 'numeric' : undefined })
}
