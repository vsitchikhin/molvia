import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from '@/db/schema'
import { createSeedRepository } from '@/db/seed-repository'
import { seedCatalogue } from '@/seed-catalogue'

// Bundled beside the API (`dist/seed-catalogue.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec backend node dist/seed-catalogue.js [--yes]`.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await seedCatalogue(
    process.argv.slice(2),
    createSeedRepository(drizzle(client, { schema })),
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
