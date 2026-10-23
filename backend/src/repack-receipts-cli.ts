import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from '@/db/schema'
import { createRepackRepository } from '@/db/repack-repository'
import { repackReceipts } from '@/repack-receipts'

// Bundled beside the API (`dist/repack-receipts.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec backend node dist/repack-receipts.js [--yes]`.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await repackReceipts(
    process.argv.slice(2),
    createRepackRepository(drizzle(client, { schema })),
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
