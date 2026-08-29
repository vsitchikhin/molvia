import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import * as schema from '@/db/schema'

// The test database is a separate database on the same server, so a test run can never
// truncate the data entered by hand in the dev one.
export function testDatabaseUrl(): string {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
  } catch {
    // no .env in this environment — fall through to process.env
  }

  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Run `make setup` to generate this copy's .env.")
  }
  return url
}

/** One short-lived connection per test file; the caller closes it in afterAll. */
export function connect(): Sql {
  return postgres(testDatabaseUrl(), { max: 1, onnotice: () => undefined })
}

/** The same drizzle handle the app uses, pointed at the test database. */
export function connectDrizzle(): {
  db: ReturnType<typeof drizzle<typeof schema>>
  close: () => Promise<void>
} {
  const client = connect()
  return { db: drizzle(client, { schema }), close: () => client.end() }
}
