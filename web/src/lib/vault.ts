import { type Address, domainSeparator, encodeAbiParameters, erc20Abi, getAddress, type Hex, isAddress, keccak256, parseEventLogs, parseSignature, type TransactionReceipt, type WalletClient } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { vaultAbi } from './abi'
import { format, keyForSecret, parse } from './code'
import { LOG_RANGE, publicClient, USDC, VAULT, VAULT_DEPLOY_BLOCK, VAULT_DOMAIN } from './config'
import { merkleProof, merkleRoot } from './merkle'
import { ensureChainFor } from './wallet'

/**
 * The vault keeps one record per purchase: the value of each code, how many there are, and one used
 * bit per code. A purchase is found by its buyer and the Merkle root of its codes' addresses.
 */
export type BatchState = { amount: bigint; count: number; used: bigint }

/** The key a purchase is stored under: keccak256(abi.encode(buyer, root)), as in the contract. */
export const batchId = (buyer: Address, root: Hex): Hex => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [buyer, root]))

export async function readBatch(id: Hex): Promise<BatchState | null> {
  const [amount, count, used] = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'batches', args: [id] })
  return count === 0 ? null : { amount: BigInt(amount), count, used }
}

const read = <F extends 'maxCodeAmount' | 'PROTOCOL_FEE' | 'MAX_BATCH' | 'MAX_NAMES'>(functionName: F) =>
  publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName })

export const maxCodeAmount = () => read('maxCodeAmount')
/** The fixed protocol fee per code, paid on top of its value (0.05 USDC). */
export const protocolFee = () => read('PROTOCOL_FEE')
export const maxBatch = () => read('MAX_BATCH')

export const usdcBalance = (owner: Address) =>
  publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })

async function confirmed(hash: Hex, onStep?: (text: string) => void): Promise<TransactionReceipt> {
  onStep?.('Waiting for the network to confirm…')
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('The transaction failed.')
  // What is read next must include this block: the provider's nodes don't all move in step, and
  // the block number seen while waiting can be one behind the block the receipt is in.
  if (receipt.blockNumber > floor) floor = receipt.blockNumber
  head = null
  return receipt
}

/**
 * Fund one purchase of codes of the same amount. `codes` are the addresses of the codes' keys, in
 * order. The buyer pays each code's value plus the protocol fee. Uses an existing allowance if there
 * is one, otherwise a USDC permit for the total, and falls back to an approve transaction if a
 * permit would not work for this wallet.
 *
 * Returns the block the purchase landed in: it becomes part of each code (see `code.ts`).
 */
export async function createCodes(
  wallet: WalletClient,
  buyer: Address,
  codes: Address[],
  amount: bigint,
  onStep: (text: string) => void,
): Promise<{ hash: Hex; block: bigint }> {
  await ensureChainFor(wallet)
  const many = codes.length > 1
  const total = (amount + (await protocolFee())) * BigInt(codes.length)
  const allowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [buyer, VAULT] })
  const confirmText = many ? `Confirm the purchase of ${codes.length} codes in your wallet…` : 'Confirm the purchase in your wallet…'
  const base = { account: buyer, address: VAULT, abi: vaultAbi } as const
  const done = (receipt: TransactionReceipt) => ({ hash: receipt.transactionHash, block: receipt.blockNumber })

  const create = async () =>
    done(await confirmed(await wallet.writeContract({ ...base, chain: wallet.chain, functionName: 'create', args: [codes, amount] }), onStep))

  if (allowance >= total) {
    onStep(confirmText)
    return create()
  }

  // Wallets with code (smart accounts, EIP-7702 delegations) make USDC verify the permit via
  // ERC-1271, which many don't support. Use a plain approve for them.
  const hasCode = !!(await publicClient.getCode({ address: buyer }))
  const permitDomain = hasCode ? null : await usdcPermitDomain()
  if (permitDomain) {
    onStep('Approve the USDC payment in your wallet (a signature, no fee)…')
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const nonce = await publicClient.readContract({ address: USDC, abi: permitAbi, functionName: 'nonces', args: [buyer] })
    const sig = await wallet.signTypedData({
      account: buyer,
      domain: permitDomain,
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: { owner: buyer, spender: VAULT, value: total, nonce, deadline },
    })
    const { v, r, s, yParity } = parseSignature(sig)
    const vv = Number(v ?? BigInt(yParity + 27))
    const call = { ...base, functionName: 'createWithPermit', args: [codes, amount, deadline, vv, r, s] } as const
    // Check the permit would work before asking for a transaction.
    const works = await publicClient.simulateContract(call).then(
      () => true,
      () => false,
    )
    if (works) {
      onStep(confirmText)
      return done(await confirmed(await wallet.writeContract({ ...call, chain: wallet.chain }), onStep))
    }
  }

  onStep('Approve USDC for the claim codes in your wallet…')
  await confirmed(
    await wallet.writeContract({ account: buyer, chain: wallet.chain, address: USDC, abi: erc20Abi, functionName: 'approve', args: [VAULT, total] }),
    onStep,
  )
  onStep(confirmText)
  return create()
}

const permitAbi = [
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'DOMAIN_SEPARATOR', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

/**
 * The token's EIP-712 permit domain, or null if we can't reproduce its DOMAIN_SEPARATOR.
 *
 * Mainnet USDC reports its version ("2"). Sepolia's test USDC has no `version()`, so the usual
 * values are tried instead. Either way a domain is only used if it hashes to the token's own
 * separator, so a wrong guess can't produce a bad signature.
 */
async function usdcPermitDomain() {
  try {
    const [name, separator, reported] = await Promise.all([
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'name' }),
      publicClient.readContract({ address: USDC, abi: permitAbi, functionName: 'DOMAIN_SEPARATOR' }),
      publicClient.readContract({ address: USDC, abi: permitAbi, functionName: 'version' }).catch(() => null),
    ])
    for (const version of reported ? [reported] : ['1', '2']) {
      const domain = { name, version, chainId: VAULT_DOMAIN.chainId, verifyingContract: USDC }
      if (domainSeparator({ domain }) === separator) return domain
    }
    return null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ a code, from the code itself

/**
 * Everything needed to spend one code: its key, the purchase it belongs to, its position there and
 * the proof of that position.
 */
export type Claim = {
  code: string
  key: PrivateKeyAccount
  id: Hex
  buyer: Address
  root: Hex
  index: number
  proof: Hex[]
  /** The code's value. */
  amount: bigint
  /** Redeemed or cancelled. */
  used: boolean
  /** The block the code was bought in. */
  block: bigint
}

/**
 * Find a code onchain. The code names the block it was bought in, so one request for that block's
 * vault events gives the purchase and every code in it, which is what the proof is built from.
 * Returns null if no purchase contains this code.
 */
export async function findCode(input: string): Promise<Claim | null> {
  const parsed = parse(input)
  if (!parsed.ok) return null
  const key = keyForSecret(parsed.secret)
  const mine = key.address.toLowerCase()
  const at = VAULT_DEPLOY_BLOCK + BigInt(parsed.offset)
  // A code can't have been bought in a block that doesn't exist yet, and providers refuse to
  // search past the chain's head, so every range below stops there.
  const latest = await latestBlock()
  if (at > latest) return null

  let events = await publicClient.getContractEvents({ address: VAULT, abi: vaultAbi, fromBlock: at, toBlock: at })
  let hits = events.filter((e) => e.eventName === 'Issued' && e.args.code?.toLowerCase() === mine)
  if (hits.length === 0) {
    // A chain reorganisation can move a purchase by a few blocks: look just around it.
    const from = at > VAULT_DEPLOY_BLOCK + 8n ? at - 8n : VAULT_DEPLOY_BLOCK
    const to = at + 64n < latest ? at + 64n : latest
    const nearby = await publicClient.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: 'Issued', args: { code: key.address }, fromBlock: from, toBlock: to })
    if (nearby.length === 0) return null
    const block = nearby[0].blockNumber!
    events = await publicClient.getContractEvents({ address: VAULT, abi: vaultAbi, fromBlock: block, toBlock: block })
    hits = events.filter((e) => e.eventName === 'Issued' && e.args.code?.toLowerCase() === mine)
  }

  // An address can be listed in more than one purchase. Take the one worth spending: unused first,
  // then the most valuable.
  const claims: Claim[] = []
  for (const hit of hits) {
    if (hit.eventName !== 'Issued') continue
    const id = hit.args.id!
    const created = events.find((e) => e.eventName === 'Created' && e.args.id === id)
    if (!created || created.eventName !== 'Created') continue
    const codes = events
      .flatMap((e) => (e.eventName === 'Issued' && e.args.id === id ? [{ index: Number(e.args.index!), code: e.args.code! }] : []))
      .sort((a, b) => a.index - b.index)
      .map((c) => c.code)
    const root = created.args.root!
    // The events must reproduce the root the vault stored; otherwise no proof can be built from them.
    if (codes.length !== Number(created.args.count!) || merkleRoot(codes) !== root) continue
    const state = await readBatch(id)
    if (!state) continue
    const index = Number(hit.args.index!)
    claims.push({
      code: format(input),
      key,
      id,
      buyer: created.args.buyer!,
      root,
      index,
      proof: merkleProof(codes, index),
      amount: state.amount,
      used: (state.used >> BigInt(index)) % 2n === 1n,
      block: hit.blockNumber!,
    })
  }
  claims.sort((a, b) => (a.used !== b.used ? (a.used ? 1 : -1) : a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1))
  return claims[0] ?? null
}

/** One name in a redemption: which ENS contract renews it, and for how long. */
export type RenewalItem = { renewer: Address; label: string; duration: bigint }

/**
 * The code key's signature over a redemption: the whole list of names, the most that may be spent,
 * and the one address allowed to submit it. Valid for 30 minutes.
 */
async function signRedeem(claim: Claim, renewals: RenewalItem[], maxAmount: bigint, submitter: Address) {
  const message = {
    buyer: claim.buyer,
    root: claim.root,
    index: BigInt(claim.index),
    renewals,
    maxAmount,
    relayer: submitter,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
  }
  const sig = await claim.key.signTypedData({
    domain: VAULT_DOMAIN,
    types: {
      Redeem: [
        { name: 'buyer', type: 'address' },
        { name: 'root', type: 'bytes32' },
        { name: 'index', type: 'uint256' },
        { name: 'renewals', type: 'Renewal[]' },
        { name: 'maxAmount', type: 'uint256' },
        { name: 'relayer', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
      Renewal: [
        { name: 'renewer', type: 'address' },
        { name: 'label', type: 'string' },
        { name: 'duration', type: 'uint64' },
      ],
    },
    primaryType: 'Redeem',
    message,
  })
  return { message, sig }
}

/**
 * Spend a code, once, on the given names. The code key signs the whole list, bound to the
 * recipient's own wallet, and that wallet sends it. The transaction is dry-run first, so a name
 * that stopped being renewable or a code that was just cancelled fails here, before any gas is paid.
 *
 * `renewals` on the same renewer must be next to each other (the vault makes one call per run), and
 * `maxAmount` is the exact total ENS will charge: nothing more can leave the code.
 */
export async function redeem(
  wallet: WalletClient,
  submitter: Address,
  claim: Claim,
  renewals: RenewalItem[],
  maxAmount: bigint,
  onStep: (text: string) => void,
): Promise<Hex> {
  await ensureChainFor(wallet)
  const { message, sig } = await signRedeem(claim, renewals, maxAmount, submitter)
  const call = { account: submitter, address: VAULT, abi: vaultAbi, functionName: 'redeem', args: [message, sig, claim.proof] } as const
  onStep('Checking the renewal…')
  await publicClient.simulateContract(call)
  onStep('Confirm the renewal in your wallet…')
  return (await confirmed(await wallet.writeContract({ ...call, chain: wallet.chain }), onStep)).transactionHash
}

/** The relayer said no. `stepAside` means it can't help right now and a wallet should be offered. */
export class RelayError extends Error {
  constructor(
    message: string,
    readonly stepAside: boolean,
  ) {
    super(message)
  }
}

/**
 * The address of the site's relayer, which pays the network fee so a code can be used without a
 * wallet. Null when relaying is off, out of gas, or the network is too busy for it.
 */
export async function relayerAddress(): Promise<Address | null> {
  try {
    const res = await fetch('/api/redeem', { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const info = (await res.json()) as { enabled?: boolean; chainId?: number; vault?: string; relayer?: string }
    if (!info.enabled || info.chainId !== VAULT_DOMAIN.chainId || !info.relayer || !isAddress(info.relayer)) return null
    if (!info.vault || info.vault.toLowerCase() !== VAULT.toLowerCase()) return null
    return getAddress(info.relayer)
  } catch {
    return null
  }
}

/**
 * Spend a code without a wallet: the code key signs the redemption for the relayer, and the relayer
 * sends it and pays the fee. The relayer can only submit what was signed; the code's money still
 * goes only to ENS, with anything left over back to the buyer.
 */
export async function redeemRelayed(relayer: Address, claim: Claim, renewals: RenewalItem[], maxAmount: bigint, onStep: (text: string) => void): Promise<Hex> {
  const { message, sig } = await signRedeem(claim, renewals, maxAmount, relayer)
  onStep('Checking the renewal…')
  await publicClient.simulateContract({ account: relayer, address: VAULT, abi: vaultAbi, functionName: 'redeem', args: [message, sig, claim.proof] })
  onStep('Sending the renewal…')
  const res = await fetch('/api/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redeem: {
        ...message,
        index: message.index.toString(),
        maxAmount: message.maxAmount.toString(),
        deadline: message.deadline.toString(),
        renewals: message.renewals.map((r) => ({ ...r, duration: r.duration.toString() })),
      },
      signature: sig,
      proof: claim.proof,
    }),
  }).catch(() => null)
  const out = res ? ((await res.json().catch(() => null)) as { hash?: Hex; error?: string; message?: string } | null) : null
  if (!res?.ok || !out?.hash) {
    const stepAside = !res || res.status >= 500 || res.status === 404 || out?.error === 'too_large'
    throw new RelayError(out?.message ?? 'Renewing without a wallet isn’t available right now.', stepAside)
  }
  return (await confirmed(out.hash, onStep)).transactionHash
}

/** Codes to cancel in one purchase: its root and one bit per code. */
export type CancelItem = { root: Hex; mask: bigint }

/** Cancel unused codes across purchases, `MAX_BATCH` purchases per transaction. Codes used meanwhile are skipped onchain. */
/**
 * Returns what was actually cancelled, by purchase id, one bit per code: taken from the
 * transactions' own events, so it is right even if a code was redeemed while this was pending.
 */
export async function cancelCodes(wallet: WalletClient, buyer: Address, items: CancelItem[], onStep?: (text: string) => void): Promise<Map<Hex, bigint>> {
  await ensureChainFor(wallet)
  const size = Number(await maxBatch())
  const parts = Math.ceil(items.length / size)
  const done = new Map<Hex, bigint>()
  for (let i = 0; i < items.length; i += size) {
    onStep?.(parts > 1 ? `Confirm cancel ${i / size + 1} of ${parts} in your wallet…` : 'Confirm in your wallet…')
    const receipt = await confirmed(
      await wallet.writeContract({ account: buyer, chain: wallet.chain, address: VAULT, abi: vaultAbi, functionName: 'cancel', args: [items.slice(i, i + size)] }),
      onStep,
    )
    const mine = receipt.logs.filter((l) => l.address.toLowerCase() === VAULT.toLowerCase())
    for (const l of parseEventLogs({ abi: vaultAbi, eventName: 'Cancelled', logs: mine })) {
      const id = l.args.id.toLowerCase() as Hex
      done.set(id, (done.get(id) ?? 0n) | l.args.mask)
    }
  }
  return done
}

// ------------------------------------------------------------------------------------- history

/** The chain's latest block, shared by the history reads that start together. */
let head: { at: number; block: Promise<bigint> } | null = null
/** The newest block one of our own transactions confirmed in: history is never read short of it. */
let floor = 0n
function latestBlock(): Promise<bigint> {
  if (!head || Date.now() - head.at > 5_000) head = { at: Date.now(), block: freshHead() }
  return head.block
}
/** The latest block, waiting a few seconds for the provider to catch up with `floor` if it is behind. */
async function freshHead(): Promise<bigint> {
  for (let tries = 0; ; tries++) {
    const latest = await publicClient.getBlockNumber({ cacheTime: 0 })
    if (latest >= floor || tries >= 12) return latest
    await new Promise((r) => setTimeout(r, 500))
  }
}

/**
 * Read history from `fromBlock` to now in windows of at most LOG_RANGE blocks, a few at a time, and
 * return everything oldest first. One request over the whole range would be refused once the vault
 * is older than the provider's cap.
 */
async function paged<T>(fromBlock: bigint, read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>): Promise<T[]> {
  const latest = await latestBlock()
  const windows: [bigint, bigint][] = []
  for (let from = fromBlock; from <= latest; from += LOG_RANGE) windows.push([from, from + LOG_RANGE - 1n < latest ? from + LOG_RANGE - 1n : latest])
  const pages: T[][] = new Array(windows.length)
  let next = 0
  const worker = async () => {
    while (next < windows.length) {
      const i = next++
      pages[i] = await read(...windows[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, windows.length) }, worker))
  return pages.flat()
}

/** One purchase, from its Created event. */
export type Purchase = { id: Hex; root: Hex; amount: bigint; count: number; tx: Hex; block: bigint }

/** The purchases this wallet made, oldest first. Its codes are numbered in this order. */
export async function purchasesBy(buyer: Address, fromBlock: bigint): Promise<Purchase[]> {
  const logs = await paged(fromBlock, (from, to) =>
    publicClient.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: 'Created', args: { buyer }, fromBlock: from, toBlock: to }),
  )
  return logs
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex! - b.logIndex! : a.blockNumber! < b.blockNumber! ? -1 : 1))
    .map((l) => ({ id: l.args.id!, root: l.args.root!, amount: l.args.amount!, count: Number(l.args.count!), tx: l.transactionHash!, block: l.blockNumber! }))
}

/** The used bits of each purchase (redeemed or cancelled), by purchase id. Sent as one request. */
export async function usedBits(ids: Hex[]): Promise<Map<Hex, bigint>> {
  const states = await Promise.all(ids.map((id) => readBatch(id)))
  return new Map(ids.map((id, i) => [id, states[i]?.used ?? 0n]))
}

/** The codes this wallet cancelled: one bit per code, by purchase id. */
export async function cancelledBits(buyer: Address, fromBlock: bigint): Promise<Map<Hex, bigint>> {
  const logs = await paged(fromBlock, (from, to) =>
    publicClient.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: 'Cancelled', args: { buyer }, fromBlock: from, toBlock: to }),
  )
  const out = new Map<Hex, bigint>()
  for (const l of logs) out.set(l.args.id!, (out.get(l.args.id!) ?? 0n) | l.args.mask!)
  return out
}

/** Block times in seconds for a set of blocks, one request per distinct block. */
export async function blockTimes(blocks: bigint[]): Promise<Map<bigint, bigint>> {
  const unique = [...new Set(blocks)]
  return new Map(await Promise.all(unique.map(async (b) => [b, (await publicClient.getBlock({ blockNumber: b })).timestamp] as const)))
}

/** One code's redemption: the names it renewed, what ENS was paid and what went back to the buyer. */
export type Redemption = {
  /** The purchase and the code's position in it. */
  id: Hex
  index: number
  /** The address of the code's key. */
  code: Address
  renewals: { label: string; duration: bigint }[]
  spent: bigint
  refunded: bigint
  tx: Hex
  block: bigint
  logIndex: number
  /** Block time in seconds. */
  at: bigint
}

/** The redemptions of codes in these purchases, newest first, from the vault's Redeemed events. */
export async function redemptionsOf(ids: Hex[], fromBlock: bigint): Promise<Redemption[]> {
  const CHUNK = 100 // keep the topic filter a reasonable size for public RPCs
  const chunks: Hex[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
  const logs = (
    await Promise.all(
      chunks.map((id) =>
        paged(fromBlock, (from, to) =>
          publicClient.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: 'Redeemed', args: { id }, fromBlock: from, toBlock: to }),
        ),
      ),
    )
  ).flat()
  const times = await blockTimes(logs.map((l) => l.blockNumber!))
  return logs
    .map((l) => ({
      id: l.args.id!,
      index: Number(l.args.index!),
      code: l.args.code!,
      renewals: l.args.renewals!.map((r) => ({ label: r.label, duration: r.duration })),
      spent: l.args.spent!,
      refunded: l.args.refunded!,
      tx: l.transactionHash!,
      block: l.blockNumber!,
      logIndex: l.logIndex!,
      at: times.get(l.blockNumber!) ?? 0n,
    }))
    .sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block < b.block ? 1 : -1))
}

/** What happened to a code that has been used: the redemption, or that its buyer cancelled it. */
export async function outcomeOf(claim: Claim): Promise<{ kind: 'redeemed'; redemption: Redemption } | { kind: 'cancelled' } | null> {
  const redeemed = (await redemptionsOf([claim.id], claim.block).catch(() => [])).find((r) => r.index === claim.index)
  if (redeemed) return { kind: 'redeemed', redemption: redeemed }
  const cancelled = await paged(claim.block, (from, to) =>
    publicClient.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: 'Cancelled', args: { id: claim.id }, fromBlock: from, toBlock: to }),
  ).catch(() => [])
  return cancelled.some((l) => (l.args.mask! >> BigInt(claim.index)) % 2n === 1n) ? { kind: 'cancelled' } : null
}
