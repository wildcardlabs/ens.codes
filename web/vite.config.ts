import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { configFromEnv, handle } from '../api/_lib/relay.js'

/**
 * The relayer on the dev server. In production `/api/redeem` is a Vercel function (../api/redeem.ts);
 * here the same handler runs inside Vite, on the local fork only, signing with an anvil test account.
 */
function devRelayer(env: Record<string, string>): Plugin {
  return {
    name: 'ens-codes-dev-relayer',
    apply: 'serve',
    configureServer(server) {
      if (Number(env.VITE_CHAIN_ID ?? 31337) !== 31337) return
      server.middlewares.use('/api/redeem', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const body = req.method === 'POST' ? Buffer.concat(chunks) : undefined
          void handle(new Request('http://localhost/api/redeem', { method: req.method, headers, body }), configFromEnv(env)).then(async (out) => {
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
    plugins: [react(), tailwindcss(), devRelayer(loadEnv(mode, __dirname, 'VITE_'))],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    build: { target: 'es2022' },
  }
})
