import { configFromEnv, handle } from './_lib/relay.js'

/** The relayer endpoint. Everything it does is in `_lib/relay.ts`. */
export const GET = (request: Request) => handle(request, configFromEnv(process.env))
export const POST = (request: Request) => handle(request, configFromEnv(process.env))
