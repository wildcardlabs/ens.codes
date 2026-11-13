import { ArrowUpRight, Fuel, Loader2, LogOut, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { type Address, parseEther } from 'viem'
import { Rows, SplitBar, StatusPill, Wrap } from '@/components/ds/primitives'
import { Mark, Wordmark } from '@/components/ds/Wordmark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { WalletChoices } from '@/components/wallet'
import { chain, EXPLORER_URL, publicClient } from '@/lib/config'
import {
  type Activity,
  type Bucket,
  change,
  DashboardError,
  fmtAgo,
  fmtCount,
  fmtEth,
  fmtPercent,
  fmtWait,
  loadStats,
  period,
  type Range,
  RANGES,
  savedSession,
  series,
  type Session,
  signIn,
  signOut,
  type Stats,
  sweepFees,
  topUpRelayer,
  totals,
} from '@/lib/dashboard'
import { useEnsProfile } from '@/lib/ensProfile'
import { fmtDateSecs, fmtDelivered, fmtUsdc, truncAddress } from '@/lib/format'
import { errorMessage } from '@/lib/util'
import { cn } from '@/lib/utils'
import { type Connected, disconnect, useWallet } from '@/lib/wallet'

/**
 * The owner's dashboard: how the vault is doing, from its own events. It lives at /dashboard and
 * nothing on the site links to it. The numbers come from /api/stats, which only answers a request
 * signed by the vault's owner.
 */

/* One colour per thing, the same in every chart: buying is orange, redeeming blue (as on My codes),
   cancelling grey, and codes still unused green. */
const BOUGHT = 'var(--orange)'
const REDEEMED = 'var(--app-blue)'
const CANCELLED = 'var(--caption)'
const UNUSED = 'var(--green)'
const RELAYED = 'var(--purple)'

const usd = (micro: number) => fmtUsdc(BigInt(Math.round(micro)))
const count = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`

export default function Dashboard() {
  const { connected, restoring } = useWallet()
  const [session, setSession] = useState<Session | null>(savedSession)
  const [stats, setStats] = useState<Stats | null>(null)
  const [state, setState] = useState<'idle' | 'signing' | 'loading' | 'forbidden' | 'unavailable'>('idle')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (s: Session, quiet = false, fresh = false) => {
    if (!quiet) setState('loading')
    try {
      setStats(await loadStats(s, fresh))
      setState('idle')
    } catch (err) {
      const kind = err instanceof DashboardError ? err.kind : 'unavailable'
      if (kind === 'unavailable' && quiet) return
      if (kind !== 'unavailable') {
        signOut()
        setSession(null)
        setStats(null)
      }
      setState(kind === 'sign_in' ? 'idle' : kind)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    void load(session)
    // Fresh numbers every minute while the page is in view.
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(session, true), 60_000)
    return () => clearInterval(timer)
  }, [session, load])

  const enter = async () => {
    if (!connected) return
    setError(null)
    setState('signing')
    try {
      setSession(await signIn(connected.client, connected.address))
    } catch (err) {
      const e = err as { code?: number; shortMessage?: string }
      setError(e.code === 4001 ? 'You cancelled the request in your wallet.' : (e.shortMessage ?? 'Could not sign in.'))
      setState('idle')
    }
  }
  const leave = () => {
    signOut()
    setSession(null)
    setStats(null)
    setState('idle')
  }

  if (session && stats) return <Board stats={stats} session={session} refresh={(fresh) => load(session, true, fresh)} leave={leave} />

  return (
    <div className="grid min-h-dvh place-items-center px-5 py-16">
      <div className="w-full max-w-[380px]">
        <Wordmark className="text-[20px]" />
        <h1 className="t-page mt-8">Dashboard.</h1>
        {session ? (
          state === 'unavailable' ? (
            <>
              <p className="mt-2 text-[15px] text-body">The numbers couldn’t be loaded.</p>
              <Button className="mt-5" onClick={() => void load(session)}>
                Try again
              </Button>
            </>
          ) : (
            <p className="mt-4 flex items-center gap-2 text-[15px] text-caption">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading
            </p>
          )
        ) : restoring ? null : !connected ? (
          <>
            <p className="mt-2 text-[15px] text-body">Log in with the owner’s wallet.</p>
            <WalletChoices className="mt-5" onError={setError} />
          </>
        ) : state === 'forbidden' ? (
          <>
            <p className="mt-2 text-[15px] text-body">This wallet can’t open the dashboard.</p>
            <p className="t-code mt-1 text-[13px] text-caption">{truncAddress(connected.address)}</p>
            <Button
              variant="soft"
              className="mt-5"
              onClick={() => {
                disconnect()
                setState('idle')
              }}
            >
              Use another wallet
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2 text-[15px] text-body">Sign a message to prove this is the owner’s wallet. It’s free and moves nothing.</p>
            <p className="t-code mt-1 text-[13px] text-caption">{truncAddress(connected.address)}</p>
            <Button size="md" className="mt-5" disabled={state === 'signing'} onClick={() => void enter()}>
              {state === 'signing' && <Loader2 className="animate-spin" aria-hidden="true" />}
              Sign in
            </Button>
          </>
        )}
        {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
      </div>
    </div>
  )
}

// -------------------------------------------------------------------------------------- board

function Board({ stats, session, refresh, leave }: { stats: Stats; session: Session; refresh: (fresh?: boolean) => Promise<void>; leave: () => void }) {
  const [range, setRange] = useState<Range>('30d')
  const [busy, setBusy] = useState(false)
  const again = () => {
    setBusy(true)
    void refresh().finally(() => setBusy(false))
  }

  return (
    <div className="min-h-dvh pb-16">
      <header className="sticky top-0 z-20 bg-background">
        <Wrap className="max-w-[1240px]">
          <div className="flex h-[64px] items-center gap-3">
            {/* The wordmark, taken apart: its name, "Dashboard" and the network sit on one baseline. */}
            <div className="flex items-center gap-[0.36em] text-[18px] text-heading">
              <Mark className="h-[1.3em] translate-y-[0.125em]" />
              <div className="flex translate-y-px items-baseline gap-2.5">
                <span className="font-display leading-none font-semibold tracking-[-0.02em]">ens.codes</span>
                <span className="text-[15px] leading-none font-medium text-caption">Dashboard</span>
                <span className="hidden text-[13px] leading-none text-caption sm:inline">· {chain.name}</span>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-[13px] text-caption md:inline" title={`Block ${stats.block}`}>
                Updated {new Date(stats.asOf * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <Button variant="soft" size="icon" onClick={again} disabled={busy} aria-label="Refresh">
                <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" />
              </Button>
              <Button variant="soft" onClick={leave} title={session.address}>
                <LogOut aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </Wrap>
        <hr className="m-0 h-px border-0 bg-rule" />
      </header>

      <Wrap className="max-w-[1240px] pt-8">
        {stats.days.length === 0 ? (
          <p className="panel p-6 text-[15px] text-body">Nothing has happened at the vault yet. The first purchase will show up here.</p>
        ) : (
          <Tabs defaultValue="overview" className="gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList className="w-full sm:w-fit">
                <TabsTrigger value="overview" className="flex-auto px-1.5 sm:px-3">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="buyers" className="flex-auto px-1.5 sm:px-3">
                  Buyers
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex-auto px-1.5 sm:px-3">
                  Activity
                </TabsTrigger>
                <TabsTrigger value="operations" className="flex-auto px-1.5 sm:px-3">
                  Operations
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="overview">
              <Overview stats={stats} range={range} setRange={setRange} />
            </TabsContent>
            <TabsContent value="buyers">
              <Buyers stats={stats} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityLog stats={stats} />
            </TabsContent>
            <TabsContent value="operations">
              <Operations stats={stats} refresh={() => refresh(true)} />
            </TabsContent>
          </Tabs>
        )}
      </Wrap>
    </div>
  )
}

/** A beige panel, as elsewhere on the site: no border, no shadow. */
function Tile({ className, ...props }: React.ComponentProps<typeof Card>) {
  return <Card className={cn('ring-0', className)} {...props} />
}

/** One headline number, with how it moved against the period before. */
function Stat({ label, value, delta, note }: { label: string; value: string; delta?: number | null; note?: ReactNode }) {
  return (
    <Tile>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-display text-[28px] leading-8 font-semibold tracking-[-0.03em] tabular-nums">{value}</CardTitle>
        {delta !== undefined && delta !== null && (
          <CardAction>
            <Badge variant="outline" className="bg-background tabular-nums">
              {delta < 0 ? <TrendingDown aria-hidden="true" /> : <TrendingUp aria-hidden="true" />}
              {/* Past ten times as much, a percentage stops meaning anything: say "12×". */}
              {delta >= 9 ? `${Math.round(delta + 1)}×` : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmtPercent(Math.abs(delta))}`}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      {note && <CardContent className="text-[13px] text-caption">{note}</CardContent>}
    </Tile>
  )
}

function RangePicker({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  return (
    <>
      <ToggleGroup type="single" variant="outline" value={range} onValueChange={(v) => v && setRange(v as Range)} className="hidden sm:flex" aria-label="Period">
        {RANGES.map((r) => (
          <ToggleGroupItem key={r.value} value={r.value} className="px-3 data-[state=on]:bg-pill">
            {r.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select value={range} onValueChange={(v) => setRange(v as Range)}>
        <SelectTrigger className="w-[130px] sm:hidden" aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}

// ----------------------------------------------------------------------------------- overview

const soldConfig = { sold: { label: 'Value sold', color: BOUGHT } } satisfies ChartConfig
const codesConfig = {
  boughtTotal: { label: 'Bought', color: BOUGHT },
  redeemedTotal: { label: 'Redeemed', color: REDEEMED },
  cancelledTotal: { label: 'Cancelled', color: CANCELLED },
} satisfies ChartConfig

const CODE_LINES = ['boughtTotal', 'redeemedTotal', 'cancelledTotal'] as const

/** Axis numbers, short: 950, 1.2k, 10k, 2.5m. */
const compact = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${v}`)

/** A tooltip row: the series' swatch and name, then its value in ink. */
const tipRow = (config: ChartConfig, fmt: (v: number) => string) => (value: unknown, name: unknown, item: { color?: string }) => (
  <>
    <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} aria-hidden="true" />
    <span className="text-muted-foreground">{config[String(name)]?.label ?? String(name)}</span>
    <span className="ml-auto pl-4 font-medium text-foreground tabular-nums">{fmt(Number(value))}</span>
  </>
)

function Overview({ stats, range, setRange }: { stats: Stats; range: Range; setRange: (r: Range) => void }) {
  const { all, now, before } = useMemo(() => period(stats.days, range), [stats.days, range])
  const t = useMemo(() => totals(now), [now])
  const b = useMemo(() => (before ? totals(before) : null), [before])
  const { points, weekly } = useMemo(() => series(all, now), [all, now])
  const label = RANGES.find((r) => r.value === range)!
  const each = weekly ? 'week' : 'day'

  const { codes } = stats
  const life = useMemo(() => totals(stats.days), [stats.days])
  const returned = life.change + life.cancelledValue

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[13px] text-caption">{before ? `Compared with the ${label.label} before.` : range === 'all' ? 'Since the vault’s first day.' : `The last ${label.label}.`}</p>
        <RangePicker range={range} setRange={setRange} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Value sold" value={usd(t.sold)} delta={change(t.sold, b?.sold)} note={`${plural(t.purchases, 'purchase')} · ${usd(t.purchases ? t.sold / t.purchases : 0)} each`} />
        <Stat label="Codes sold" value={count(t.codes)} delta={change(t.codes, b?.codes)} note={`${usd(t.codes ? t.sold / t.codes : 0)} a code on average`} />
        <Stat label="Codes redeemed" value={count(t.redeemed)} delta={change(t.redeemed, b?.redeemed)} note={`${usd(t.spent)} paid to ENS`} />
        <Stat label="New buyers" value={count(t.newBuyers)} delta={change(t.newBuyers, b?.newBuyers)} note={`${count(stats.buyerCount)} in total`} />
        <Stat label="Names renewed" value={count(t.names)} delta={change(t.names, b?.names)} note={t.seconds ? `${fmtDelivered(BigInt(t.seconds))} added` : 'No time added yet'} />
        <Stat label="Fees earned" value={usd(t.fees)} delta={change(t.fees, b?.fees)} note={`${usd(stats.fee)} a code`} />
        <Stat label="Codes cancelled" value={count(t.cancelled)} delta={change(t.cancelled, b?.cancelled)} note={`${usd(t.cancelledValue)} returned`} />
        <Stat label="Sponsored redemptions" value={t.redeemed ? fmtPercent(t.relayed / t.redeemed) : '–'} note={`${count(t.relayed)} of ${count(t.redeemed)}, fee paid by the relayer`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tile>
          <CardHeader>
            <CardTitle>Value sold</CardTitle>
            <CardDescription>USDC put on codes, each {each}.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={soldConfig} className="aspect-auto h-[260px] w-full">
              <BarChart data={points.map((p) => ({ ...p, sold: p.sold / 1e6 }))} margin={{ left: 0, right: 8, top: 8 }} maxBarSize={28}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={(v: string) => v.replace('Week of ', '')} />
                <YAxis width={48} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${compact(v)}`} />
                <ChartTooltip cursor={{ fill: 'var(--pill)' }} content={<ChartTooltipContent formatter={tipRow(soldConfig, (v) => usd(v * 1e6))} />} />
                <Bar dataKey="sold" fill="var(--color-sold)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Tile>

        <Tile>
          <CardHeader>
            <CardTitle>Codes</CardTitle>
            <CardDescription>Running totals since the first day. The gap between bought and the rest is what’s still unused.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={codesConfig} className="aspect-auto h-[260px] w-full">
              <LineChart data={points} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={(v: string) => v.replace('Week of ', '')} />
                <YAxis width={48} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={compact} />
                <ChartTooltip content={<ChartTooltipContent formatter={tipRow(codesConfig, count)} />} />
                <ChartLegend content={<ChartLegendContent />} itemSorter={(item) => CODE_LINES.indexOf(item.dataKey as (typeof CODE_LINES)[number])} />
                {CODE_LINES.map((key) => (
                  <Line key={key} dataKey={key} type="stepAfter" stroke={`var(--color-${key})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tile>
          <CardHeader>
            <CardTitle>Where the codes are</CardTitle>
            <CardDescription>Every code sold so far.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SplitBar
              segments={[
                { key: 'unused', label: 'Unused', detail: count(codes.unused), value: codes.unused, color: UNUSED },
                { key: 'redeemed', label: 'Redeemed', detail: count(codes.redeemed), value: codes.redeemed, color: REDEEMED },
                { key: 'cancelled', label: 'Cancelled', detail: count(codes.cancelled), value: codes.cancelled, color: CANCELLED },
              ]}
            />
            <Rows
              rows={[
                ['Redeemed so far', codes.sold ? fmtPercent(codes.redeemed / codes.sold) : '–'],
                ['Typical wait before redeeming', stats.redeemTime.median === null ? '–' : fmtWait(stats.redeemTime.median)],
                ['Value still unused', usd(codes.unusedValue)],
              ]}
            />
          </CardContent>
        </Tile>

        <Tile>
          <CardHeader>
            <CardTitle>Where the money went</CardTitle>
            <CardDescription>{usd(life.sold)} put on codes so far.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SplitBar
              segments={[
                { key: 'vault', label: 'Waiting in the vault', detail: usd(codes.unusedValue), value: codes.unusedValue, color: UNUSED },
                { key: 'ens', label: 'Paid to ENS', detail: usd(life.spent), value: life.spent, color: REDEEMED },
                { key: 'back', label: 'Returned to buyers', detail: usd(returned), value: returned, color: CANCELLED },
              ]}
            />
            <Rows
              rows={[
                ['Returned as change from redeemed codes', usd(life.change)],
                ['Returned from cancelled codes', usd(life.cancelledValue)],
                ['Fees earned', usd(life.fees)],
              ]}
            />
          </CardContent>
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <BarList title="Purchase size" note="Purchases by how many codes they held." rows={stats.sizes.map((s) => ({ label: s.label, value: s.purchases ?? 0 }))} unit="purchase" color={BOUGHT} />
        <BarList title="Code value" note="Codes by what was put on them." rows={asRows(stats.values)} unit="code" color={BOUGHT} />
        <BarList title="Time to redeem" note="How long codes waited after they were bought." rows={asRows(stats.redeemTime.buckets)} unit="code" color={REDEEMED} />
      </div>

      <Tile>
        <CardHeader>
          <CardTitle>Names renewed most</CardTitle>
          <CardDescription>{plural(stats.uniqueNames, 'name')} renewed so far.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.topNames.length === 0 ? (
            <p className="text-[14px] text-caption">No code has been redeemed yet.</p>
          ) : (
            <div className="overflow-hidden rounded-lg bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Codes used on it</TableHead>
                    <TableHead className="text-right">Time added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.topNames.map((n) => (
                    <TableRow key={n.name}>
                      <TableCell className="font-medium text-foreground">{n.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(n.times)}</TableCell>
                      <TableCell className="text-right">{fmtDelivered(BigInt(n.seconds))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Tile>
    </div>
  )
}

const asRows = (buckets: Bucket[]) => buckets.map((b) => ({ label: b.label, value: b.codes }))

/** A short ranked list as bars: the label, a thin bar, the number. Every bar is labelled, so it reads without a hover. */
function BarList({ title, note, rows, unit, color }: { title: string; note: string; rows: { label: string; value: number }[]; unit: string; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <Tile>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2.5">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[108px_1fr_auto] items-center gap-3 text-[13px]" title={`${r.label}: ${plural(r.value, unit)}`}>
              <span className="truncate text-body">{r.label}</span>
              <span className="h-2 rounded-full bg-pill">
                {r.value > 0 && <span className="block h-full min-w-1.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />}
              </span>
              <span className="min-w-8 text-right font-medium text-foreground tabular-nums">{count(r.value)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Tile>
  )
}

// ------------------------------------------------------------------------------------- buyers

/** A wallet: a given name, or its ENS name if it has one, linked to the explorer. */
function Who({ address, name }: { address: string; name?: string }) {
  const profile = useEnsProfile(name ? undefined : (address as Address))
  const text = name ?? profile?.name ?? truncAddress(address)
  const cls = cn('whitespace-nowrap', !name && !profile && 't-code text-[13px]')
  return EXPLORER_URL ? (
    <a href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer" title={address} className={cn(cls, 'text-foreground hover:text-app-blue')}>
      {text}
    </a>
  ) : (
    <span title={address} className={cn(cls, 'text-foreground')}>
      {text}
    </span>
  )
}

function TxLink({ tx }: { tx: string }) {
  if (!EXPLORER_URL) return <span className="t-code text-[12px] text-caption">{tx.slice(0, 10)}</span>
  return (
    <a href={`${EXPLORER_URL}/tx/${tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-caption hover:text-app-blue" aria-label="Open the transaction">
      <span className="t-code text-[12px]">{tx.slice(0, 8)}</span>
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </a>
  )
}

const PAGE = 25

function Buyers({ stats }: { stats: Stats }) {
  const [shown, setShown] = useState(PAGE)
  const life = useMemo(() => totals(stats.days), [stats.days])
  const top = stats.buyers[0]
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Buyers" value={count(stats.buyerCount)} note="Wallets that bought at least once" />
        <Stat label="Came back" value={stats.buyerCount ? fmtPercent(stats.repeatBuyers / stats.buyerCount) : '–'} note={`${plural(stats.repeatBuyers, 'buyer')} bought more than once`} />
        <Stat label="Spent per buyer" value={usd(stats.buyerCount ? life.sold / stats.buyerCount : 0)} note={`${count(stats.buyerCount ? Math.round(life.codes / stats.buyerCount) : 0)} codes each on average`} />
        <Stat label="Largest buyer" value={top && life.sold ? fmtPercent(top.sold / life.sold) : '–'} note="Share of everything sold" />
      </div>
      <Tile>
        <CardHeader>
          <CardTitle>Buyers</CardTitle>
          <CardDescription>Largest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                  <TableHead className="text-right">Codes</TableHead>
                  <TableHead className="text-right">Redeemed</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Unused</TableHead>
                  <TableHead className="text-right">First bought</TableHead>
                  <TableHead className="text-right">Last bought</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.buyers.slice(0, shown).map((b) => (
                  <TableRow key={b.address}>
                    <TableCell>
                      <Who address={b.address} />
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground tabular-nums">{usd(b.sold)}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(b.purchases)}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(b.codes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(b.redeemed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(b.cancelled)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(b.unused)} <span className="text-caption">· {usd(b.unusedValue)}</span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{fmtDateSecs(b.first)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{fmtDateSecs(b.last)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {stats.buyers.length > shown && (
            <Button variant="soft" className="mt-4" onClick={() => setShown((n) => n + PAGE)}>
              Show more
            </Button>
          )}
        </CardContent>
      </Tile>
    </div>
  )
}

// ----------------------------------------------------------------------------------- activity

const KINDS: Record<Activity['kind'], { text: string; color: string }> = {
  bought: { text: 'Bought', color: BOUGHT },
  redeemed: { text: 'Redeemed', color: REDEEMED },
  cancelled: { text: 'Cancelled', color: CANCELLED },
  swept: { text: 'Fees swept', color: RELAYED },
}

function detail(a: Activity): ReactNode {
  if (a.kind === 'bought') return `${plural(a.codes, 'code')} bought`
  if (a.kind === 'cancelled') return `${plural(a.codes, 'code')} cancelled`
  if (a.kind === 'swept') return 'Fees sent to the fee wallet'
  return (
    <>
      {a.names.slice(0, 2).join(', ')}
      {a.names.length > 2 && ` and ${a.names.length - 2} more`}
    </>
  )
}

const amountOf = (a: Activity) => (a.kind === 'redeemed' ? a.spent : a.amount)

function ActivityLog({ stats }: { stats: Stats }) {
  const [kind, setKind] = useState<'all' | Activity['kind']>('all')
  const [shown, setShown] = useState(PAGE)
  const rows = useMemo(() => stats.activity.filter((a) => kind === 'all' || a.kind === kind), [stats.activity, kind])
  return (
    <Tile>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>The latest {count(stats.activity.length)} things that happened at the vault, newest first.</CardDescription>
        <CardAction>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as typeof kind)
              setShown(PAGE)
            }}
          >
            <SelectTrigger className="w-[150px] bg-background" aria-label="Show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">Everything</SelectItem>
              {(Object.keys(KINDS) as Activity['kind'][]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KINDS[k].text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-[14px] text-caption">Nothing of this kind yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Transaction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, shown).map((a, i) => (
                  <TableRow key={`${a.tx}:${a.kind}:${i}`}>
                    <TableCell className="whitespace-nowrap" title={new Date(a.at * 1000).toLocaleString('en-GB')}>
                      {fmtAgo(a.at, stats.asOf)}
                    </TableCell>
                    <TableCell>
                      <StatusPill color={KINDS[a.kind].color}>{KINDS[a.kind].text}</StatusPill>
                    </TableCell>
                    <TableCell>{a.kind === 'redeemed' && a.relayed ? <Who address={a.who} name="Relayer" /> : <Who address={a.who} />}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={a.kind === 'redeemed' && a.buyer ? `Code bought by ${a.buyer}` : undefined}>
                      {detail(a)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground tabular-nums">{usd(amountOf(a))}</TableCell>
                    <TableCell className="text-right">
                      <TxLink tx={a.tx} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {rows.length > shown && (
          <Button variant="soft" className="mt-4" onClick={() => setShown((n) => n + PAGE)}>
            Show more
          </Button>
        )}
      </CardContent>
    </Tile>
  )
}

// --------------------------------------------------------------------------------- operations

function Operations({ stats, refresh }: { stats: Stats; refresh: () => Promise<void> }) {
  const { connected } = useWallet()
  const { relayer, relayed, byWallet, state } = stats
  const life = useMemo(() => totals(stats.days), [stats.days])
  const [login, setLogin] = useState(false)
  const [topUp, setTopUp] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const balance = BigInt(relayer.balance)
  const gas = BigInt(relayed.gas)
  const each = relayed.count ? gas / BigInt(relayed.count) : 0n
  const why = !relayer.address ? 'Not set up' : !relayer.signer ? 'Can’t sign' : !relayer.funded ? 'Out of gas' : !relayer.affordable ? 'Network fee too high' : 'Off'
  const address = (a: string) =>
    EXPLORER_URL ? (
      <a href={`${EXPLORER_URL}/address/${a}`} target="_blank" rel="noreferrer" className="t-code text-[13px] hover:text-app-blue" title={a}>
        {truncAddress(a)}
      </a>
    ) : (
      <span className="t-code text-[13px]" title={a}>
        {truncAddress(a)}
      </span>
    )

  useEffect(() => {
    if (connected) setLogin(false)
  }, [connected])

  const sweep = async () => {
    if (!connected) return setLogin(true)
    setSweeping(true)
    try {
      await sweepFees(connected.client, connected.address)
      toast.success(`${usd(state.feesAccrued)} sent to the fee wallet.`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSweeping(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Tile>
        <CardHeader>
          <CardTitle>Relayer</CardTitle>
          <CardDescription>Pays the network fee for sponsored redemptions.</CardDescription>
          <CardAction>
            <StatusPill color={relayer.enabled ? 'var(--green)' : 'var(--red)'}>{relayer.enabled ? 'Working' : why}</StatusPill>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Rows
            rows={[
              ['Address', relayer.address ? address(relayer.address) : '–'],
              ['Balance', fmtEth(balance)],
              ['Spent on fees so far', fmtEth(gas)],
              ['Fee per redemption', relayed.count ? fmtEth(each) : '–'],
              ['Redemptions left', each > 0n ? `About ${fmtCount(Number(balance / each))}` : '–'],
            ]}
          />
          <SplitBar
            segments={[
              { key: 'relayed', label: 'Sponsored', detail: count(relayed.count), value: relayed.count, color: RELAYED },
              { key: 'wallet', label: 'From a wallet', detail: count(byWallet.count), value: byWallet.count, color: CANCELLED },
            ]}
          />
          {relayer.address && (
            <Button variant="soft" className="justify-self-start" onClick={() => (connected ? setTopUp(true) : setLogin(true))}>
              <Fuel aria-hidden="true" />
              Top up ETH
            </Button>
          )}
        </CardContent>
      </Tile>

      <Tile>
        <CardHeader>
          <CardTitle>Vault</CardTitle>
          <CardDescription>The contract that holds every unused code’s value.</CardDescription>
          <CardAction>
            <StatusPill color={state.paused ? 'var(--red)' : 'var(--green)'}>{state.paused ? 'Paused' : 'Open'}</StatusPill>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Rows
            rows={[
              ['Address', address(stats.vault)],
              ['Network', chain.name],
              ['USDC held', usd(state.usdc)],
              ['For unused codes', usd(stats.codes.unusedValue)],
              ['Largest code allowed', usd(state.maxCodeAmount)],
              ['Read at block', count(stats.block)],
            ]}
          />
        </CardContent>
      </Tile>

      <Tile>
        <CardHeader>
          <CardTitle>Fees</CardTitle>
          <CardDescription>{usd(stats.fee)} on every code sold.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Rows
            rows={[
              ['Earned so far', usd(life.fees)],
              ['Waiting in the vault', usd(state.feesAccrued)],
              ['Already swept', usd(stats.feesSwept)],
              ['Fee wallet', address(state.feeRecipient)],
            ]}
          />
          <Button variant="soft" className="justify-self-start" disabled={sweeping || state.feesAccrued === 0} onClick={() => void sweep()}>
            {sweeping && <Loader2 className="animate-spin" aria-hidden="true" />}
            {state.feesAccrued === 0 ? 'Nothing to sweep' : `Sweep ${usd(state.feesAccrued)}`}
          </Button>
        </CardContent>
      </Tile>

      <Dialog open={login} onOpenChange={setLogin}>
        <DialogContent className="gap-0 p-7">
          <DialogTitle className="t-display text-[24px] leading-[28px]">Log in.</DialogTitle>
          <DialogDescription className="mt-2 text-[15px] leading-[22px] text-body">Pick the wallet that will send the transaction.</DialogDescription>
          <WalletChoices className="mt-5" onError={(m) => toast.error(m)} />
        </DialogContent>
      </Dialog>
      {relayer.address && connected && (
        <TopUp open={topUp} close={() => setTopUp(false)} relayer={relayer.address as Address} balance={balance} from={connected} done={refresh} />
      )}
    </div>
  )
}

const TOP_UPS = ['0.02', '0.05', '0.1']

/** Send ETH from the connected wallet to the relayer. */
function TopUp({ open, close, relayer, balance, from, done }: { open: boolean; close: () => void; relayer: Address; balance: bigint; from: Connected; done: () => Promise<void> }) {
  const [amount, setAmount] = useState('0.05')
  const [mine, setMine] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    let live = true
    void publicClient.getBalance({ address: from.address }).then((b) => live && setMine(b), () => {})
    return () => {
      live = false
    }
  }, [open, from.address])

  let wei = 0n
  try {
    wei = /^\d*\.?\d*$/.test(amount) && amount !== '' && amount !== '.' ? parseEther(amount) : 0n
  } catch {
    // Not a number yet.
  }
  const short = mine !== null && wei > mine

  const send = async () => {
    setError(null)
    setBusy(true)
    try {
      await topUpRelayer(from.client, from.address, relayer, wei)
      toast.success(`${fmtEth(wei)} sent to the relayer.`)
      close()
      await done()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent className="gap-0 p-7">
        <DialogTitle className="t-display text-[24px] leading-[28px]">Top up the relayer.</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-[22px] text-body">Send ETH from your wallet. The relayer spends it on network fees.</DialogDescription>
        <div className="panel mt-5 p-4">
          <Rows
            rows={[
              ['To', <span className="t-code text-[13px]" title={relayer}>{truncAddress(relayer)}</span>],
              ['It has', fmtEth(balance)],
              ['From', <span className="t-code text-[13px]" title={from.address}>{truncAddress(from.address)}</span>],
              ['Your wallet has', mine === null ? '…' : fmtEth(mine)],
            ]}
          />
        </div>
        <label htmlFor="top-up-amount" className="mt-5 text-[14px] font-medium text-heading">
          Amount
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Input id="top-up-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.').trim())} aria-invalid={short} className="h-10 bg-background pr-12 text-[15px] md:text-[15px]" />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-caption">ETH</span>
          </div>
          {TOP_UPS.map((v) => (
            <Button key={v} variant="soft" size="md" className="px-3" onClick={() => setAmount(v)}>
              {v}
            </Button>
          ))}
        </div>
        {(short || error) && <p className="mt-2 text-[13px] text-red">{short ? 'Your wallet doesn’t have that much.' : error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="soft" size="md" disabled={busy} onClick={close}>
            Not now
          </Button>
          <Button size="md" disabled={busy || wei === 0n || short} onClick={() => void send()}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {wei > 0n ? `Send ${amount} ETH` : 'Send'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
