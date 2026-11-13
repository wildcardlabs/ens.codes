import confetti from 'canvas-confetti'

/** The sticker hues, read from the theme so every scheme celebrates in its own colours. */
function hues(): string[] {
  const css = getComputedStyle(document.documentElement)
  return ['--green', '--yellow', '--sky', '--pink', '--purple', '--orange'].map((v) => css.getPropertyValue(v).trim()).filter(Boolean)
}

let last = 0

/**
 * A short burst of confetti in the sticker colours, with stars among the pieces. Used for the two
 * moments something real just happened onchain: a purchase confirmed and a code redeemed. It runs
 * once, never loops, and does nothing for people who ask for reduced motion.
 */
export function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // React's dev mode mounts twice; one burst is enough.
  if (Date.now() - last < 800) return
  last = Date.now()

  const colors = hues()
  const star = confetti.shapeFromPath({ path: 'M10 1l2.6 6 6.4.6-4.8 4.3 1.4 6.3L10 15l-5.6 3.2 1.4-6.3L1 7.6 7.4 7z' })
  const burst = (ratio: number, options: confetti.Options) =>
    void confetti({
      origin: { x: 0.5, y: 0.32 },
      colors,
      shapes: ['circle', 'square', star],
      particleCount: Math.floor(140 * ratio),
      disableForReducedMotion: true,
      ...options,
    })

  burst(0.25, { spread: 26, startVelocity: 55 })
  burst(0.2, { spread: 60 })
  burst(0.35, { spread: 100, decay: 0.91, scalar: 0.9 })
  burst(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.3 })
  burst(0.1, { spread: 120, startVelocity: 45 })
}
