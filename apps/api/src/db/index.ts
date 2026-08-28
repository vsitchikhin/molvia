import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { env } from '../env'
import * as schema from './schema'

type Db = ReturnType<typeof drizzle<typeof schema>>

let client: Sql | undefined
let db: Db | undefined

// Lazy on purpose: importing a module must not open a connection, or every test that
// touches a use case would need a database.
function getClient(): Sql {
  client ??= postgres(env.DATABASE_URL, { connect_timeout: 5, onnotice: () => undefined })
  return client
}

export function getDb(): Db {
  db ??= drizzle(getClient(), { schema })
  return db
}

/**
 * Whether the database answers at all. Deliberately not a boolean field on some larger
 * status object: liveness and readiness are different questions, and this one is
 * readiness — a process that is up but cannot reach its database is not serving.
 */
export async function databaseIsReachable(): Promise<boolean> {
  try {
    await getClient()`select 1`
    return true
  } catch {
    return false
  }
}
