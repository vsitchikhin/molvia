import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from '@/db/schema'
import { createReceiptMissesRepository } from '@/db/receipt-misses-repository'
import { receiptMisses } from '@/receipt-misses'

// Bundled beside the API (`dist/receipt-misses.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec backend node dist/receipt-misses.js reasons --from 2026-11-01`.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await receiptMisses(
    process.argv.slice(2),
    createReceiptMissesRepository(drizzle(client, { schema })),
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
