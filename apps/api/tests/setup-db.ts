import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { MIGRATIONS } from '../src/db/migrate'
import { testDatabaseUrl } from './db'

/**
 * Creates the test database if it is missing and brings it up to the current migrations.
 * Runs once per vitest invocation, before any integration test opens a connection.
 */
export async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl())
  const database = url.pathname.slice(1)

  const maintenanceUrl = new URL(url.toString())
  maintenanceUrl.pathname = '/postgres'

  const admin = postgres(maintenanceUrl.toString(), { max: 1, onnotice: () => undefined })
  try {
    const existing = await admin`select 1 from pg_database where datname = ${database}`
    if (existing.length === 0) {
      await admin.unsafe(`create database "${database}"`)
    }
  } catch (error) {
    throw new Error(
      `Postgres is not reachable at ${url.host}. Integration tests need the dev stack: run \`make up\`.`,
      { cause: error },
    )
  } finally {
    await admin.end()
  }

  const client = postgres(url.toString(), { max: 1, onnotice: () => undefined })
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
  } finally {
    await client.end()
  }

  process.env.TEST_DATABASE_URL = url.toString()
}
