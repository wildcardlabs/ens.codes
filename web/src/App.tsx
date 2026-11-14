import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { codeFromHash } from '@/lib/code'
import { VAULT } from '@/lib/config'
import { PAGES, urlOf } from '@/lib/site'
import Buy from '@/pages/Buy'
import Home from '@/pages/Home'
import MyCodes from '@/pages/MyCodes'
import Redeem from '@/pages/Redeem'

/** The owner's dashboard is its own bundle: visitors never download it, and nothing links to it. */
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Legal = lazy(() => import('@/pages/Legal'))

/** `home` is the public landing page; buy, redeem and codes are the app; `dashboard` is the owner's; terms and privacy are the legal pages. */
export type Page = 'home' | 'buy' | 'redeem' | 'codes' | 'dashboard' | 'terms' | 'privacy'
export type Go = (p: Page, search?: string) => void

const EXACT: Record<string, Page> = { '/dashboard': 'dashboard', '/terms': 'terms', '/privacy': 'privacy' }
const pathToPage = (path: string): Page =>
  path.startsWith('/redeem') ? 'redeem' : path.startsWith('/codes') ? 'codes' : path.startsWith('/buy') ? 'buy' : (EXACT[path] ?? 'home')
const pageToPath = (p: Page) => (p === 'home' ? '/' : `/${p}`)

/** Keep the document's title, description and search tags in step with the page being shown. */
function describe(page: Page) {
  const meta = PAGES[page]
  document.title = meta.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description)
  document.querySelector('link[rel="canonical"]')?.remove()
  document.querySelector('meta[name="robots"]')?.remove()
  const tag = meta.index
    ? Object.assign(document.createElement('link'), { rel: 'canonical', href: urlOf(meta) })
    : Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' })
  document.head.appendChild(tag)
}

export default function App() {
  const [page, setPage] = useState<Page>(() => (codeFromHash() ? 'redeem' : pathToPage(location.pathname)))
  /** A code from a redeem link. `n` remounts the redeem page for each new code. */
  const [incoming, setIncoming] = useState<{ code: string; n: number } | null>(() => {
    const code = codeFromHash()
    return code ? { code, n: 1 } : null
  })

  useEffect(() => {
    // Back/forward, or a redeem link pasted into an open tab (a hash-only change, no reload).
    const onNavigate = () => {
      const code = codeFromHash()
      if (code) {
        setIncoming((prev) => (prev?.code === code ? prev : { code, n: (prev?.n ?? 0) + 1 }))
        setPage('redeem')
      } else if (!location.hash || location.pathname !== '/') setPage(pathToPage(location.pathname))
    }
    window.addEventListener('popstate', onNavigate)
    window.addEventListener('hashchange', onNavigate)
    return () => {
      window.removeEventListener('popstate', onNavigate)
      window.removeEventListener('hashchange', onNavigate)
    }
  }, [])

  /** Go to a page. `search` carries a prefilled choice to it, e.g. `?amount=25` for Buy. */
  const go = useCallback((p: Page, search = '') => {
    const url = pageToPath(p) + search
    if (url !== location.pathname + location.search || location.hash) history.pushState(null, '', url)
    setPage(p)
    window.scrollTo({ top: 0 })
  }, [])

  /** A code typed on the home page: open it on the redeem page. */
  const redeemCode = useCallback(
    (code: string) => {
      setIncoming((prev) => ({ code, n: (prev?.n ?? 0) + 1 }))
      go('redeem')
    },
    [go],
  )

  useEffect(() => {
    describe(page)
  }, [page])

  return (
    <>
      {page === 'home' ? (
        <Home go={go} onCode={redeemCode} />
      ) : page === 'dashboard' ? (
        <Suspense fallback={null}>
          <Dashboard />
        </Suspense>
      ) : (
        <AppShell page={page} go={go}>
          {page === 'terms' || page === 'privacy' ? (
            <Suspense fallback={null}>
              <Legal doc={page} />
            </Suspense>
          ) : !VAULT ? (
            <p className="max-w-[560px] rounded-xl bg-card p-4 text-[14px] text-red">No vault address configured. Set VITE_VAULT in web/.env.local.</p>
          ) : page === 'buy' ? (
            <Buy go={go} />
          ) : page === 'redeem' ? (
            <Redeem key={incoming?.n ?? 0} go={go} initialCode={incoming?.code} />
          ) : (
            <MyCodes go={go} />
          )}
        </AppShell>
      )}
      <Toaster position="bottom-center" />
    </>
  )
}
