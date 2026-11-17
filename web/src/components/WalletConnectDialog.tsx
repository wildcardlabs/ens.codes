import { Check, Copy, Loader2, Search, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { WALLETCONNECT_PROJECT_ID } from '@/lib/config'
import { closePairing, connectWalletConnect, useWallet } from '@/lib/wallet'
import { cn } from '@/lib/utils'
import { isAndroid, isMobile } from '@/lib/walletconnect'
import { Qr } from './ds/Qr'
import { WalletConnectIcon } from './ds/WalletConnectIcon'

/**
 * One wallet from WalletConnect's public directory: what it's called, its logo, how to open it on a
 * phone, and its store pages (the Play Store page names its Android app).
 */
type Listing = {
  id: string
  name: string
  image_url?: { sm?: string }
  mobile?: { native?: string | null; universal?: string | null }
  app?: { android?: string | null }
}

/**
 * The wallet last picked from the list on this device, shown first next time. A page can't see which
 * apps a phone has, so this is the closest it gets to listing the person's own wallet first.
 */
const LAST = 'ens.codes:last-wallet'
function lastWallet(): Listing | null {
  try {
    const w = JSON.parse(localStorage.getItem(LAST) ?? 'null') as Listing | null
    return w && typeof w.id === 'string' && typeof w.name === 'string' ? w : null
  } catch {
    return null
  }
}
function rememberWallet(w: Listing) {
  try {
    const { id, name, image_url, mobile, app } = w
    localStorage.setItem(LAST, JSON.stringify({ id, name, image_url, mobile, app }))
  } catch {
    // Storage is unavailable (private mode): the list just keeps its usual order.
  }
}

/**
 * Wallets from WalletConnect's directory that can be opened from a phone's browser, in the
 * directory's own order. `search` narrows it by name.
 */
function useDirectory(search: string, enabled: boolean) {
  const [wallets, setWallets] = useState<Listing[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      const q = new URLSearchParams({ projectId: WALLETCONNECT_PROJECT_ID, entries: '40', page: '1', chains: 'eip155:1' })
      if (search.trim()) q.set('search', search.trim())
      try {
        const res = await fetch(`https://explorer-api.walletconnect.com/v3/wallets?${q}`, { signal: ctrl.signal })
        const body = (await res.json()) as { listings?: Record<string, Listing> }
        setWallets(Object.values(body.listings ?? {}).filter((w) => w.mobile?.native || w.mobile?.universal))
        setFailed(false)
      } catch {
        if (!ctrl.signal.aborted) setFailed(true)
      }
    }, search ? 250 : 0)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [search, enabled])
  return { wallets, failed }
}

/**
 * The link that opens `w` with the pairing link: its app's own scheme if it has one, else its web link.
 *
 * On Android the app link names the wallet's app (from its Play Store page), as an `intent:` link:
 * Android then opens that app if it is installed, and its Play Store page if it isn't. A page can't
 * tell which apps a phone has, so this is how a wallet the person doesn't have gets handled.
 */
function walletLink(w: Listing, uri: string, android: boolean): string {
  const native = w.mobile?.native
  const universal = w.mobile?.universal
  const enc = encodeURIComponent(uri)
  if (native) {
    let base = native.includes('://') ? native : `${native.replaceAll('/', '').replaceAll(':', '')}://`
    if (!base.endsWith('/')) base += '/'
    const link = `${base}wc?uri=${enc}`
    const app = android ? androidApp(w) : null
    if (!app) return link
    const scheme = link.slice(0, link.indexOf(':'))
    return `intent:${link.slice(scheme.length + 1)}#Intent;scheme=${scheme};package=${app};end`
  }
  return `${universal!.endsWith('/') ? universal : `${universal}/`}wc?uri=${enc}`
}

/** The Android app id from the wallet's Play Store page (`…/details?id=com.example.wallet`). */
function androidApp(w: Listing): string | null {
  try {
    const id = new URL(w.app?.android ?? '').searchParams.get('id')
    return id && /^[A-Za-z][\w.]*$/.test(id) ? id : null
  } catch {
    return null
  }
}

/** The searchable list of wallet apps. Tapping one opens it with the pairing link. */
function WalletList({
  uri,
  android,
  search,
  setSearch,
  wallets,
  failed,
  onOpen,
}: {
  uri: string | null
  android: boolean
  search: string
  setSearch: (s: string) => void
  wallets: Listing[] | null
  failed: boolean
  onOpen: (w: Listing) => void
}) {
  // The wallet picked last time goes first, unless the person is searching for another. Read again
  // for each pairing, since the list can stay on the page between them.
  const last = useMemo(() => (uri ? lastWallet() : null), [uri])
  const shown = useMemo(() => {
    if (!wallets) return null
    if (search.trim() || !last) return wallets
    return [last, ...wallets.filter((w) => w.id !== last.id)]
  }, [wallets, last, search])
  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-caption" aria-hidden="true" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search wallets" aria-label="Search wallets" className="pl-9" />
      </div>
      <div className={cn('-mx-1 grid gap-1 overflow-y-auto px-1', android ? 'max-h-[35dvh]' : 'max-h-[45dvh]')}>
        {!uri || !shown ? (
          failed ? (
            <p className="py-3 text-[14px] text-caption">The wallet list didn’t load. Copy the link below into your wallet instead.</p>
          ) : (
            <Loader2 className="mx-auto my-6 size-5 animate-spin text-caption" aria-hidden="true" />
          )
        ) : (
          <>
            {shown.map((w) => (
              <a
                key={w.id}
                href={walletLink(w, uri, android)}
                onClick={() => {
                  rememberWallet(w)
                  onOpen(w)
                }}
                className="fragment flex h-12 items-center gap-3 px-3.5 text-[15px] font-medium text-foreground transition-colors duration-100 hover:bg-card"
              >
                {w.image_url?.sm ? <img src={w.image_url.sm} alt="" className="size-7 rounded-md" /> : <Smartphone className="size-5" aria-hidden="true" />}
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === last?.id && !search.trim() && <span className="text-[12px] font-normal text-caption">Last used</span>}
              </a>
            ))}
            {shown.length === 0 && <p className="py-3 text-[14px] text-caption">No wallet by that name. Copy the link below into your wallet instead.</p>}
          </>
        )}
      </div>
    </>
  )
}

/**
 * The WalletConnect screen. On a computer it shows the pairing link as a QR code for a phone wallet
 * to scan. On Android the link opens as soon as it exists, and Android asks which installed wallet
 * app should take it; the screen stays behind as the place to come back to, with a button in case
 * the browser didn't open it, and a list of wallet apps for wallets that aren't in Android's list
 * (wallets that don't take WalletConnect links, such as Rabby). iPhones have no such chooser (one app
 * wins the link, whichever iOS picks), so there the list is the way in. Either way the person
 * approves in the app and comes back here.
 * Opened by `connectWalletConnect()`, closed when the wallet approves.
 */
export function WalletConnectDialog() {
  const { pairing } = useWallet()
  const [search, setSearch] = useState('')
  const [opened, setOpened] = useState<string | null>(null)
  const phone = isMobile()
  const android = isAndroid()
  const { wallets, failed } = useDirectory(search, !!pairing && phone)
  const { copied, copy } = useCopyFeedback()
  const uri = pairing?.uri ?? null

  useEffect(() => {
    if (!pairing) {
      setSearch('')
      setOpened(null)
    }
  }, [pairing])

  // Android: straight to the system's list of wallet apps, with no extra tap.
  useEffect(() => {
    if (!android || !uri) return
    setOpened('your wallet')
    window.location.href = uri
  }, [android, uri])

  const copyLink = uri && (
    <Button variant="soft" size="md" className="w-full" onClick={() => void copy(uri)}>
      {copied === uri ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied === uri ? 'Copied' : 'Copy link'}
    </Button>
  )

  return (
    <Dialog open={!!pairing} onOpenChange={(o) => !o && closePairing()}>
      {/* On a phone, focusing the search box would open the keyboard over the list. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-7" onOpenAutoFocus={(e) => phone && e.preventDefault()}>
        {!phone && <WalletConnectIcon className="mb-3 size-9" />}
        <DialogTitle className="t-display text-[24px] leading-[28px]">{phone ? 'Open your wallet app.' : 'Connect with WalletConnect.'}</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-[22px] text-body">
          {android
            ? 'Choose your wallet app, approve the connection there, then come back to this page.'
            : phone
              ? 'Pick your wallet, approve the connection there, then come back to this page.'
              : 'Link a wallet from another app, such as your phone or Safe. Approve the connection there and this page connects by itself.'}
        </DialogDescription>

        {pairing?.error ? (
          <div className="mt-5">
            <p role="alert" className="text-[14px] text-red">
              {pairing.error}
            </p>
            <Button size="md" className="mt-4 w-full" onClick={() => void connectWalletConnect()}>
              Try again
            </Button>
          </div>
        ) : android ? (
          <div className="mt-5 grid gap-3">
            {uri ? (
              <Button asChild size="md" className="w-full">
                <a href={uri} onClick={() => setOpened('your wallet')}>
                  <Smartphone aria-hidden="true" /> {opened ? 'Open wallet app again' : 'Open wallet app'}
                </a>
              </Button>
            ) : (
              <Loader2 className="mx-auto my-3 size-5 animate-spin text-caption" aria-hidden="true" />
            )}
            {opened && <p className="text-center text-[13px] text-caption">Approve in {opened}, then come back here.</p>}
            {/* Android's list only has wallets that take WalletConnect links (Rabby, for one, doesn't). */}
            <p className="mt-3 text-[14px] font-medium text-foreground">Don’t see your wallet?</p>
            <WalletList uri={uri} android search={search} setSearch={setSearch} wallets={wallets} failed={failed} onOpen={(w) => setOpened(w.name)} />
            {copyLink}
          </div>
        ) : !phone ? (
          <div className="mt-5 grid gap-3">
            <div className="mx-auto grid size-[208px] place-items-center rounded-lg bg-white p-2.5">
              {uri ? <Qr value={uri} label="WalletConnect pairing code" className="size-full" /> : <Loader2 className="size-6 animate-spin text-[#121212]" aria-hidden="true" />}
            </div>
            <p className="text-center text-[13px] leading-5 text-caption">
              <span className="font-medium text-foreground">Phone wallet:</span> scan this code with the wallet app’s scanner.
            </p>
            <div className="flex items-center gap-3 text-[12px] text-caption before:h-px before:flex-1 before:bg-rule after:h-px after:flex-1 after:bg-rule">or</div>
            {copyLink}
            <p className="text-center text-[13px] leading-5 text-caption">
              <span className="font-medium text-foreground">Safe, Ledger Live or another wallet app:</span> copy the link and paste it where the wallet
              offers WalletConnect.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            <WalletList uri={uri} android={false} search={search} setSearch={setSearch} wallets={wallets} failed={failed} onOpen={(w) => setOpened(w.name)} />
            {copyLink}
            {opened && <p className="text-center text-[13px] text-caption">Approve in {opened}, then come back here.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
