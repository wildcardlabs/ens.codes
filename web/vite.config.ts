import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite'
import { configFromEnv, handle } from '../api/_lib/relay.js'
import { handleStats, statsConfigFromEnv } from '../api/_lib/stats.js'

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

export default defineConfig(({ mode }) => {
  // A hosted build must name its network and a public RPC.
  if (process.env.VERCEL) {
    const env = loadEnv(mode, __dirname, 'VITE_')
    const chain = env.VITE_CHAIN_ID
    if (!chain || chain === '31337') throw new Error('Set VITE_CHAIN_ID (1 or 11155111) and VITE_RPC_URL in Vercel before deploying.')
    if (!env.VITE_RPC_URL || /127\.0\.0\.1|localhost/.test(env.VITE_RPC_URL)) throw new Error('Set VITE_RPC_URL to a public RPC in Vercel before deploying.')
  }
  return {
    plugins: [react(), tailwindcss(), devApi(loadEnv(mode, __dirname, 'VITE_'))],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    // The dashboard shares its types and sign-in wording with the server function.
    server: { fs: { allow: [searchForWorkspaceRoot(__dirname), path.resolve(__dirname, '../api/_lib')] } },
    build: { target: 'es2022' },
  }
})
