import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import { createGatesReader } from '@/db/gates-reader'
import * as schema from '@/db/schema'
import { gates } from '@/gates'

// Bundled beside the API (`dist/gates.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec backend node dist/gates.js --from 2026-10-05`.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await gates(
    process.argv.slice(2),
    createGatesReader(drizzle(client, { schema })),
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
