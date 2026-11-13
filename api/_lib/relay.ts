import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  parseGwei,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem'
import { devAccount, kmsAccount, kmsSignerFromEnv } from './signer.js'

/**
 * The relayer: it pays the network fee so someone with a claim code can renew names without a
 * wallet. It can't touch the code's money. The vault sends that only to ENS or back to the buyer,
 * and the code's own signature fixes the names, the durations and the most that can be spent.
 *
 * The relayer key signs exactly one kind of transaction, built here and nowhere else: `redeem` on
 * the one configured vault. Nothing a caller sends chooses the target, the function, the value or
 * the gas price. A redemption is dry-run first, so one that would fail costs no gas.
 */

export type RelayConfig = {
  chainId: number
  /** Tried in order: the site's own RPC first, then public ones, so one that is down or rate-limiting can't stop a renewal. */
  rpcUrls: string[]
  vault: Address
  /** Null: relaying is switched off and the site asks for a wallet instead. */
  account: LocalAccount | null
  /** Above this fee per gas (wei) the relayer steps aside, so a gas spike can't drain it. */
  maxFeePerGas: bigint
  /** Pages allowed to call this. Empty: any (the local fork). */
  origins: string[]
}

const DEFAULT_RPCS: Record<number, string[]> = {
  1: ['https://ethereum-rpc.publicnode.com', 'https://eth.merkle.io', 'https://1rpc.io/eth'],
  11155111: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://1rpc.io/sepolia'],
  31337: ['http://127.0.0.1:8545'],
}
/** The default ceiling on the network fee, in gwei, for each chain. */
const DEFAULT_MAX_FEE_GWEI: Record<number, string> = { 1: '3', 11155111: '200', 31337: '1000' }

/** Settings for a deployment, from its environment. Throws on a half-configured signer. */
export function configFromEnv(env: Record<string, string | undefined>): RelayConfig {
  const chainId = Number(env.VITE_CHAIN_ID ?? 31337)
  const vault = env.VITE_VAULT
  const signer = chainId === 31337 ? null : kmsSignerFromEnv(env)
  const account = !vault || !isAddress(vault) ? null : chainId === 31337 ? devAccount() : signer ? kmsAccount(signer) : null
  return {
    chainId,
    // RPCs named for the relayer come first, then the site's own, then public ones.
    rpcUrls: [...new Set([...list(env.RELAYER_RPC_URL), ...list(env.VITE_RPC_URL), ...(DEFAULT_RPCS[chainId] ?? [])])],
    vault: (vault && isAddress(vault) ? getAddress(vault) : '0x0000000000000000000000000000000000000000') as Address,
    account,
    maxFeePerGas: parseGwei(env.RELAYER_MAX_FEE_GWEI || DEFAULT_MAX_FEE_GWEI[chainId] || '3'),
    origins: list(env.RELAYER_ORIGINS),
  }
}

/** A comma-separated setting as a list. */
const list = (value: string | undefined) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// ------------------------------------------------------------------------------------ the call

export const redeemAbi = [
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'r',
        type: 'tuple',
        components: [
          { name: 'buyer', type: 'address' },
          { name: 'root', type: 'bytes32' },
          { name: 'index', type: 'uint256' },
          {
            name: 'renewals',
            type: 'tuple[]',
            components: [
              { name: 'renewer', type: 'address' },
              { name: 'label', type: 'string' },
              { name: 'duration', type: 'uint64' },
            ],
          },
          { name: 'maxAmount', type: 'uint256' },
          { name: 'relayer', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { name: 'sig', type: 'bytes' },
      { name: 'proof', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  ...['BadCodeSignature', 'BadRenewals', 'CodeUsed', 'InsufficientBalance', 'NotRenewer', 'Overspent', 'SignatureExpired', 'UnknownCode', 'WrongRelayer'].map(
    (name) => ({ type: 'error', name, inputs: [] }) as const,
  ),
] as const

type RedeemArgs = readonly [
  { buyer: Address; root: Hex; index: bigint; renewals: { renewer: Address; label: string; duration: bigint }[]; maxAmount: bigint; relayer: Address; deadline: bigint },
  Hex,
  Hex[],
]

/** Limits on what a request may contain. The vault enforces its own; these keep junk off the RPC. */
const MAX_BODY = 20_000
const MAX_NAMES = 10
const MAX_PROOF = 16
const MAX_LABEL = 255
/** How far ahead a confirmation may be dated. The site signs for 30 minutes. */
const MAX_DEADLINE_AHEAD = 60 * 60
/** No redemption needs more gas than this; a request that estimates higher is refused. */
const GAS_CEILING = 3_000_000n
/** The balance below which the relayer reports itself unavailable: one large redemption's worth. */
const FLOOR_GAS = 1_200_000n

class Refused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message)
  }
}

const uint = (v: unknown, bits: number): bigint => {
  if (typeof v !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(v)) throw new Refused(400, 'bad_request', 'The request is not valid.')
  const n = BigInt(v)
  if (n >= 1n << BigInt(bits)) throw new Refused(400, 'bad_request', 'The request is not valid.')
  return n
}
const address = (v: unknown): Address => {
  if (typeof v !== 'string' || !isAddress(v, { strict: false })) throw new Refused(400, 'bad_request', 'The request is not valid.')
  return getAddress(v)
}
const bytes = (v: unknown, length: number): Hex => {
  if (typeof v !== 'string' || !isHex(v, { strict: true }) || v.length !== 2 + length * 2) throw new Refused(400, 'bad_request', 'The request is not valid.')
  return v
}

/** Read a request body into the vault's arguments, refusing anything out of shape. */
export function parseRedeem(body: unknown, relayer: Address, now: number): RedeemArgs {
  const bad = () => new Refused(400, 'bad_request', 'The request is not valid.')
  if (!body || typeof body !== 'object') throw bad()
  const { redeem, signature, proof } = body as Record<string, unknown>
  if (!redeem || typeof redeem !== 'object' || !Array.isArray(proof) || proof.length > MAX_PROOF) throw bad()
  const r = redeem as Record<string, unknown>
  if (!Array.isArray(r.renewals) || r.renewals.length === 0 || r.renewals.length > MAX_NAMES) throw bad()
  const renewals = r.renewals.map((x) => {
    if (!x || typeof x !== 'object') throw bad()
    const { renewer, label, duration } = x as Record<string, unknown>
    if (typeof label !== 'string' || label.length === 0 || label.length > MAX_LABEL) throw bad()
    return { renewer: address(renewer), label, duration: uint(duration, 64) }
  })
  const message = {
    buyer: address(r.buyer),
    root: bytes(r.root, 32),
    index: uint(r.index, 8),
    renewals,
    maxAmount: uint(r.maxAmount, 96),
    relayer: address(r.relayer),
    deadline: uint(r.deadline, 64),
  }
  // Signed for this relayer and nobody else, so a copy of the request is useless to anyone.
  if (message.relayer !== relayer) throw new Refused(400, 'wrong_relayer', 'This confirmation was made for a different relayer. Reload the page and try again.')
  if (message.deadline <= BigInt(now)) throw new Refused(400, 'expired', 'This confirmation timed out. Try again.')
  if (message.deadline > BigInt(now + MAX_DEADLINE_AHEAD)) throw bad()
  return [message, bytes(signature, 65), proof.map((p) => bytes(p, 32))]
}

// ------------------------------------------------------------------------------- per instance

/* Guards kept in memory by each instance: a repeated request gets the same transaction back, each
   caller has a rate limit, and sends are queued so no two take the same nonce. */

/** Redemptions sent in the last few minutes, by code: a repeat gets the same transaction back. */
const recent = new Map<string, { hash: Hex; at: number }>()
const RECENT_MS = 3 * 60_000
/** Requests per caller address per minute. */
const calls = new Map<string, { count: number; from: number }>()
const CALLS_PER_MINUTE = 12
/** One send at a time, so two requests never take the same nonce. */
let queue: Promise<unknown> = Promise.resolve()

function limited(caller: string, now: number): boolean {
  if (calls.size > 5_000) calls.clear()
  const c = calls.get(caller)
  if (!c || now - c.from > 60_000) {
    calls.set(caller, { count: 1, from: now })
    return false
  }
  return ++c.count > CALLS_PER_MINUTE
}

let availability: { at: number; funded: boolean; affordable: boolean } | null = null

/**
 * Can this deployment actually sign? Asked once per instance (and again a minute after a failure)
 * by signing a fixed message, which is prefixed text and so can never be a transaction. Without
 * this, a wrong role or key would only show up as a failed renewal.
 */
let signerCheck: { at: number; ok: Promise<boolean> } | null = null
function signerWorks(account: LocalAccount): Promise<boolean> {
  const now = Date.now()
  if (signerCheck && (now - signerCheck.at < 60_000 || signerCheck.ok === SIGNER_OK)) return signerCheck.ok
  const ok = account.signMessage({ message: 'ens.codes relayer self-check' }).then(
    () => {
      signerCheck = { at: now, ok: SIGNER_OK }
      return true
    },
    (err) => {
      console.error('relayer signer check failed', err instanceof Error ? err.message : err)
      return false
    },
  )
  signerCheck = { at: now, ok }
  return ok
}
const SIGNER_OK = Promise.resolve(true)

// ------------------------------------------------------------------------------------ handler

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export const clientFor = (cfg: RelayConfig) =>
  createPublicClient({ transport: fallback(cfg.rpcUrls.map((url) => http(url, { timeout: 8_000, retryCount: 0 })), { rank: false, retryCount: 1 }) })

/** GET: is relaying on, and which address must a confirmation name? POST: relay one redemption. */
export async function handle(request: Request, cfg: RelayConfig): Promise<Response> {
  try {
    if (request.method === 'GET') return json(200, await info(cfg))
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    return json(200, await relay(request, cfg))
  } catch (err) {
    if (err instanceof Refused) return json(err.status, { error: err.code, message: err.message, ...(err.detail ? { name: err.detail } : {}) })
    console.error('relay failed', err instanceof Error ? err.message : err)
    return json(502, { error: 'unavailable', message: 'The relayer couldn’t send this right now.' })
  }
}

/**
 * `enabled` is all the site needs: the relayer can sign, has gas, and the fee is under its ceiling.
 * The other fields say which of those is missing, for whoever operates it.
 */
export async function info(cfg: RelayConfig) {
  if (!cfg.account) return { enabled: false as const, chainId: cfg.chainId }
  const now = Date.now()
  if (!availability || now - availability.at > 30_000) {
    try {
      const client = clientFor(cfg)
      const [balance, price] = await Promise.all([client.getBalance({ address: cfg.account.address }), client.getGasPrice()])
      availability = { at: now, funded: balance >= FLOOR_GAS * price, affordable: price <= cfg.maxFeePerGas }
    } catch {
      availability = { at: now, funded: false, affordable: false }
    }
  }
  const signer = await signerWorks(cfg.account)
  const { funded, affordable } = availability
  return { enabled: signer && funded && affordable, chainId: cfg.chainId, vault: cfg.vault, relayer: cfg.account.address, signer, funded, affordable }
}

async function relay(request: Request, cfg: RelayConfig): Promise<{ hash: Hex }> {
  const account = cfg.account
  if (!account) throw new Refused(503, 'off', 'Renewing without a wallet isn’t available right now.')
  const origin = request.headers.get('origin')
  if (cfg.origins.length > 0 && (!origin || !cfg.origins.includes(origin))) throw new Refused(403, 'forbidden', 'This page can’t use the relayer.')
  const caller = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  if (limited(caller, Date.now())) throw new Refused(429, 'slow_down', 'Too many tries. Wait a minute and try again.')

  const text = await request.text()
  if (text.length > MAX_BODY) throw new Refused(413, 'bad_request', 'The request is not valid.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Refused(400, 'bad_request', 'The request is not valid.')
  }
  const args = parseRedeem(body, account.address, Math.floor(Date.now() / 1000))
  const key = `${args[0].buyer}:${args[0].root}:${args[0].index}`.toLowerCase()
  const now = Date.now()
  for (const [k, v] of recent) if (now - v.at > RECENT_MS) recent.delete(k)
  const sent = recent.get(key)
  if (sent) return { hash: sent.hash }

  const send = async (): Promise<{ hash: Hex }> => {
    const again = recent.get(key)
    if (again) return { hash: again.hash }
    const client = clientFor(cfg)
    const call = { account: account.address, address: cfg.vault, abi: redeemAbi, functionName: 'redeem', args } as const

    // Dry run. Whatever would fail onchain fails here, before the relayer pays for anything.
    let gas: bigint
    try {
      gas = await client.estimateContractGas(call)
    } catch (err) {
      const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null
      const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined
      throw new Refused(422, 'would_fail', 'This renewal would fail. Check the code and the names, then try again.', name)
    }
    gas = (gas * 12n) / 10n
    if (gas > GAS_CEILING) throw new Refused(422, 'too_large', 'This renewal is too large to send without a wallet.')

    const [fees, balance] = await Promise.all([client.estimateFeesPerGas(), client.getBalance({ address: account.address })])
    if (fees.maxFeePerGas > cfg.maxFeePerGas) throw new Refused(503, 'busy', 'The network is too busy to renew without a wallet right now.')
    if (balance < gas * fees.maxFeePerGas) throw new Refused(503, 'off', 'Renewing without a wallet isn’t available right now.')

    const data = encodeFunctionData({ abi: redeemAbi, functionName: 'redeem', args })
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
      const raw = await account.signTransaction({
        type: 'eip1559',
        chainId: cfg.chainId,
        to: cfg.vault,
        data,
        value: 0n,
        nonce,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      })
      try {
        const hash = await client.sendRawTransaction({ serializedTransaction: raw })
        recent.set(key, { hash, at: Date.now() })
        availability = null
        return { hash }
      } catch (err) {
        lastError = err
        const why = err instanceof Error ? err.message : ''
        // One RPC took the transaction and a second was then offered the same one: it is sent.
        if (/already known|already imported|known transaction/i.test(why)) {
          const hash = keccak256(raw)
          recent.set(key, { hash, at: Date.now() })
          availability = null
          return { hash }
        }
        // Another instance took this nonce a moment ago: read it again and re-sign.
        if (!/nonce|replacement/i.test(why)) break
      }
    }
    throw lastError
  }

  const result = queue.then(send, send)
  queue = result.catch(() => {})
  return result
}
