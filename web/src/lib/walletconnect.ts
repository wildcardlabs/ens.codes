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
  loading ??= import('@walletconnect/universal-provider').then(({ UniversalProvider }) =>
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
  return loading
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
 * own node rather than through the wallet.
 */
function sessionOf(p: UniversalProvider): Session | null {
  const [address] = accountsOf(p)
  if (!address || !p.session) return null
  const provider = {
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === 'eth_chainId') return numberToHex(chain.id)
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accountsOf(p)
      if (method.startsWith('wallet_')) throw Object.assign(new Error(`${method} isn't available over WalletConnect.`), { code: 4200 })
      if (WALLET_METHODS.includes(method)) {
        const pending = p.request({ method, params: params as unknown[] }, CAIP)
        openWallet(p)
        return pending
      }
      return (publicClient.request as (args: { method: string; params?: unknown }) => Promise<unknown>)({ method, params })
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider
  const peer = p.session.peer.metadata
  return { provider, address, name: peer.name || 'WalletConnect', icon: peer.icons?.[0] }
}

let attempt = 0

/**
 * Start a session. `onUri` gets the pairing link to show as a QR code or open in a wallet app; it
 * resolves once the wallet approves. A newer `pair()` call or `stopPairing()` makes this one's result
 * be thrown away.
 */
export async function pair(onUri: (uri: string) => void): Promise<Session | null> {
  const mine = ++attempt
  const p = await client()
  const show = (uri: string) => mine === attempt && onUri(uri)
  p.on('display_uri', show)
  try {
    if (p.session) await p.disconnect().catch(() => {})
    await p.connect({
      optionalNamespaces: {
        eip155: { chains: [CAIP], methods: WALLET_METHODS, events: ['accountsChanged', 'chainChanged'], rpcMap: { [CAIP]: chain.rpcUrls.default.http[0] } },
      },
    })
  } finally {
    p.off('display_uri', show)
  }
  if (mine !== attempt) {
    await p.disconnect().catch(() => {})
    return null
  }
  const s = sessionOf(p)
  if (!s) {
    await p.disconnect().catch(() => {})
    throw new Error(`Your wallet didn’t share an account on ${chain.name}. Add that network in the wallet and try again.`)
  }
  return s
}

/** The person closed the pairing screen: a wallet approving later is ignored. */
export const stopPairing = () => void attempt++

/** The session from last visit, if the wallet still holds it. */
export async function resume(): Promise<Session | null> {
  const p = await client()
  return sessionOf(p)
}

export async function endSession() {
  if (!loading) return
  const p = await loading
  if (p.session) await p.disconnect().catch(() => {})
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
