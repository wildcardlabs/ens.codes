import { Check, ImageDown, Link2, Printer, Share } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { redeemLink } from '@/lib/code'
import { downloadTicketPng, hasShareSheet, shareTicket } from '@/lib/share'
import { errorMessage } from '@/lib/util'
import { cn } from '@/lib/utils'

/**
 * How a code leaves the page, with every choice in plain sight.
 *
 * A computer gets three buttons: download the picture, print, copy the link. A phone gets two:
 * Share, which hands the picture to the system sheet (that sheet already lists the person's apps
 * and can save the picture), and copy the link.
 */

const run = (job: Promise<unknown>) => job.catch((err) => toast.error(errorMessage(err)))

type Props = { code: string; amount: bigint }

export function ShareActions({ code, amount, copy, copied, className }: Props & { copy: (value: string) => unknown; copied: string | null; className?: string }) {
  const [sheet] = useState(hasShareSheet)
  const [busy, setBusy] = useState<string | null>(null)
  const link = redeemLink(code)
  const job = (name: string, start: () => Promise<unknown>) => () => {
    setBusy(name)
    void run(start()).finally(() => setBusy(null))
  }
  const copyLink = (
    <Button variant="soft" size="md" className="px-0" onClick={() => void copy(link)}>
      {copied === link ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
      {copied === link ? 'Copied' : 'Copy link'}
    </Button>
  )

  if (sheet) {
    return (
      <div className={cn('no-print grid grid-cols-2 gap-2', className)}>
        <Button variant="soft" size="md" className="px-0" disabled={busy === 'share'} onClick={job('share', () => shareTicket(code, amount))}>
          <Share aria-hidden="true" /> Share
        </Button>
        {copyLink}
      </div>
    )
  }

  return (
    <div className={cn('no-print grid gap-2 sm:grid-cols-3', className)}>
      <Button variant="soft" size="md" className="px-0" disabled={busy === 'png'} onClick={job('png', () => downloadTicketPng(code, amount))}>
        <ImageDown aria-hidden="true" /> Download image
      </Button>
      <Button variant="soft" size="md" className="px-0" onClick={() => window.print()}>
        <Printer aria-hidden="true" /> Print
      </Button>
      {copyLink}
    </div>
  )
}

/**
 * A row menu can be opened before the codes are showing. Its items then get a function that shows
 * them first (one signature) and returns this row's code, or null if the person backed out.
 */
type Lazy = string | (() => Promise<string | null>)
type ItemProps = { code: Lazy; amount: bigint }
const resolve = (code: Lazy) => (typeof code === 'string' ? Promise.resolve(code) : code())

/** Download the picture, as a menu item for a code's row menu on a computer. */
export function DownloadImageItem({ code, amount }: ItemProps) {
  return (
    <DropdownMenuItem onSelect={() => void run(resolve(code).then((c) => (c ? downloadTicketPng(c, amount) : undefined)))}>
      <ImageDown aria-hidden="true" /> Download image
    </DropdownMenuItem>
  )
}

/** The row-menu item for phones: straight to the share sheet. */
export function ShareSheetItem({ code, amount }: ItemProps) {
  const share = async () => {
    const c = await resolve(code)
    if (!c) return
    try {
      await shareTicket(c, amount)
    } catch (err) {
      // A phone only opens its share sheet straight after a tap. Signing to reveal the codes came in
      // between, so the tap no longer counts. The message carries a Share button: pressing it is a
      // fresh tap, and the codes are revealed by then.
      if (typeof code !== 'string' && (err as Error).name === 'NotAllowedError') {
        return void toast('Your codes are revealed.', { duration: 20_000, action: { label: 'Share', onClick: () => void run(shareTicket(c, amount)) } })
      }
      throw err
    }
  }
  return (
    <DropdownMenuItem onSelect={() => void run(share())}>
      <Share aria-hidden="true" /> Share
    </DropdownMenuItem>
  )
}

export { hasShareSheet }
