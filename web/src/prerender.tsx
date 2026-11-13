import { renderToString } from 'react-dom/server'
import Home from '@/pages/Home'

/**
 * The landing page as HTML. The build puts this into index.html (see vite.config.ts), so the page's
 * words are there for anything that reads it without running the app: search engines, AI
 * assistants, link previews. In a browser the app then draws the same page over it.
 */
export const render = () => renderToString(<Home go={() => {}} onCode={() => {}} />)
