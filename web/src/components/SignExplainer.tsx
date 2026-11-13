import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { TickList } from './ds/primitives'
import { Key } from './ds/stickers'

/**
 * What the person was doing when the signature came up. Someone who pressed Export or Copy link
 * didn't ask to "show codes", so the dialog names their action and says what happens after signing.
 */
export type SignReason = 'buy' | 'view' | 'export' | 'copy' | 'link' | 'image' | 'share'

/**
 * The signature is for one thing only, revealing the codes. Copying or exporting needs no signature
 * of its own, so the wording keeps the two apart: signing reveals, and then the action happens.
 */
const HIDDEN = 'Your codes stay hidden until you sign the same message you signed when buying.'
const then = (next: string) => `${HIDDEN} Signing reveals them, then ${next}.`

const COPY: Record<SignReason, { title: string; lead: string; action: string }> = {
  buy: {
    title: 'One quick signature first.',
    lead: 'Your wallet will ask you to sign a message. It creates your codes so you can find them again.',
    action: 'Continue',
  },
  view: { title: 'Sign to reveal your codes.', lead: HIDDEN, action: 'Reveal codes' },
  export: { title: 'Sign to reveal and export.', lead: then('the export opens'), action: 'Reveal and export' },
  copy: { title: 'Sign to reveal and copy.', lead: then('this code is copied'), action: 'Reveal and copy' },
  link: { title: 'Sign to reveal and copy.', lead: then('this code’s link is copied'), action: 'Reveal and copy' },
  image: { title: 'Sign to reveal and download.', lead: then('this code’s image downloads'), action: 'Reveal and download' },
  share: { title: 'Sign to reveal and share.', lead: then('you can share this code'), action: 'Reveal and share' },
}

/**
 * Explains the code-unlock signature before the wallet asks for it. People are rightly careful about
 * signing, so this says plainly what it is and what it isn't. `ask()` resolves true on Continue.
 */
export function useSignExplainer() {
  const [reason, setReason] = useState<SignReason | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback(
    (r: SignReason) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve
        setReason(r)
      }),
    [],
  )
  const close = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setReason(null)
  }

  const copy = reason ? COPY[reason] : COPY.buy
  const dialog = (
    <Dialog open={!!reason} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="gap-0 p-7">
        <Key size={76} className="-rotate-12" />
        <DialogTitle className="t-display mt-4 text-[24px] leading-[28px]">{copy.title}</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-[22px] text-body">{copy.lead}</DialogDescription>
        <div className="panel mt-5 p-4">
          <TickList hue="green" items={['Free, and moves no money', 'A message, not a transaction', 'Keeps your codes private']} className="gap-2.5 [&_li]:text-[15px]" />
        </div>
        <p className="mt-4 text-[13px] leading-5 text-caption">
          Your wallet should show <span className="font-medium text-foreground">{window.location.host}</span>. If it shows another site, don't sign.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="soft" size="md" onClick={() => close(false)}>
            Not now
          </Button>
          <Button size="md" onClick={() => close(true)}>
            {copy.action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return { ask, dialog }
}
