import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createServer, defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite'
import { configFromEnv, handle } from '../api/_lib/relay.js'
import { handleStats, statsConfigFromEnv } from '../api/_lib/stats.js'
import { headTags, PAGES, type PageKey } from './src/lib/site'

/**
 * The server functions on the dev server. In production `/api/redeem` and `/api/stats` are Vercel
 * functions (../api); here the same handlers run inside Vite, on the local fork only, and the
 * relayer signs with an anvil test account.
 */
function devApi(env: Record<string, string>): Plugin {
  const routes: Record<string, (request: Request) => Promise<Response>> = {
    '/api/redeem': (request) => handle(request, configFromEnv(env)),
    '/api/stats': (request) => handleStats(request, statsConfigFromEnv(env)),
  }
  return {
    name: 'ens-codes-dev-api',
    apply: 'serve',
    configureServer(server) {
      if (Number(env.VITE_CHAIN_ID ?? 31337) !== 31337) return
      for (const [path, run] of Object.entries(routes))
        server.middlewares.use(path, (req, res) => {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', () => {
            const headers = new Headers()
            for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
            const body = req.method === 'POST' ? Buffer.concat(chunks) : undefined
            void run(new Request(`http://localhost${path}`, { method: req.method, headers, body })).then(async (out) => {
              res.statusCode = out.status
              out.headers.forEach((v, k) => res.setHeader(k, v))
              res.end(await out.text())
            })
          })
        })
    },
  }
}

/**
 * Each page's own title, description and share tags, in the HTML itself: search engines and link
 * previews read them without running the app. The landing page's go into index.html; a build also
 * writes one file for every other page (buy.html, redeem.html and so on), the same app with that
 * page's tags, which the host serves at /buy, /redeem and so on.
 *
 * A build also draws the landing, buy and redeem pages once, as a logged-out visitor first sees them,
 * and puts the result into their files, so their words are there for anything that doesn't run the
 * app. The other pages belong to a wallet or are drawn from text, and start empty.
 */
function pageHeads(): Plugin {
  const MARK = '<!--page-->'
  const ROOT = '<div id="root"></div>'
  let out = ''
  let root = ''
  let mode = ''
  return {
    name: 'ens-codes-page-heads',
    configResolved(config) {
      out = config.command === 'build' ? path.resolve(config.root, config.build.outDir) : ''
      root = config.root
      mode = config.mode
    },
    transformIndexHtml: (html) => html.replace(MARK, `${MARK}\n    ${headTags('home')}\n    <!--/page-->`),
    async closeBundle() {
      const index = out && path.join(out, 'index.html')
      if (!index || !fs.existsSync(index)) return
      const shell = fs.readFileSync(index, 'utf8')
      const block = /<!--page-->[\s\S]*?<!--\/page-->/
      if (!block.test(shell) || !shell.includes(ROOT)) throw new Error('index.html has lost its <!--page--> marker or its empty #root.')
      const drawn = await drawPages(root, mode)
      for (const key of Object.keys(PAGES) as PageKey[]) {
        const html = shell.replace(block, () => headTags(key))
        const body = drawn[key]
        fs.writeFileSync(key === 'home' ? index : path.join(out, `${key}.html`), body ? html.replace(ROOT, () => `<div id="root">${body}</div>`) : html)
      }
    },
  }
}

/** Draw the prerendered pages to HTML, by loading the app's own code the way the dev server would. */
async function drawPages(root: string, mode: string): Promise<Partial<Record<PageKey, string>>> {
  const server = await createServer({
    configFile: false,
    root,
    mode,
    resolve: { alias: { '@': path.resolve(root, './src') } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const { render, PRERENDERED } = (await server.ssrLoadModule('/src/prerender.tsx')) as typeof import('./src/prerender')
    const drawn: Partial<Record<PageKey, string>> = {}
    for (const [key, words] of Object.entries(PRERENDERED) as [keyof typeof PRERENDERED, string][]) {
      const html = render(key)
      // A build that would ship a page without its words should stop here, not deploy.
      if (!html.includes(words)) throw new Error(`The ${key} page rendered without "${words}".`)
      drawn[key] = html
    }
    return drawn
  } finally {
    await server.close()
  }
}

export default defineConfig(({ mode }) => {
  // A hosted build must name its network and a public RPC.
  if (process.env.VERCEL) {
    const env = loadEnv(mode, __dirname, 'VITE_')
    const chain = env.VITE_CHAIN_ID
    if (!chain || chain === '31337') throw new Error('Set VITE_CHAIN_ID (1 or 11155111) and VITE_RPC_URL in Vercel before deploying.')
    if (!env.VITE_RPC_URL || /127\.0\.0\.1|localhost/.test(env.VITE_RPC_URL)) throw new Error('Set VITE_RPC_URL to a public RPC in Vercel before deploying.')
  }
  return {
    plugins: [react(), tailwindcss(), pageHeads(), devApi(loadEnv(mode, __dirname, 'VITE_'))],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    // The dashboard shares its types and sign-in wording with the server function.
    server: { fs: { allow: [searchForWorkspaceRoot(__dirname), path.resolve(__dirname, '../api/_lib')] } },
    build: { target: 'es2022' },
  }
})
