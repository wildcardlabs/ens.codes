import { createRoot } from 'react-dom/client'
import { CodeTicket } from '@/components/ds/CodeTicket'
import { Bean, Coin, Spark, Star } from '@/components/ds/stickers'
import { Mark } from '@/components/ds/Wordmark'
import './index.css'

/**
 * The picture a shared link shows (public/og.png), drawn with the site's own ticket, stickers and
 * type. To make it again: run the dev server, open /og.html and capture the page at 1200 × 630.
 */
function ShareImage() {
  return (
    <div className="relative h-[630px] w-[1200px] overflow-hidden bg-[#171717]">
      <div className="absolute left-[72px] top-[62px] flex items-center gap-[0.36em] font-display text-[32px] font-semibold leading-none tracking-[-0.02em] text-white">
        <Mark className="h-[1.3em] translate-y-[0.125em]" />
        <span className="translate-y-px">ens.codes</span>
      </div>
      <div className="absolute left-[72px] top-[196px] w-[600px]">
        <h1 className="font-display text-[80px] font-medium leading-[84px] tracking-[-0.045em] text-white">Renewals you can hand over.</h1>
        <p className="mt-7 text-[30px] font-medium leading-[38px] tracking-[-0.015em] text-white/70">Claim codes for ENS renewals.</p>
      </div>
      <div className="absolute right-[78px] top-[176px] w-[440px] rotate-[5deg]">
        <Coin size={92} className="absolute -left-12 -top-12 z-10 -rotate-12" />
        <Bean size={120} className="absolute -bottom-16 -right-12 z-10 rotate-6" />
        <Star size={30} className="absolute -top-12 right-8 text-yellow" />
        <Spark size={26} className="absolute -bottom-12 left-6 text-sky" />
        <CodeTicket amount={25_000000n} qr="https://ens.codes" shimmer={false} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<ShareImage />)
