// Captures the README's pictures from the running dev server (web/src/readme.tsx) into
// .github/readme/, at twice their size, in a light and a dark version.
//
//   npm --prefix web run dev            # in another terminal
//   node web/scripts/readme-art.mjs
//
// Needs Google Chrome. CHROME=<path> picks another Chromium build; BASE=<url> another server.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = path.join(root, '.github/readme')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const base = process.env.BASE ?? 'http://localhost:5173'

/** Each picture's frame, in CSS pixels, including the 8px margin around it. */
const ART = { banner: [1216, 516], journey: [1216, 380], money: [1216, 446], stack: [1216, 486] }

mkdirSync(out, { recursive: true })
for (const [art, [w, h]] of Object.entries(ART)) {
  for (const theme of ['light', 'dark']) {
    const file = path.join(out, `${art}-${theme}.png`)
    execFileSync(chrome, [
      '--headless',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--default-background-color=00000000',
      '--virtual-time-budget=4000',
      `--window-size=${w},${h}`,
      `--screenshot=${file}`,
      `${base}/readme.html?art=${art}&theme=${theme}`,
    ], { stdio: 'ignore' })
    console.log(path.relative(root, file))
  }
}
