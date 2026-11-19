import { getAddress, isAddress, isHex, parseAbi, recoverMessageAddress, type Address, type Hex } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { clientFor, configFromEnv, info, type RelayConfig } from './relay.js'
import { addresses } from 'ens-budget'
import { indexedAll, indexedBlock, indexedTxsAt } from './subgraphShared.js'
import { type AdminChange, MAX_SESSION, type RenewerChange, SIGN_IN_STATEMENT, type Activity, type Bucket, type Buyer, type Day, type Stats, type Summary } from './statsShared.js'

/**
 * The dashboard's numbers, for the vault's owner only.
 *
 * Nothing is stored. Every figure is worked out from the vault's own events, read from the chain,
 * and the person asking proves who they are with a Sign-In with Ethereum message that is checked on
 * every request: the signed message is the session.
 */

export type StatsConfig = RelayConfig & {
  /** Where the vault's history starts. */
  deployBlock: bigint
  /** The most blocks one history request may cover. */
  logRange: bigint
  /** Who may read the dashboard. Null: the vault's owner. */
  admin: Address | null
  /** The vault's subgraph, read before the chain. Null: the chain only. */
  subgraph: string | null
}

export function statsConfigFromEnv(env: Record<string, string | undefined>): StatsConfig {
  const admin = env.ADMIN_ADDRESS
  return {
    ...configFromEnv(env),
    deployBlock: BigInt(env.VITE_VAULT_DEPLOY_BLOCK || 0),
    logRange: BigInt(env.VITE_LOG_RANGE || 10_000),
    admin: admin && isAddress(admin) ? getAddress(admin) : null,
    subgraph: env.VITE_SUBGRAPH_URL || null,
  }
}

// --------------------------------------------------------------------------------- signing in

export { SIGN_IN_STATEMENT }
/** How far the signer's clock may be ahead. */
const CLOCK_SKEW = 5 * 60

export class Denied extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: 'sign_in' | 'forbidden',
  ) {
    super(code)
  }
}

export type Door = {
  chainId: number
  admin: Address
  /** The host this request arrived at. */
  host: string | null
  /** The pages allowed to sign in. Empty: only the host the request arrived at. */
  origins: string[]
  now: number
  /** For an owner that is a contract (a multisig): ask the chain whether the signature is good. */
  contractSigned?: (message: string, signature: Hex) => Promise<boolean>
}

/**
 * Let a request in only if it carries a sign-in message for this site, this chain and this moment,
 * signed by the admin. Throws `Denied` otherwise.
 */
export async function admit(body: unknown, door: Door): Promise<void> {
  const again = new Denied(401, 'sign_in')
  if (!body || typeof body !== 'object') throw again
  const { message, signature } = body as Record<string, unknown>
  if (typeof message !== 'string' || message.length > 2_000) throw again
  if (typeof signature !== 'string' || !isHex(signature, { strict: true }) || signature.length > 4_000) throw again

  let m: ReturnType<typeof parseSiweMessage>
  try {
    m = parseSiweMessage(message)
  } catch {
    throw again
  }
  if (m.statement !== SIGN_IN_STATEMENT || m.version !== '1' || m.chainId !== door.chainId) throw again
  if (!m.address || !m.domain || !m.uri || !m.nonce) throw again

  // The message names the page that asked for it. A signature made for any other page is refused.
  let from: URL
  try {
    from = new URL(m.uri)
  } catch {
    throw again
  }
  if (from.host !== m.domain) throw again
  if (door.origins.length > 0 ? !door.origins.includes(from.origin) : m.domain !== door.host) throw again

  const issued = m.issuedAt ? Math.floor(m.issuedAt.getTime() / 1000) : NaN
  const expires = m.expirationTime ? Math.floor(m.expirationTime.getTime() / 1000) : NaN
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) throw again
  if (issued > door.now + CLOCK_SKEW || expires <= door.now || expires - issued > MAX_SESSION) throw again
  if (m.notBefore && m.notBefore.getTime() / 1000 > door.now) throw again

  if (!isAddress(m.address, { strict: false }) || getAddress(m.address) !== door.admin) throw new Denied(403, 'forbidden')
  let signed = false
  if (signature.length === 132) signed = await recoverMessageAddress({ message, signature }).then((a) => a === door.admin, () => false)
  if (!signed && door.contractSigned) signed = await door.contractSigned(message, signature).catch(() => false)
  if (!signed) throw new Denied(403, 'forbidden')
}

// ----------------------------------------------------------------------------------- history

const vaultAbi = parseAbi([
  'event Created(bytes32 indexed id, address indexed buyer, uint256 amount, uint256 count, bytes32 root)',
  'event Redeemed(bytes32 indexed id, address indexed code, uint256 index, (address renewer, string label, uint64 duration)[] renewals, uint256 spent, uint256 refunded)',
  'event Cancelled(bytes32 indexed id, address indexed buyer, uint256 mask, uint256 refunded)',
  'event FeesSwept(address indexed to, uint256 amount)',
  'event RefundOwed(address indexed buyer, uint256 amount)',
  'event RefundClaimed(address indexed buyer, uint256 amount)',
  'event RenewerProposed(address indexed renewer, uint256 activatesAt)',
  'event RenewerAdded(address indexed renewer)',
  'event RenewerCancelled(address indexed renewer)',
  'event RenewerRemoved(address indexed renewer)',
  'event MaxCodeAmountSet(uint96 amount)',
  'event Paused()',
  'event Unpaused()',
  'event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function isRenewer(address) view returns (bool)',
  'function pendingRenewers(address) view returns (uint256)',
  'function RENEWER_WINDOW() view returns (uint256)',
  'function refundsOwed(address) view returns (uint256)',
  'function usdc() view returns (address)',
  'function feesAccrued() view returns (uint256)',
  'function paused() view returns (bool)',
  'function maxCodeAmount() view returns (uint96)',
  'function PROTOCOL_FEE() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
])
const events = vaultAbi.filter((x) => x.type === 'event')

type Where = { at: number; block: number; log: number; tx: Hex }
/** One thing that happened at the vault, in the order it happened. */
export type VaultEvent = Where &
  (
    | { kind: 'bought'; id: Hex; buyer: Address; amount: number; count: number }
    | { kind: 'redeemed'; id: Hex; names: { label: string; seconds: number }[]; spent: number; change: number; sender: Address; gas: string }
    | { kind: 'cancelled'; id: Hex; buyer: Address; count: number; value: number }
    | { kind: 'swept'; to: Address; amount: number }
    | { kind: 'refund'; buyer: Address; amount: number; claimed: boolean }
    | { kind: 'renewer'; change: RenewerChange; renewer: Address; activatesAt: number | null }
    | { kind: 'admin'; change: AdminChange; amount: number | null; to: Address | null }
  )

const popcount = (x: bigint) => {
  let n = 0
  for (; x > 0n; x >>= 1n) if (x & 1n) n++
  return n
}

/** Run `job` over `items`, a few at a time, keeping their order. */
async function pooled<T, R>(items: T[], size: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await job(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}

type Client = ReturnType<typeof clientFor>

/**
 * The vault's events between two blocks, oldest first: from the subgraph as far as it has reached,
 * then from the chain. If the subgraph is not set or can't answer, all of it from the chain.
 */
async function read(client: Client, cfg: StatsConfig, from: bigint, to: bigint): Promise<VaultEvent[]> {
  if (from > to) return []
  if (cfg.subgraph) {
    try {
      const at = await indexedBlock(cfg.subgraph)
      if (!(await subgraphFits(client, cfg, cfg.subgraph, at))) throw new Error('The subgraph indexes a different vault')
      const mid = at < to ? at : to
      const [old, recent] = await Promise.all([fromSubgraph(client, cfg.subgraph, cfg.account?.address ?? null, from, mid, at), readChain(client, cfg, mid + 1n > from ? mid + 1n : from, to)])
      return [...old, ...recent].sort((a, b) => a.block - b.block || a.log - b.log)
    } catch (err) {
      console.warn('stats: reading history from the chain instead of the subgraph', err)
    }
  }
  return readChain(client, cfg, from, to)
}

/**
 * Whether the subgraph indexes this vault: its owner and renewer events at the deploy block are
 * the chain's. Checked once per vault while this instance is warm.
 */
let fits: { key: string; ok: Promise<boolean> } | null = null
function subgraphFits(client: Client, cfg: StatsConfig, url: string, at: bigint): Promise<boolean> {
  const key = `${url}:${cfg.vault}:${cfg.deployBlock}`
  if (fits?.key !== key) {
    const ok = (async () => {
      if (at < cfg.deployBlock) return true // Not there yet: nothing it holds is used.
      const [indexed, logs] = await Promise.all([
        indexedTxsAt(url, cfg.deployBlock, at),
        client.getLogs({ address: cfg.vault, fromBlock: cfg.deployBlock, toBlock: cfg.deployBlock }),
      ])
      const onChain = new Set(logs.map((l) => l.transactionHash.toLowerCase()))
      return indexed.size > 0 && [...indexed].every((tx) => onChain.has(tx))
    })()
    fits = { key, ok }
    ok.catch(() => fits?.ok === ok && (fits = null))
  }
  return fits.ok
}

/** A mined transaction's receipt. Some providers briefly answer "not found" for one; ask again before giving up. */
async function receiptOf(client: Client, hash: Hex) {
  for (let tries = 1; ; tries++) {
    try {
      return await client.getTransactionReceipt({ hash })
    } catch (err) {
      if (tries >= 3) throw err
      await new Promise((r) => setTimeout(r, 400 * tries))
    }
  }
}

type Row = { id: string; block: string; logIndex: string; timestamp: string; tx: Hex }

/**
 * The same events from the subgraph, as of block `at`. The subgraph has each redemption's sender;
 * only the relayer's own redemptions need their receipt, for the fee it paid.
 */
async function fromSubgraph(client: Client, url: string, relayer: Address | null, from: bigint, to: bigint, at: bigint): Promise<VaultEvent[]> {
  if (from > to) return []
  const where = { block_gte: from.toString(), block_lte: to.toString() }
  const base = 'block logIndex timestamp tx'
  const [bought, redeemed, cancelled, swept, refunds, renewers, admin] = await Promise.all([
    indexedAll<Row & { batch: Hex; buyer: Address; amount: string; count: string }>(url, 'Purchase', 'purchases', `${base} batch buyer amount count`, where, at),
    indexedAll<Row & { batch: Hex; labels: string[]; durations: string[]; spent: string; refunded: string; sender: Address }>(
      url,
      'Redemption',
      'redemptions',
      `${base} batch labels durations spent refunded sender`,
      where,
      at,
    ),
    indexedAll<Row & { batch: Hex; buyer: Address; mask: string; refunded: string }>(url, 'Cancellation', 'cancellations', `${base} batch buyer mask refunded`, where, at),
    indexedAll<Row & { to: Address; amount: string }>(url, 'FeeSweep', 'feeSweeps', `${base} to amount`, where, at),
    indexedAll<Row & { kind: string; buyer: Address; amount: string }>(url, 'Refund', 'refunds', `${base} kind buyer amount`, where, at),
    indexedAll<Row & { kind: RenewerChange; renewer: Address; activatesAt: string | null }>(url, 'RenewerChange', 'renewerChanges', `${base} kind renewer activatesAt`, where, at),
    indexedAll<Row & { kind: string; amount: string | null; to: Address | null }>(url, 'AdminChange', 'adminChanges', `${base} kind amount to`, where, at),
  ])
  const isRelayer = (sender: Address) => !!relayer && getAddress(sender) === relayer
  const relayedTxs = [...new Set(redeemed.filter((r) => isRelayer(r.sender)).map((r) => r.tx))]
  const receipts = new Map(await pooled(relayedTxs, 8, async (hash) => [hash, await receiptOf(client, hash)] as const))
  const ADMIN: Record<string, AdminChange> = { paused: 'paused', unpaused: 'unpaused', maxCodeAmount: 'limit', ownershipStarted: 'ownershipStarted', ownershipTransferred: 'ownershipTransferred' }
  const place = (r: Row) => ({ at: Number(r.timestamp), block: Number(r.block), log: Number(r.logIndex), tx: r.tx })
  return [
    ...bought.map((r): VaultEvent => ({ ...place(r), kind: 'bought', id: r.batch, buyer: getAddress(r.buyer), amount: Number(r.amount), count: Number(r.count) })),
    ...redeemed.map((r): VaultEvent => {
      const receipt = receipts.get(r.tx)
      return {
        ...place(r),
        kind: 'redeemed',
        id: r.batch,
        names: r.labels.map((label, i) => ({ label, seconds: Number(r.durations[i]) })),
        spent: Number(r.spent),
        change: Number(r.refunded),
        sender: getAddress(r.sender),
        gas: receipt ? (receipt.gasUsed * receipt.effectiveGasPrice).toString() : '0',
      }
    }),
    ...cancelled.map((r): VaultEvent => ({ ...place(r), kind: 'cancelled', id: r.batch, buyer: getAddress(r.buyer), count: popcount(BigInt(r.mask)), value: Number(r.refunded) })),
    ...swept.map((r): VaultEvent => ({ ...place(r), kind: 'swept', to: getAddress(r.to), amount: Number(r.amount) })),
    ...refunds.map((r): VaultEvent => ({ ...place(r), kind: 'refund', buyer: getAddress(r.buyer), amount: Number(r.amount), claimed: r.kind === 'claimed' })),
    ...renewers.map((r): VaultEvent => ({ ...place(r), kind: 'renewer', change: r.kind, renewer: getAddress(r.renewer), activatesAt: r.activatesAt === null ? null : Number(r.activatesAt) })),
    ...admin.map((r): VaultEvent => ({ ...place(r), kind: 'admin', change: ADMIN[r.kind], amount: r.amount === null ? null : Number(r.amount), to: r.to ? getAddress(r.to) : null })),
  ]
}

/** The vault's events between two blocks from the chain's logs, oldest first, each with its time and (for a redemption) who sent it. */
async function readChain(client: Client, cfg: StatsConfig, from: bigint, to: bigint): Promise<VaultEvent[]> {
  if (from > to) return []
  const windows: [bigint, bigint][] = []
  for (let a = from; a <= to; a += cfg.logRange) windows.push([a, a + cfg.logRange - 1n < to ? a + cfg.logRange - 1n : to])
  const logs = (await pooled(windows, 6, ([fromBlock, toBlock]) => client.getLogs({ address: cfg.vault, events, fromBlock, toBlock, strict: true }))).flat()

  // Most nodes put the block's time on each log. For those that don't, ask for the block.
  const times = new Map<bigint, number>()
  for (const l of logs) {
    const stamp = (l as { blockTimestamp?: unknown }).blockTimestamp
    if (typeof stamp === 'string' && isHex(stamp)) times.set(l.blockNumber, Number(BigInt(stamp)))
  }
  const untimed = [...new Set(logs.map((l) => l.blockNumber).filter((b) => !times.has(b)))]
  for (const [b, t] of await pooled(untimed, 8, async (b) => [b, Number((await client.getBlock({ blockNumber: b })).timestamp)] as const)) times.set(b, t)

  // A redemption's sender says whether the relayer or a wallet sent it, and what it cost in gas.
  const redeemTxs = [...new Set(logs.filter((l) => l.eventName === 'Redeemed').map((l) => l.transactionHash))]
  const receipts = new Map(await pooled(redeemTxs, 8, async (hash) => [hash, await receiptOf(client, hash)] as const))

  return logs
    .map((l): VaultEvent => {
      const where = { at: times.get(l.blockNumber) ?? 0, block: Number(l.blockNumber), log: l.logIndex, tx: l.transactionHash }
      switch (l.eventName) {
        case 'Created':
          return { ...where, kind: 'bought', id: l.args.id, buyer: l.args.buyer, amount: Number(l.args.amount), count: Number(l.args.count) }
        case 'Redeemed': {
          const r = receipts.get(l.transactionHash)!
          return {
            ...where,
            kind: 'redeemed',
            id: l.args.id,
            names: l.args.renewals.map((n) => ({ label: n.label, seconds: Number(n.duration) })),
            spent: Number(l.args.spent),
            change: Number(l.args.refunded),
            sender: getAddress(r.from),
            gas: (r.gasUsed * r.effectiveGasPrice).toString(),
          }
        }
        case 'Cancelled':
          return { ...where, kind: 'cancelled', id: l.args.id, buyer: l.args.buyer, count: popcount(l.args.mask), value: Number(l.args.refunded) }
        case 'FeesSwept':
          return { ...where, kind: 'swept', to: l.args.to, amount: Number(l.args.amount) }
        case 'RefundOwed':
        case 'RefundClaimed':
          return { ...where, kind: 'refund', buyer: l.args.buyer, amount: Number(l.args.amount), claimed: l.eventName === 'RefundClaimed' }
        case 'RenewerProposed':
          return { ...where, kind: 'renewer', change: 'proposed', renewer: l.args.renewer, activatesAt: Number(l.args.activatesAt) }
        case 'RenewerAdded':
          return { ...where, kind: 'renewer', change: 'added', renewer: l.args.renewer, activatesAt: null }
        case 'RenewerCancelled':
          return { ...where, kind: 'renewer', change: 'cancelled', renewer: l.args.renewer, activatesAt: null }
        case 'RenewerRemoved':
          return { ...where, kind: 'renewer', change: 'removed', renewer: l.args.renewer, activatesAt: null }
        case 'MaxCodeAmountSet':
          return { ...where, kind: 'admin', change: 'limit', amount: Number(l.args.amount), to: null }
        case 'Paused':
        case 'Unpaused':
          return { ...where, kind: 'admin', change: l.eventName === 'Paused' ? 'paused' : 'unpaused', amount: null, to: null }
        case 'OwnershipTransferStarted':
        case 'OwnershipTransferred':
          return { ...where, kind: 'admin', change: l.eventName === 'OwnershipTransferStarted' ? 'ownershipStarted' : 'ownershipTransferred', amount: null, to: l.args.newOwner }
      }
    })
    .sort((a, b) => a.block - b.block || a.log - b.log)
}

/**
 * History already read, kept while this instance is warm so a refresh only reads what is new. The
 * newest few blocks are read again each time, in case the chain reorganised them.
 */
let settled: { key: string; through: bigint; events: VaultEvent[] } | null = null
const UNSETTLED = 12n

async function history(client: Client, cfg: StatsConfig): Promise<{ events: VaultEvent[]; block: bigint }> {
  const key = `${cfg.chainId}:${cfg.vault}:${cfg.deployBlock}`
  const latest = await client.getBlockNumber({ cacheTime: 0 })
  const kept = settled?.key === key && settled.through <= latest ? settled : { key, through: cfg.deployBlock - 1n, events: [] }
  const fresh = await read(client, cfg, kept.through + 1n, latest)
  const all = [...kept.events, ...fresh]
  const through = latest - UNSETTLED
  if (through > kept.through) settled = { key, through, events: all.filter((e) => BigInt(e.block) <= through) }
  return { events: all, block: latest }
}

// ----------------------------------------------------------------------------------- summary

const dayOf = (at: number) => new Date(at * 1000).toISOString().slice(0, 10)
const emptyDay = (day: string): Day => ({
  day,
  purchases: 0,
  codes: 0,
  sold: 0,
  fees: 0,
  newBuyers: 0,
  redeemed: 0,
  relayed: 0,
  names: 0,
  seconds: 0,
  spent: 0,
  change: 0,
  cancelled: 0,
  cancelledValue: 0,
})

/** Each bucket holds values up to and including its edge; the last takes everything above. */
function bucketer(edges: number[], labels: string[]) {
  const buckets: Bucket[] = labels.map((label) => ({ label, codes: 0, purchases: 0 }))
  const of = (v: number) => {
    const i = edges.findIndex((e) => v <= e)
    return buckets[i === -1 ? edges.length : i]
  }
  return { buckets, of }
}

const USDC = 1_000_000
const HOUR = 3600
const MAX_BUYERS = 500
const MAX_ACTIVITY = 200
const MAX_NAMES = 20

/** Turn the vault's events into the dashboard's figures. `fee` is what a buyer pays per code. */
export function summarise(history: VaultEvent[], opts: { now: number; fee: number; relayer: Address | null }): Summary {
  const sorted = [...history].sort((a, b) => a.block - b.block || a.log - b.log)
  const days = new Map<string, Day>()
  const day = (at: number) => {
    const key = dayOf(at)
    let d = days.get(key)
    if (!d) days.set(key, (d = emptyDay(key)))
    return d
  }
  const purchases = new Map<Hex, { buyer: Address; amount: number; count: number; at: number; redeemed: number; cancelled: number }>()
  const buyers = new Map<Address, Buyer>()
  const names = new Map<string, { times: number; seconds: number }>()
  const sizes = bucketer([1, 10, 50], ['1 code', '2–10', '11–50', '51–200'])
  const values = bucketer([5, 10, 25, 50, 100].map((v) => v * USDC), ['Up to $5', '$5–10', '$10–25', '$25–50', '$50–100', 'Over $100'])
  const waits = bucketer([HOUR, 24 * HOUR, 7 * 24 * HOUR, 30 * 24 * HOUR], ['Within an hour', 'Within a day', 'Within a week', 'Within a month', 'Later'])
  const waited: number[] = []
  const activity: Activity[] = []
  let feesSwept = 0
  let held = 0
  let claimed = 0
  let relayedCount = 0
  let relayedGas = 0n
  let walletCount = 0

  for (const e of sorted) {
    const d = day(e.at)
    if (e.kind === 'bought') {
      purchases.set(e.id, { buyer: e.buyer, amount: e.amount, count: e.count, at: e.at, redeemed: 0, cancelled: 0 })
      let b = buyers.get(e.buyer)
      if (!b) {
        buyers.set(e.buyer, (b = { address: e.buyer, purchases: 0, codes: 0, sold: 0, redeemed: 0, cancelled: 0, unused: 0, unusedValue: 0, first: e.at, last: e.at }))
        d.newBuyers++
      }
      b.purchases++
      b.codes += e.count
      b.sold += e.amount * e.count
      b.last = e.at
      d.purchases++
      d.codes += e.count
      d.sold += e.amount * e.count
      d.fees += opts.fee * e.count
      const size = sizes.of(e.count)
      size.purchases!++
      size.codes += e.count
      values.of(e.amount).codes += e.count
      activity.push({ kind: 'bought', at: e.at, tx: e.tx, who: e.buyer, codes: e.count, amount: e.amount * e.count })
    } else if (e.kind === 'redeemed') {
      const p = purchases.get(e.id)
      if (p) {
        p.redeemed++
        buyers.get(p.buyer)!.redeemed++
        waited.push(e.at - p.at)
        waits.of(e.at - p.at).codes++
      }
      const relayed = !!opts.relayer && e.sender === opts.relayer
      if (relayed) {
        relayedCount++
        relayedGas += BigInt(e.gas)
        d.relayed++
      } else walletCount++
      d.redeemed++
      d.names += e.names.length
      d.spent += e.spent
      d.change += e.change
      for (const n of e.names) {
        d.seconds += n.seconds
        const name = `${n.label}.eth`
        const seen = names.get(name) ?? { times: 0, seconds: 0 }
        names.set(name, { times: seen.times + 1, seconds: seen.seconds + n.seconds })
      }
      activity.push({ kind: 'redeemed', at: e.at, tx: e.tx, who: e.sender, buyer: p?.buyer ?? null, names: e.names.map((n) => `${n.label}.eth`), spent: e.spent, change: e.change, relayed })
    } else if (e.kind === 'cancelled') {
      const p = purchases.get(e.id)
      if (p) {
        p.cancelled += e.count
        buyers.get(p.buyer)!.cancelled += e.count
      }
      d.cancelled += e.count
      d.cancelledValue += e.value
      activity.push({ kind: 'cancelled', at: e.at, tx: e.tx, who: e.buyer, codes: e.count, amount: e.value })
    } else if (e.kind === 'swept') {
      feesSwept += e.amount
      activity.push({ kind: 'swept', at: e.at, tx: e.tx, who: e.to, amount: e.amount })
    } else if (e.kind === 'refund') {
      if (e.claimed) claimed += e.amount
      else held += e.amount
      activity.push({ kind: 'refund', at: e.at, tx: e.tx, who: e.buyer, amount: e.amount, claimed: e.claimed })
    } else if (e.kind === 'renewer') {
      activity.push({ kind: 'renewer', at: e.at, tx: e.tx, who: e.renewer, change: e.change, activatesAt: e.activatesAt })
    } else {
      activity.push({ kind: 'admin', at: e.at, tx: e.tx, who: e.to, change: e.change, amount: e.amount })
    }
  }

  const codes = { sold: 0, redeemed: 0, cancelled: 0, unused: 0, unusedValue: 0 }
  for (const p of purchases.values()) {
    const unused = Math.max(0, p.count - p.redeemed - p.cancelled)
    codes.sold += p.count
    codes.redeemed += p.redeemed
    codes.cancelled += p.cancelled
    codes.unused += unused
    codes.unusedValue += unused * p.amount
    const b = buyers.get(p.buyer)!
    b.unused += unused
    b.unusedValue += unused * p.amount
  }

  // Every day from the first event to today, so a chart shows quiet days as gaps in the bars, not as missing time.
  const filled: Day[] = []
  if (sorted.length > 0) {
    const end = Math.max(opts.now, sorted[sorted.length - 1].at)
    for (let t = Date.parse(`${dayOf(sorted[0].at)}T00:00:00Z`) / 1000; dayOf(t) <= dayOf(end); t += 24 * HOUR) filled.push(days.get(dayOf(t)) ?? emptyDay(dayOf(t)))
  }

  waited.sort((a, b) => a - b)
  const everyone = [...buyers.values()]
  return {
    days: filled,
    buyers: everyone.sort((a, b) => b.sold - a.sold || a.first - b.first).slice(0, MAX_BUYERS),
    buyerCount: everyone.length,
    repeatBuyers: everyone.filter((b) => b.purchases > 1).length,
    activity: activity.reverse().slice(0, MAX_ACTIVITY),
    codes,
    sizes: sizes.buckets,
    values: values.buckets.map(({ label, codes }) => ({ label, codes })),
    redeemTime: {
      median: waited.length ? (waited.length % 2 ? waited[(waited.length - 1) / 2] : Math.round((waited[waited.length / 2 - 1] + waited[waited.length / 2]) / 2)) : null,
      buckets: waits.buckets.map(({ label, codes }) => ({ label, codes })),
    },
    topNames: [...names.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.times - a.times || b.seconds - a.seconds || a.name.localeCompare(b.name))
      .slice(0, MAX_NAMES),
    uniqueNames: names.size,
    feesSwept,
    refunds: { held, claimed },
    relayed: { count: relayedCount, gas: relayedGas.toString() },
    byWallet: { count: walletCount },
  }
}

// ----------------------------------------------------------------------------------- handler

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/** Who may read the dashboard: the address set for it, or else the vault's owner. Looked up at most once a minute. */
let owner: { key: string; at: number; address: Address } | null = null
async function adminOf(client: Client, cfg: StatsConfig): Promise<Address> {
  if (cfg.admin) return cfg.admin
  const key = `${cfg.chainId}:${cfg.vault}`
  if (owner?.key === key && Date.now() - owner.at < 60_000) return owner.address
  const address = getAddress(await client.readContract({ address: cfg.vault, abi: vaultAbi, functionName: 'owner' }))
  owner = { key, at: Date.now(), address }
  return address
}

/** A request for the same figures within a few seconds shares one read of the chain. */
let latest: { key: string; at: number; stats: Promise<Stats> } | null = null
const SHARED_MS = 5_000

async function build(client: Client, cfg: StatsConfig): Promise<Stats> {
  const call = { address: cfg.vault, abi: vaultAbi } as const
  const [{ events: all, block }, usdc, feesAccrued, paused, maxCodeAmount, fee, feeRecipient, relayer] = await Promise.all([
    history(client, cfg),
    client.readContract({ ...call, functionName: 'usdc' }),
    client.readContract({ ...call, functionName: 'feesAccrued' }),
    client.readContract({ ...call, functionName: 'paused' }),
    client.readContract({ ...call, functionName: 'maxCodeAmount' }),
    client.readContract({ ...call, functionName: 'PROTOCOL_FEE' }),
    client.readContract({ ...call, functionName: 'feeRecipient' }),
    info(cfg),
  ])
  const relayerAddress = cfg.account?.address ?? null
  const [held, balance, gasPrice, owed, governance] = await Promise.all([
    client.readContract({ address: usdc, abi: vaultAbi, functionName: 'balanceOf', args: [cfg.vault] }),
    relayerAddress ? client.getBalance({ address: relayerAddress }) : 0n,
    client.getGasPrice(),
    owedNow(client, cfg, all),
    // An older vault without these reads still gets its dashboard, without this part.
    governanceNow(client, cfg, all).catch((err) => (console.warn('stats: no governance reads', err instanceof Error ? err.message : err), null)),
  ])
  const now = Math.floor(Date.now() / 1000)
  return {
    ...summarise(all, { now, fee: Number(fee), relayer: relayerAddress }),
    chainId: cfg.chainId,
    vault: cfg.vault,
    block: Number(block),
    asOf: now,
    fee: Number(fee),
    state: { usdc: Number(held), feesAccrued: Number(feesAccrued), feeRecipient, paused, maxCodeAmount: Number(maxCodeAmount) },
    owed,
    governance,
    relayer: {
      address: relayerAddress,
      enabled: relayer.enabled,
      signer: 'signer' in relayer && relayer.signer === true,
      funded: 'funded' in relayer && relayer.funded === true,
      affordable: 'affordable' in relayer && relayer.affordable === true,
      balance: balance.toString(),
      gasPrice: gasPrice.toString(),
      maxFee: cfg.maxFeePerGas.toString(),
    },
  }
}

/** What the vault holds for buyers right now, for every buyer it has ever held a leftover for. */
async function owedNow(client: Client, cfg: StatsConfig, all: VaultEvent[]): Promise<Stats['owed']> {
  const buyers = [...new Set(all.flatMap((e) => (e.kind === 'refund' && !e.claimed ? [e.buyer] : [])))]
  const amounts = await pooled(buyers, 8, (buyer) => client.readContract({ address: cfg.vault, abi: vaultAbi, functionName: 'refundsOwed', args: [buyer] }))
  const owing = buyers.map((address, i) => ({ address, amount: Number(amounts[i]) })).filter((b) => b.amount > 0)
  return { total: owing.reduce((sum, b) => sum + b.amount, 0), buyers: owing.sort((a, b) => b.amount - a.amount) }
}

/**
 * The owner, any ownership handover, and the renewers: every address the vault's renewer events
 * have named, plus the ENS contracts, read from the vault as it stands now.
 */
async function governanceNow(client: Client, cfg: StatsConfig, all: VaultEvent[]): Promise<NonNullable<Stats['governance']>> {
  const call = { address: cfg.vault, abi: vaultAbi } as const
  const known = addresses[(cfg.chainId === 31337 ? 1 : cfg.chainId) as keyof typeof addresses] as { ethRegistrar: Address; ethRenewerV1: Address } | undefined
  const names = new Map<Address, string>(known ? [[getAddress(known.ethRegistrar), 'ENS ETHRegistrar'], [getAddress(known.ethRenewerV1), 'ENS ETHRenewerV1']] : [])
  const seen = [...new Set([...names.keys(), ...all.flatMap((e) => (e.kind === 'renewer' ? [getAddress(e.renewer)] : []))])]
  const [owner, pendingOwner, window, active, pending] = await Promise.all([
    client.readContract({ ...call, functionName: 'owner' }),
    client.readContract({ ...call, functionName: 'pendingOwner' }),
    client.readContract({ ...call, functionName: 'RENEWER_WINDOW' }),
    pooled(seen, 8, (a) => client.readContract({ ...call, functionName: 'isRenewer', args: [a] })),
    pooled(seen, 8, (a) => client.readContract({ ...call, functionName: 'pendingRenewers', args: [a] })),
  ])
  const name = (a: Address) => names.get(a) ?? null
  return {
    owner,
    pendingOwner: /^0x0+$/.test(pendingOwner) ? null : pendingOwner,
    renewers: seen.filter((_, i) => active[i]).map((address) => ({ address, name: name(address) })),
    proposals: seen.flatMap((address, i) =>
      pending[i] > 0n ? [{ address, name: name(address), activatesAt: Number(pending[i]), closesAt: Number(pending[i] + window) }] : [],
    ),
  }
}

/** Tries per caller address per minute, signed in or not. */
const calls = new Map<string, { count: number; from: number }>()
const CALLS_PER_MINUTE = 30

/** POST a sign-in ({ message, signature }, and optionally `fresh`) and get the figures back. */
export async function handleStats(request: Request, cfg: StatsConfig): Promise<Response> {
  try {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    if (/^0x0+$/.test(cfg.vault)) return json(503, { error: 'unavailable' })

    const caller = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    const now = Date.now()
    if (calls.size > 5_000) calls.clear()
    const seen = calls.get(caller)
    if (!seen || now - seen.from > 60_000) calls.set(caller, { count: 1, from: now })
    else if (++seen.count > CALLS_PER_MINUTE) return json(429, { error: 'slow_down' })

    const text = await request.text()
    let body: unknown = null
    try {
      body = text.length <= 8_000 ? JSON.parse(text) : null
    } catch {
      // Not JSON: refused below like any other request without a sign-in.
    }

    const client = clientFor(cfg)
    const admin = await adminOf(client, cfg)
    await admit(body, {
      chainId: cfg.chainId,
      admin,
      host: request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
      origins: cfg.origins,
      now: Math.floor(now / 1000),
      contractSigned: (message, signature) => client.verifyMessage({ address: admin, message, signature }),
    })

    const key = `${cfg.chainId}:${cfg.vault}`
    // `fresh` is sent right after the owner's own transaction, which a shared read might predate.
    const fresh = (body as { fresh?: unknown }).fresh === true
    if (fresh || !latest || latest.key !== key || now - latest.at > SHARED_MS) {
      const stats = build(client, cfg)
      latest = { key, at: now, stats }
      stats.catch(() => latest?.stats === stats && (latest = null))
    }
    return json(200, await latest.stats)
  } catch (err) {
    if (err instanceof Denied) return json(err.status, { error: err.code })
    console.error('stats failed', err instanceof Error ? err.message : err)
    return json(502, { error: 'unavailable' })
  }
}
