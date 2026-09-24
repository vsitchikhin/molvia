import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import { createErasureRepository } from '@/db/erasure-repository'
import * as schema from '@/db/schema'
import { forget } from '@/forget'

// Bundled beside the API (`dist/forget.js`), because the production machine has neither the
// source nor a published database port: `docker compose exec backend node dist/forget.js <id>`.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await forget(
    process.argv.slice(2),
    createErasureRepository(drizzle(client, { schema })),
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
