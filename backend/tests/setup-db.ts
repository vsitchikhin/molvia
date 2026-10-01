import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { MIGRATIONS } from '@/db/migrate'
import { testDatabaseUrl } from './db'

const root = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Creates the test database if it is missing and brings it up to the current migrations.
 * Runs once per vitest invocation, before any integration test opens a connection.
 *
 * The files run in parallel (MOL-164), each worker in a copy of this database made by
 * `setup-worker.ts`, so this one is only their template: the previous run's copies are dropped
 * here, since they hold the schema of whatever branch made them.
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
    const copies = await admin<{ datname: string }[]>`
      select datname from pg_database where datname like ${`${database.replaceAll('_', '\\_')}\\_w%`}`
    for (const { datname } of copies) {
      await admin.unsafe(`drop database if exists "${datname}" with (force)`)
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

  // Three files test the production bundle; built once here rather than by each of them, which in
  // parallel rewrote `backend/dist` under a neighbour reading it.
  execFileSync('node', ['bin/bundle.mjs', 'backend'], { cwd: root, stdio: 'pipe' })
}
