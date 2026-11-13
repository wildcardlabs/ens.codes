import { handleStats, statsConfigFromEnv } from './_lib/stats.js'

export const POST = (request: Request) => handleStats(request, statsConfigFromEnv(process.env))
