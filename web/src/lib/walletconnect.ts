import type UniversalProvider from '@walletconnect/universal-provider'
import { type Address, type EIP1193Provider, numberToHex } from 'viem'
import { chain, publicClient, SITE_HOST, WALLETCONNECT_PROJECT_ID } from './config'

/**
 * WalletConnect without a kit: the bare protocol client, and our own screens around it. The wallet
 * is only asked to pay (send transactions, sign a USDC permit), so the session asks for little.
 *
 * The client is a large download, so it is loaded only when someone picks WalletConnect, or when the
 * last visit ended connected through it.
 */

const CAIP = `eip155:${chain.id}`
/** What the wallet itself is asked to do. Everything else is answered here or by our own node. */
const WALLET_METHODS = ['eth_sendTransaction', 'eth_signTypedData_v4']

let loading: Promise<UniversalProvider> | null = null
function client(): Promise<UniversalProvider> {
  loading ??= import('@walletconnect/universal-provider')
    .then(({ UniversalProvider }) =>
      UniversalProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: {
          name: SITE_HOST,
          description: 'Claim codes for ENS renewals.',
          url: window.location.origin,
          icons: [`${window.location.origin}/apple-touch-icon.png`],
        },
      }),
    )
    .then((p) => {
      reconnectOnReturn(p)
      return p
    })
  return loading
}

/**
 * Reconnect to the relay as soon as the page is back in front. On a phone the browser pauses the
 * page while the wallet app is open, and its connection to the relay can die without the page being
 * told. The client only checks for a stalled connection when it runs on a server, so in a browser
 * the wallet's answer would wait until the dead connection is noticed. A fresh connection picks up
 * whatever the wallet sent in the meantime.
 */
function reconnectOnReturn(p: UniversalProvider) {
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      return
    }
    // A glance away (a notification, a quick app switch) doesn't need a new connection.
    if (!hiddenAt || Date.now() - hiddenAt < 2000) return
    hiddenAt = 0
    p.client.core.relayer.restartTransport().catch(() => {})
  })
}

/**
 * Load the client ahead of a tap. Android opens a WalletConnect link straight from the tap only while
 * the tap still counts as recent, so the pairing link has to be ready quickly.
 */
export const warmUp = () => void client().catch(() => {})

/** A phone or tablet, where wallets are other apps rather than another device. */
export const isMobile = () =>
  typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)))
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** The session's accounts on this app's chain. */
function accountsOf(p: UniversalProvider): Address[] {
  const all = p.session?.namespaces.eip155?.accounts ?? []
  return [...new Set(all.filter((a) => a.startsWith(`${CAIP}:`)).map((a) => a.slice(CAIP.length + 1) as Address))]
}

/** After a request goes out on a phone, bring the wallet app forward so the person sees it. */
function openWallet(p: UniversalProvider) {
  if (!isMobile()) return
  const redirect = p.session?.peer.metadata.redirect
  const link = redirect?.native || redirect?.universal
  if (link) window.location.href = link
}

export type Session = { provider: EIP1193Provider; address: Address; name: string; icon?: string }

/**
 * The session as an EIP-1193 provider, so the rest of the app treats it like any browser wallet.
 * The chain is fixed when the session is made, so chain checks are answered here; reads go to our
 * own node rather than through the wallet. Wallet requests go straight to the session, so they work
 * the same whether the session came from `pair()`, from last visit, or from an approval that landed
 * after a reload.
 */
function sessionOf(p: UniversalProvider): Session | null {
  const [address] = accountsOf(p)
  const session = p.session
  if (!address || !session) return null
  const provider = {
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === 'eth_chainId') return numberToHex(chain.id)
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accountsOf(p)
      if (method.startsWith('wallet_')) throw Object.assign(new Error(`${method} isn't available over WalletConnect.`), { code: 4200 })
      if (WALLET_METHODS.includes(method)) {
        const pending = p.client.request({ topic: session.topic, chainId: CAIP, request: { method, params: params as unknown[] } })
        openWallet(p)
        return pending
      }
      return (publicClient.request as (args: { method: string; params?: unknown }) => Promise<unknown>)({ method, params })
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider
  const peer = session.peer.metadata
  return { provider, address, name: peer.name || 'WalletConnect', icon: peer.icons?.[0] }
}

/**
 * A pairing that was still waiting for the wallet, until its link expires. Android often reloads a
 * tab left in the background while a wallet app is open, which loses the page's wait for the
 * approval; this lets the reloaded page pick the approval up (see `watchPending`).
 */
const PENDING = 'ens.codes:walletconnect-pairing'
type Pending = { topic: string; until: number }
function markPending(uri: string | null) {
  try {
    if (!uri) return localStorage.removeItem(PENDING)
    // The link is wc:<pairing topic>@2?expiryTimestamp=<seconds>&...
    const topic = uri.slice(3, uri.indexOf('@'))
    const at = Number(new URLSearchParams(uri.split('?')[1] ?? '').get('expiryTimestamp'))
    localStorage.setItem(PENDING, JSON.stringify({ topic, until: at > 0 ? at * 1000 : Date.now() + 5 * 60_000 } satisfies Pending))
  } catch {
    // Storage is unavailable (private mode): a reload mid-pairing just needs a new pairing.
  }
}
function pending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? 'null') as Pending | null
    return p && typeof p.topic === 'string' && p.until > Date.now() ? p : null
  } catch {
    return null
  }
}
export const pairingPending = () => !!pending()

type Struct = NonNullable<UniversalProvider['session']>

/**
 * Make `session` the one this page uses, and end any other session the client still keeps (a wallet
 * that approved after the page gave up, say). The client otherwise picks whichever it stored first.
 */
function use(p: UniversalProvider, session: Struct) {
  p.session = session
  for (const other of p.client.session.getAll()) if (other.topic !== session.topic) void end(p, other.topic)
}

/**
 * End one session. The provider's own `disconnect()` also expires every pairing in the background,
 * which can wipe out a pairing made right after (logging out and straight back in).
 */
async function end(p: UniversalProvider, topic: string) {
  if (p.session?.topic === topic) p.session = undefined
  await p.client.disconnect({ topic, reason: { code: 6000, message: 'User disconnected.' } }).catch(() => {})
}

let attempt = 0
/** A `pair()` call is waiting for its own approval, so `watchPending` leaves new sessions to it. */
let pairing = false

/**
 * Start a session. `onUri` gets the pairing link to show as a QR code or open in a wallet app; it
 * resolves once the wallet approves. A newer `pair()` call or `stopPairing()` makes this one's result
 * be thrown away.
 */
export async function pair(onUri: (uri: string) => void): Promise<Session | null> {
  const mine = ++attempt
  const p = await client()
  const show = (uri: string) => {
    if (mine !== attempt) return
    markPending(uri)
    onUri(uri)
  }
  p.on('display_uri', show)
  pairing = true
  try {
    // A session already open stays until the new one is approved (`use` then ends it). Ending it here
    // would clear the client's pairings in the background, racing the pairing about to be made.
    await p.connect({
      optionalNamespaces: {
        eip155: { chains: [CAIP], methods: WALLET_METHODS, events: ['accountsChanged', 'chainChanged'], rpcMap: { [CAIP]: chain.rpcUrls.default.http[0] } },
      },
    })
  } finally {
    p.off('display_uri', show)
    if (mine === attempt) {
      pairing = false
      markPending(null)
    }
  }
  if (mine !== attempt) {
    if (p.session) await end(p, p.session.topic)
    return null
  }
  if (p.session) use(p, p.session)
  const s = sessionOf(p)
  if (!s) {
    if (p.session) await end(p, p.session.topic)
    throw new Error(`Your wallet didn’t share an account on ${chain.name}. Add that network in the wallet and try again.`)
  }
  return s
}

/** The person closed the pairing screen: a wallet approving later is ignored. */
export function stopPairing() {
  attempt++
  pairing = false
  markPending(null)
}

/**
 * After a reload mid-pairing: hand over the wallet's approval once it arrives, until the pairing
 * link expires. If the approval was handled before the reload, the session is already stored.
 */
export async function watchPending(onSession: (s: Session) => void) {
  const waiting = pending()
  if (!waiting) return
  const p = await client()
  const adopt = (session: Struct) => {
    use(p, session)
    const s = sessionOf(p)
    if (!s) return false
    markPending(null)
    onSession(s)
    return true
  }
  const stored = p.client.session.getAll().find((x) => x.pairingTopic === waiting.topic)
  if (stored && adopt(stored)) return
  const stop = () => {
    p.client.off('session_connect', onConnect)
    clearTimeout(timer)
  }
  const onConnect = ({ session }: { session: Struct }) => {
    if (pairing || session.pairingTopic !== waiting.topic) return
    stop()
    adopt(session)
  }
  p.client.on('session_connect', onConnect)
  const timer = setTimeout(() => {
    stop()
    markPending(null)
  }, waiting.until - Date.now())
}

/** The session from last visit, if the wallet still holds it. */
export async function resume(): Promise<Session | null> {
  const p = await client()
  // The newest session: each one lasts the same time from approval, so the latest expiry.
  const newest = p.client.session.getAll().sort((a, b) => b.expiry - a.expiry)[0]
  if (!newest) return null
  use(p, newest)
  return sessionOf(p)
}

export async function endSession() {
  if (!loading) return
  const p = await loading
  if (p.session) await end(p, p.session.topic)
}

/** Tell the store when the wallet ends the session or changes account. */
export async function watchSession(onChange: (s: Session | null) => void) {
  const p = await client()
  p.on('session_delete', () => onChange(null))
  p.on('disconnect', () => onChange(null))
  const update = () => onChange(sessionOf(p))
  p.on('session_update', update)
  p.on('session_event', update)
}
