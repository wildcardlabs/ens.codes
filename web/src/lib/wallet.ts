import { useSyncExternalStore } from 'react'
import { type Address, createWalletClient, custom, type EIP1193Provider, numberToHex, type WalletClient } from 'viem'
import { chain, DEV_WALLET, walletChain } from './config'

/** EIP-6963 wallet discovery and the connected wallet, as a small store for React. */

export type WalletInfo = { uuid: string; name: string; icon?: string; rdns?: string }
export type Discovered = { info: WalletInfo; provider: EIP1193Provider }
export type Connected = { client: WalletClient; address: Address; name: string; provider: EIP1193Provider }

type State = {
  wallets: Discovered[]
  connected: Connected | null
  connecting: string | null
  /** True while the wallet used last time is being picked up again after a page load. */
  restoring: boolean
}

/**
 * Which wallet was connected last, so a reload doesn't log the person out. Only the wallet's
 * identifier is kept. The wallet itself still decides: it is asked for the accounts it already
 * shares with this site (`eth_accounts`, which never opens a prompt), and if it shares none the
 * person simply logs in again.
 */
const REMEMBERED = 'ens.codes:wallet'
const idOf = (w: Discovered) => w.info.rdns ?? w.info.name
function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}
function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(REMEMBERED, id)
    else localStorage.removeItem(REMEMBERED)
  } catch {
    // Storage is unavailable (private mode): the wallet just isn't remembered.
  }
}

let state: State = { wallets: [], connected: null, connecting: null, restoring: typeof window !== 'undefined' && !!remembered() }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { detail } = event as CustomEvent<Discovered>
    if (state.wallets.some((w) => w.info.uuid === detail.info.uuid)) return
    set({ wallets: [...state.wallets, detail] })
    if (state.restoring && idOf(detail) === remembered()) void restore(detail)
  })
  // The remembered wallet never announced itself (removed or disabled): stop waiting for it.
  setTimeout(() => state.restoring && set({ restoring: false }), 1500)
  if (DEV_WALLET) announceDevWallet()
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

export function useWallet() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

export async function connect(w: Discovered): Promise<void> {
  set({ connecting: w.info.uuid })
  try {
    const [address] = (await w.provider.request({ method: 'eth_requestAccounts' })) as Address[]
    await ensureChain(w.provider)
    adopt(w, address)
    remember(idOf(w))
  } finally {
    set({ connecting: null, restoring: false })
  }
}

export function disconnect() {
  remember(null)
  set({ connected: null })
}

/** Pick the remembered wallet up again without a prompt, if it still shares an account and is on this app's chain. */
async function restore(w: Discovered) {
  try {
    const accounts = (await w.provider.request({ method: 'eth_accounts' })) as Address[]
    const current = Number(await w.provider.request({ method: 'eth_chainId' }))
    // On another chain, leave it to the login button, which asks the wallet to switch.
    if (accounts.length && current === chain.id && !state.connected) adopt(w, accounts[0])
  } catch {
    // The wallet refused or isn't ready: the person logs in as usual.
  } finally {
    set({ restoring: false })
  }
}

const watched = new WeakSet<EIP1193Provider>()
function adopt(w: Discovered, address: Address) {
  set({ connected: makeConnected(w, address) })
  if (watched.has(w.provider)) return
  watched.add(w.provider)
  w.provider.on?.('accountsChanged', (accounts: Address[]) => {
    if (state.connected?.provider !== w.provider) return
    set({ connected: accounts.length ? makeConnected(w, accounts[0]) : null })
  })
}

function makeConnected(w: Discovered, address: Address): Connected {
  const client = createWalletClient({ account: address, chain, transport: custom(w.provider) })
  return { client, address, name: w.info.name, provider: w.provider }
}

/** Switch the wallet to this app's chain before any signature, adding it if the wallet lacks it. */
export async function ensureChain(provider: EIP1193Provider) {
  const current = Number(await provider.request({ method: 'eth_chainId' }))
  if (current !== chain.id) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(chain.id) }] })
    } catch (err) {
      if ((err as { code?: number }).code !== 4902) throw err
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: numberToHex(chain.id),
            ...walletChain,
          },
        ],
      })
    }
  }
  await shareNetwork(provider)
}

type Permission = { parentCapability: string; caveats?: { type: string; value: unknown }[] }

/**
 * MetaMask shares a site's accounts network by network. If this app's network isn't among the ones
 * approved at login, MetaMask still reports the account and says it is on the right network, yet
 * refuses every signature ("must provide an Ethereum address"), and a switch request does nothing
 * because the wallet already counts itself as on that network. So: read what the site may use, and
 * if this network is missing, ask for it to be added.
 *
 * Wallets without this model either don't answer `wallet_getPermissions` or list no networks in
 * it; they are left alone.
 */
async function shareNetwork(provider: EIP1193Provider) {
  // These two requests carry MetaMask's own permission names, which the library's types don't list.
  // Called on the provider itself, not as a loose function: wallets' `request` relies on `this`.
  type Loose = { request(args: { method: string; params?: unknown }): Promise<unknown> }
  const ask = (args: { method: string; params?: unknown }) => (provider as unknown as Loose).request(args)
  const want = numberToHex(chain.id)
  let allowed: string[]
  try {
    const all = (await ask({ method: 'wallet_getPermissions' })) as Permission[]
    const networks = all.find((p) => p.parentCapability === 'endowment:permitted-chains')
    if (!networks) return
    allowed = (networks.caveats?.find((c) => c.type === 'restrictNetworkSwitching')?.value as string[] | undefined) ?? []
  } catch {
    return
  }
  if (allowed.some((id) => id.toLowerCase() === want)) return
  await ask({
    method: 'wallet_requestPermissions',
    params: [{ 'endowment:permitted-chains': { caveats: [{ type: 'restrictNetworkSwitching', value: [...allowed, want] }] } }],
  })
}

/**
 * Check with the wallet, right now, that it still shares the account this page is logged in as.
 * A wallet can change that at any time (another account picked, the site disconnected in the
 * wallet's own menu) and then refuses to sign as the old one. If it shares nothing, this asks it to
 * connect again. If the account is a different one, the page switches to it and this throws, so the
 * person sees the new account's details before starting the action again.
 */
export async function sameAccount(c: Connected): Promise<void> {
  let accounts = (await c.provider.request({ method: 'eth_accounts' })) as Address[]
  if (accounts.length === 0) accounts = (await c.provider.request({ method: 'eth_requestAccounts' })) as Address[]
  if (accounts.some((a) => a.toLowerCase() === c.address.toLowerCase())) return
  const next = accounts[0]
  set({ connected: next ? { ...c, address: next, client: createWalletClient({ account: next, chain, transport: custom(c.provider) }) } : null })
  throw new Error(next ? 'Your wallet is on a different account now. Check the details and try again.' : 'Your wallet is no longer connected. Log in again.')
}

/**
 * The same check for a wallet that is already logged in. A wallet can change network at any time
 * after login, and one on the wrong network refuses signatures with an error that explains nothing,
 * so this runs before every signature and transaction.
 */
export const ensureChainFor = (wallet: WalletClient) => ensureChain({ request: wallet.request } as EIP1193Provider)

/** Local testing only: forwards requests to the anvil node, whose default accounts are unlocked. */
function announceDevWallet() {
  const rpc = chain.rpcUrls.default.http[0]
  let id = 0
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === 'eth_requestAccounts') method = 'eth_accounts'
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }),
      }).then((r) => r.json())
      if (res.error) throw Object.assign(new Error(res.error.message), res.error)
      return res.result
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider
  const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#337f5e"/><text x="14" y="19" font-size="13" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="600">A</text></svg>')}`
  const detail: Discovered = { info: { uuid: 'dev-anvil', name: 'Anvil dev wallet (local)', icon, rdns: 'local.anvil' }, provider }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(detail) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
}
