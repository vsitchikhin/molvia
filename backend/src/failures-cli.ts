import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import { createFailureRepository } from '@/db/failures-repository'
import * as schema from '@/db/schema'
import { failures } from '@/failures'

// Bundled beside the API (`dist/failures.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec backend node dist/failures.js --limit 50`.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  const rows = createFailureRepository(drizzle(client, { schema }))
  process.exitCode = await failures(
    process.argv.slice(2),
    async (limit) => rows.latest(limit),
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
