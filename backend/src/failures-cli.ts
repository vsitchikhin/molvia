import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { VERSION, env } from '@/env'
import { createFailureRepository } from '@/db/failures-repository'
import * as schema from '@/db/schema'
import { bundleDecoder, failures, phoneDecoder } from '@/failures'

// Bundled beside the API (`dist/failures.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec backend node dist/failures.js --limit 50`. The API's map lies beside it in the
// image; run from the source there is none, and the frames are the source's already. The phone's
// maps are the site's, beside its build (MOL-144).
const mapPath = fileURLToPath(new URL('./index.js.map', import.meta.url))
const decoding = existsSync(mapPath)
  ? { build: VERSION, decode: bundleDecoder(JSON.parse(readFileSync(mapPath, 'utf8')) as object) }
  : undefined
const site = env.APP_BASE_URL
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  const rows = createFailureRepository(drizzle(client, { schema }))
  process.exitCode = await failures(
    process.argv.slice(2),
    async (limit) => rows.latest(limit),
    (line) => {
      console.log(line)
    },
    decoding,
    site === undefined ? undefined : async (found) => phoneDecoder(found, site),
  )
} finally {
  await client.end()
}
