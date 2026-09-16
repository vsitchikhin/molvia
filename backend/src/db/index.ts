import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { env } from '@/env'
import * as schema from './schema'

export type Db = ReturnType<typeof drizzle<typeof schema>>

/**
 * What a repository is handed: the connection, or a transaction on it. A repository that
 * only took `Db` would silently leave the transaction its caller opened — an item written
 * with its barcodes would commit in halves.
 *
 * Spelled through `Parameters` rather than as `PgTransaction<…>` so the schema generics are
 * taken from `Db` itself and cannot drift away from it.
 */
export type Conn = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

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
