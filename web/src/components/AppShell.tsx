import type { ReactNode } from 'react'
import type { Go, Page } from '@/App'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'
import { Wrap } from './ds/primitives'
import { Key } from './ds/stickers'
import { Wordmark, WORDMARK_IN_HEADER } from './ds/Wordmark'
import { WalletChoices, WalletMenu } from './wallet'
import { useState } from 'react'

const TABS: { page: Exclude<Page, 'home'>; label: string }[] = [
  { page: 'buy', label: 'Buy' },
  { page: 'redeem', label: 'Redeem' },
  { page: 'codes', label: 'My codes' },
]

/** The app after the landing page: wordmark, three pill tabs, the wallet, then the page. */
export function AppShell({ page, go, children }: { page: Page; go: Go; children: ReactNode }) {
  const { connected, restoring } = useWallet()
  // Buying and managing codes belong to a wallet, so they wait for a login. Redeeming needs only a code to start.
  const gated = !connected && (page === 'buy' || page === 'codes')
  const link = (p: Page) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    go(p)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print sticky top-0 z-20 bg-background">
        <Wrap>
          <div className="flex h-[72px] items-center gap-4">
            <a href="/" onClick={link('home')} aria-label="ens.codes home" className={WORDMARK_IN_HEADER}>
              <Wordmark />
            </a>
            <nav className="ml-2 hidden items-center gap-1 sm:flex" aria-label="App">
              <Tabs page={page} link={link} />
            </nav>
            <div className="ml-auto">
              <WalletMenu />
            </div>
          </div>
          <nav className="-mx-1 flex items-center gap-1 overflow-x-auto pb-3 sm:hidden" aria-label="App">
            <Tabs page={page} link={link} />
          </nav>
        </Wrap>
        <hr className="m-0 h-px border-0 bg-rule" />
      </header>

      <main className="flex-1 py-10 sm:py-14">
        {/* While last visit's wallet is being picked up again, show neither the login nor the page. */}
        <Wrap>{gated ? restoring ? null : <Login page={page} go={go} /> : children}</Wrap>
      </main>

      <footer className="no-print pb-10 text-[13px] text-caption">
        <Wrap className="flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} Namepass LLC. All rights reserved.</span>
          <span className="flex gap-5 [&_a:hover]:text-foreground [&_a]:transition-colors [&_a]:duration-200">
            <a href="https://namepass.com" target="_blank" rel="noreferrer">
              Namepass
            </a>
            <a href="https://www.npmjs.com/package/ens-budget" target="_blank" rel="noreferrer">
              ens-budget
            </a>
          </span>
        </Wrap>
      </footer>
    </div>
  )
}

function Tabs({ page, link }: { page: Page; link: (p: Page) => (e: React.MouseEvent) => void }) {
  return TABS.map((t) => (
    <a
      key={t.page}
      href={`/${t.page}`}
      onClick={link(t.page)}
      aria-current={page === t.page ? 'page' : undefined}
      className={cn(
        'inline-flex h-8 items-center rounded-pill px-3.5 text-[15px] font-medium tracking-[-0.01em] transition-colors duration-100',
        page === t.page ? 'bg-pill text-foreground' : 'text-caption hover:text-foreground',
      )}
    >
      {t.label}
    </a>
  ))
}

/** Logged out: a friendly panel with the wallets found on this device. */
function Login({ page, go }: { page: Page; go: Go }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <section className="panel mx-auto max-w-[460px] px-6 pb-7 pt-8 text-center sm:px-8">
      <Key size={132} className="mx-auto -rotate-12" />
      <h1 className="t-page mt-5">Log in with your wallet.</h1>
      {page === 'codes' && <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-[22px] text-body">Use the wallet you bought with.</p>}
      <WalletChoices onError={setError} className="mt-6 text-left" />
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red">
          {error}
        </p>
      )}
      <p className="mt-5 text-[13px] text-caption">
        Have a code?{' '}
        <button type="button" className="font-medium t-link" onClick={() => go('redeem')}>
          Redeem it
        </button>
      </p>
    </section>
  )
}
