import { renderToString } from 'react-dom/server'
import { AppShell } from '@/components/AppShell'
import Buy from '@/pages/Buy'
import Home from '@/pages/Home'
import Redeem from '@/pages/Redeem'

/** The pages the build draws to HTML, each with words it must contain (see vite.config.ts). */
export const PRERENDERED = { home: 'Renewals you can hand over.', buy: 'Buy a claim code.', redeem: 'Redeem a claim code.' } as const
export type Prerendered = keyof typeof PRERENDERED

const go = () => {}

/**
 * A page as HTML, as a logged-out visitor first sees it. The build puts this into the page's file, so
 * its words are there for anything that reads it without running the app: search engines, AI
 * assistants, link previews. In a browser the app then draws the same page over it.
 */
export function render(page: Prerendered): string {
  if (page === 'home') return renderToString(<Home go={go} onCode={go} />)
  return renderToString(
    <AppShell page={page} go={go}>
      {page === 'buy' ? <Buy go={go} /> : <Redeem go={go} />}
    </AppShell>,
  )
}
