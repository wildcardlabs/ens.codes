import { ChevronDown, Loader2, Wallet as WalletIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { WALLETCONNECT } from '@/lib/config'
import { useEnsProfile } from '@/lib/ensProfile'
import { truncAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { connect, connectWalletConnect, type Discovered, disconnect, useWallet } from '@/lib/wallet'
import { isAndroid, warmUp } from '@/lib/walletconnect'
import { Token } from './ds/primitives'
import { WalletConnectIcon } from './ds/WalletConnectIcon'

const connectError = (err: { shortMessage?: string; message?: string; code?: number }) =>
  err.code === 4001 ? 'You cancelled the request in your wallet.' : (err.shortMessage ?? err.message ?? 'Could not connect.')

/** WalletConnect's row goes by its own name everywhere: it's what people with a phone wallet, Safe or Ledger Live look for. */
const WALLETCONNECT_LABEL = 'WalletConnect'
const NO_WALLET = WALLETCONNECT
  ? 'No browser wallet found. Connect a phone wallet with WalletConnect, or install one such as MetaMask or Rabby.'
  : 'No browser wallet found. Install one, such as MetaMask or Rabby, then reload.'

/** The browser wallets found on this device, then WalletConnect, as a list of rows. */
export function WalletChoices({ onError, className }: { onError: (message: string) => void; className?: string }) {
  const { wallets, connecting } = useWallet()
  // Android opens the wallet list from the tap itself, so have the client ready before it.
  useEffect(() => {
    if (WALLETCONNECT && isAndroid()) warmUp()
  }, [])
  return (
    <div className={cn('grid gap-2', className)}>
      {wallets.map((w) => (
        <button
          key={w.info.uuid}
          type="button"
          disabled={!!connecting}
          onClick={() => void connect(w).catch((e) => onError(connectError(e)))}
          className="fragment flex h-12 items-center gap-3 px-3.5 text-left text-[15px] font-medium text-foreground transition-colors duration-100 hover:bg-card disabled:opacity-60"
        >
          {w.info.icon ? <img src={w.info.icon} alt="" className="size-6 rounded-md" /> : <WalletIcon className="size-5" aria-hidden="true" />}
          <span className="flex-1">{w.info.name}</span>
          {connecting === w.info.uuid && <Loader2 className="size-4 animate-spin text-caption" aria-hidden="true" />}
        </button>
      ))}
      {WALLETCONNECT && (
        <button
          type="button"
          disabled={!!connecting}
          onClick={() => void connectWalletConnect()}
          className="fragment flex h-12 items-center gap-3 px-3.5 text-left text-[15px] font-medium text-foreground transition-colors duration-100 hover:bg-card disabled:opacity-60"
        >
          <WalletConnectIcon className="size-6" />
          <span className="flex-1">{WALLETCONNECT_LABEL}</span>
        </button>
      )}
      {wallets.length === 0 && !WALLETCONNECT && <p className="text-[14px] text-caption">{NO_WALLET}</p>}
    </div>
  )
}

/**
 * The wallet step of a form's main button: straight to the only way to connect, or the list to choose
 * from. With no browser wallet and no WalletConnect, there is nothing to connect.
 */
export function walletStep(wallets: Discovered[], setChoosing: (v: boolean) => void, onError: (m: string) => void): { label: string; action?: () => void } {
  const ways = wallets.length + (WALLETCONNECT ? 1 : 0)
  if (!ways) return { label: 'Install a browser wallet' }
  return {
    label: 'Connect wallet',
    action: () =>
      ways > 1 ? setChoosing(true) : wallets.length ? void connect(wallets[0]).catch((e) => onError(connectError(e))) : void connectWalletConnect(),
  }
}

/** The ENS avatar, or the name's first letter on a hue when there is none or it fails to load. */
function Avatar({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (src && !failed)
    return <img src={src} alt="" referrerPolicy="no-referrer" className="size-5 shrink-0 rounded-full bg-stone object-cover" onError={() => setFailed(true)} />
  return (
    <Token color="var(--green)" size={20} className="text-[11px] uppercase">
      {name[0]}
    </Token>
  )
}

/** Header control: "Connect wallet" when logged out, the wallet (ENS name and avatar if any) when in. */
export function WalletMenu() {
  const { connected, wallets, connecting, restoring } = useWallet()
  const profile = useEnsProfile(connected?.address)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!connected && WALLETCONNECT && isAndroid()) warmUp()
  }, [connected])

  if (connected)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="soft" className={cn('max-w-[190px] gap-2 px-2.5', !profile && 't-code text-[13px]')} title={connected.address}>
            {profile ? <Avatar name={profile.name} src={profile.avatar} /> : <span className="size-2 rounded-full bg-green" aria-hidden="true" />}
            <span className="truncate">{profile?.name ?? truncAddress(connected.address)}</span>
            <ChevronDown className="size-3.5 text-caption" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="min-w-[210px]">
          <DropdownMenuLabel className="font-normal text-caption">
            Connected with {connected.name}
            <div className="t-code mt-0.5 text-[12px] text-foreground">{truncAddress(connected.address)}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={disconnect}>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

  // Last visit's wallet is being picked up again: don't flash the connect button.
  if (restoring) return null

  const label = (
    <>
      {connecting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <WalletIcon aria-hidden="true" />}
      Connect wallet
    </>
  )
  if (wallets.length === 1 && !WALLETCONNECT) return <Button onClick={() => void connect(wallets[0]).catch((e) => setError(connectError(e)))} title={error ?? undefined}>{label}</Button>
  if (wallets.length === 0 && WALLETCONNECT) return <Button onClick={() => void connectWalletConnect()}>{label}</Button>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[240px]">
        {wallets.length === 0 ? (
          <div className="px-2 py-1.5 text-[13px] text-caption">{NO_WALLET}</div>
        ) : (
          wallets.map((w) => (
            <DropdownMenuItem key={w.info.uuid} onSelect={() => void connect(w).catch((e) => setError(connectError(e)))} className="gap-2.5">
              {w.info.icon ? <img src={w.info.icon} alt="" className="size-5 rounded-md" /> : <WalletIcon className="size-4" aria-hidden="true" />}
              {w.info.name}
            </DropdownMenuItem>
          ))
        )}
        {WALLETCONNECT && (
          <DropdownMenuItem onSelect={() => void connectWalletConnect()} className="gap-2.5">
            <WalletConnectIcon className="size-5" />
            {WALLETCONNECT_LABEL}
          </DropdownMenuItem>
        )}
        {error && <div className="px-2 py-1.5 text-[12px] text-red">{error}</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
