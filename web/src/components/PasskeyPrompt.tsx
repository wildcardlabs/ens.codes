import { Loader2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SITE_HOST } from '@/lib/config'
import { createPasskey, PasskeyError, passkeySecret, passkeySeen } from '@/lib/passkey'
import { unlock, unlockInput } from '@/lib/walletCodes'
import { TickList } from './ds/primitives'
import { Key } from './ds/stickers'

/**
 * What the person was doing when the passkey came up. Someone who pressed Export or Copy link
 * didn't ask to "show codes", so the dialog names their action and says what happens after.
 */
export type UnlockReason = 'buy' | 'view' | 'export' | 'copy' | 'link' | 'image' | 'share'

/**
 * The passkey is for one thing only, revealing the codes. Copying or exporting needs nothing of its
 * own, so the wording keeps the two apart: the passkey reveals, and then the action happens.
 */
const HIDDEN = 'Your codes stay hidden until you use the passkey you bought them with.'
const then = (next: string) => `${HIDDEN} It reveals them, then ${next}.`

const COPY: Record<UnlockReason, { title: string; lead: string; action: string }> = {
  buy: {
    title: 'Keep your codes with a passkey.',
    lead: 'Your codes are made from a passkey, so you can see them again later in My codes. Your wallet only pays.',
    action: 'Use passkey',
  },
  view: { title: 'Use your passkey to reveal your codes.', lead: HIDDEN, action: 'Reveal codes' },
  export: { title: 'Use your passkey to reveal and export.', lead: then('the export opens'), action: 'Reveal and export' },
  copy: { title: 'Use your passkey to reveal and copy.', lead: then('this code is copied'), action: 'Reveal and copy' },
  link: { title: 'Use your passkey to reveal and copy.', lead: then('this code’s link is copied'), action: 'Reveal and copy' },
  image: { title: 'Use your passkey to reveal and download.', lead: then('this code’s image downloads'), action: 'Reveal and download' },
  share: { title: 'Use your passkey to reveal and share.', lead: then('you can share this code'), action: 'Reveal and share' },
}

type Ask = { reason: UnlockReason; address: Address; canCreate: boolean }

/**
 * Asks for the buyer's passkey and unlocks the wallet's codes with it. `ask()` resolves to the
 * wallet's master secret, or null if the person backed out.
 *
 * The passkey sheet opens straight from the dialog's buttons: browsers only allow it in response to
 * a click, so nothing slow may run between the click and the passkey request.
 */
export function usePasskeyPrompt() {
  const [asking, setAsking] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A passkey just made that didn't hand over its secret yet: one more tap reads it. */
  const [made, setMade] = useState<ArrayBuffer | null>(null)
  const resolver = useRef<((master: Hex | null) => void) | null>(null)

  /** `canCreate`: offer to make a new passkey. Off where only the passkey already used can help. */
  const ask = useCallback(
    (reason: UnlockReason, address: Address, canCreate = reason === 'buy') =>
      new Promise<Hex | null>((resolve) => {
        resolver.current = resolve
        setError(null)
        setMade(null)
        setAsking({ reason, address, canCreate })
      }),
    [],
  )
  const close = (master: Hex | null) => {
    resolver.current?.(master)
    resolver.current = null
    setAsking(null)
    setBusy(false)
  }

  async function run(step: 'use' | 'create') {
    if (!asking) return
    setBusy(true)
    setError(null)
    const input = unlockInput(asking.address)
    try {
      if (step === 'create') {
        const { secret, id } = await createPasskey(input)
        if (!secret) {
          setMade(id)
          return
        }
        return close(unlock(asking.address, secret))
      }
      close(unlock(asking.address, await passkeySecret(input, made ?? undefined)))
    } catch (err) {
      setError(err instanceof PasskeyError ? err.message : ((err as Error).message ?? 'The passkey didn’t work. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const copy = asking ? COPY[asking.reason] : COPY.buy
  // First time on this device, making one is the likely step; after that, using it is.
  const createFirst = !!asking?.canCreate && !passkeySeen() && !made
  const primary = made ? { label: 'Continue', step: 'use' as const } : createFirst ? { label: 'Create a passkey', step: 'create' as const } : { label: copy.action, step: 'use' as const }
  const other = !asking?.canCreate || made ? null : createFirst ? { label: 'I already have one', step: 'use' as const } : { label: 'Create a new passkey', step: 'create' as const }

  const dialog = (
    <Dialog open={!!asking} onOpenChange={(o) => !o && !busy && close(null)}>
      <DialogContent className="gap-0 p-7">
        <Key size={76} className="-rotate-12" />
        <DialogTitle className="t-display mt-4 text-[24px] leading-[28px]">{made ? 'Passkey created.' : copy.title}</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-[22px] text-body">
          {made ? 'Use it once more to unlock your codes.' : copy.lead}
        </DialogDescription>
        {!made && (
          <div className="panel mt-5 p-4">
            <TickList hue="green" items={['Face ID, fingerprint or device PIN', 'Free, and moves no money', 'Use the same passkey every time']} className="gap-2.5 [&_li]:text-[15px]" />
          </div>
        )}
        <p className="mt-4 text-[13px] leading-5 text-caption">
          The passkey is saved for <span className="font-medium text-foreground">{typeof window === 'undefined' ? SITE_HOST : window.location.hostname}</span> and only works here.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[13px] leading-5 text-red">
            {error}
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="soft" size="md" disabled={busy} onClick={() => close(null)}>
            Not now
          </Button>
          <Button size="md" disabled={busy} onClick={() => void run(primary.step)}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {primary.label}
          </Button>
        </div>
        {other && (
          <button type="button" disabled={busy} className="t-link mx-auto mt-4 text-[13px] font-medium" onClick={() => void run(other.step)}>
            {other.label}
          </button>
        )}
      </DialogContent>
    </Dialog>
  )

  return { ask, dialog }
}

/**
 * Before buying with a passkey that made none of this wallet's earlier codes. That is allowed: the
 * passkey those codes came from may be gone, and the wallet shouldn't be locked out of buying. But
 * the earlier codes won't show with this passkey, so say so and offer to pick another one first.
 * `ask()` resolves to 'continue', 'switch', or null if the person backed out.
 */
export function useOtherPasskeyNotice() {
  const [open, setOpen] = useState(false)
  const resolver = useRef<((choice: 'continue' | 'switch' | null) => void) | null>(null)
  const ask = useCallback(
    () =>
      new Promise<'continue' | 'switch' | null>((resolve) => {
        resolver.current = resolve
        setOpen(true)
      }),
    [],
  )
  const close = (choice: 'continue' | 'switch' | null) => {
    resolver.current?.(choice)
    resolver.current = null
    setOpen(false)
  }
  const dialog = (
    <Dialog open={open} onOpenChange={(o) => !o && close(null)}>
      <DialogContent className="gap-0 p-7">
        <Key size={76} className="-rotate-12" />
        <DialogTitle className="t-display mt-4 text-[24px] leading-[28px]">This passkey didn’t make your earlier codes.</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-[22px] text-body">
          Codes this wallet bought before were kept with another passkey, so they won’t show with this one. You can still cancel them in My codes. New
          codes will be kept with this passkey.
        </DialogDescription>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="soft" size="md" onClick={() => close('switch')}>
            Pick another
          </Button>
          <Button size="md" onClick={() => close('continue')}>
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
  return { ask, dialog }
}
