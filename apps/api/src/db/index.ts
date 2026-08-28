import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from './schema'

type Db = ReturnType<typeof drizzle<typeof schema>>

let db: Db | undefined

// Lazy on purpose: importing a module must not open a connection, or every test that
// touches a use case would need a database.
export function getDb(): Db {
  db ??= drizzle(postgres(env.DATABASE_URL), { schema })
  return db
}
