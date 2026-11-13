import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

/**
 * The site never runs inside another page. The response headers already refuse framing
 * (frame-ancestors, X-Frame-Options); this is the same rule for a copy served without them, so a
 * page that embeds the site can't draw over it to trick someone into a signature or a purchase.
 */
function framed(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

const root = document.getElementById('root')!
if (framed()) {
  root.textContent = 'ens.codes does not run inside another page. Open it directly.'
} else {
  createRoot(root).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </StrictMode>,
  )
}
