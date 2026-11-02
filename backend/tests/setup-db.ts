import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { MIGRATIONS, assertEveryMigrationApplied } from '@/db/migrate'
import { testDatabaseUrl } from './db'

const root = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Holds the copy's test databases for the whole run (MOL-351): a second run of one copy — a reviewer's worktree with
 * its `.env`, a run past `bin/one-at-a-time.sh` — wrote its rows into the same `…_test_w<n>`, between two `DELETE`s of
 * the first one's `clearAll`, and a file that wrote no trip failed on a trip's key. So it fails at its start instead,
 * naming the run that holds them. A lock of the session: it goes with the connection, however the run ends.
 */
export async function holdTestDatabases(
  maintenanceUrl: string,
  database: string,
): Promise<{ release: () => Promise<void> } | { heldBy: string }> {
  const holder = postgres(maintenanceUrl, {
    max: 1,
    onnotice: () => undefined,
    // `application_name` is 63 bytes of ASCII: the end of the path names the copy or the worktree
    connection: { application_name: `molvia tests ...${root.replace(/\/$/, '').slice(-47)}` },
  })
  const [taken] = await holder<{ taken: boolean }[]>`
    select pg_try_advisory_lock(hashtext('molvia tests'), hashtext(${database})) as taken`
  if (taken?.taken !== true) {
    const others = await holder<{ name: string }[]>`
      select a.application_name as name from pg_locks l join pg_stat_activity a using (pid)
      where l.locktype = 'advisory' and l.granted and l.classid = hashtext('molvia tests')::oid
        and l.objid = hashtext(${database})::oid
        and l.database = (select oid from pg_database where datname = current_database())
      order by a.application_name`
    await holder.end()
    return { heldBy: others.map((other) => other.name).join(', ') || 'a run that has just ended' }
  }
  return { release: () => holder.end() }
}

/**
 * Creates the test database if it is missing and brings it up to the current migrations.
 * Runs once per vitest invocation, before any integration test opens a connection.
 *
 * The files run in parallel (MOL-164), each worker in a copy of this database made by
 * `setup-worker.ts`, so this one is only their template: the previous run's copies are dropped
 * here, since they hold the schema of whatever branch made them.
 */
export async function setup(): Promise<() => Promise<void>> {
  const url = new URL(testDatabaseUrl())
  const database = url.pathname.slice(1)

  const maintenanceUrl = new URL(url.toString())
  maintenanceUrl.pathname = '/postgres'

  const unreachable = (error: unknown) =>
    new Error(
      `Postgres is not reachable at ${url.host}. Integration tests need the dev stack: run \`make up\`.`,
      { cause: error },
    )
  const hold = await holdTestDatabases(maintenanceUrl.toString(), database).catch(
    (error: unknown) => {
      throw unreachable(error)
    },
  )
  if ('heldBy' in hold) {
    throw new Error(
      `${database} is held by another run of this copy (${hold.heldBy}): its files would delete each ` +
        "other's rows. Wait for it, or give a worktree a copy index of its own (`make setup`).",
    )
  }

  const admin = postgres(maintenanceUrl.toString(), { max: 1, onnotice: () => undefined })
  try {
    const existing = await admin`select 1 from pg_database where datname = ${database}`
    if (existing.length === 0) {
      await admin.unsafe(`create database "${database}"`)
    }
    const copies = await admin<{ datname: string }[]>`
      select datname from pg_database where datname like ${`${database.replaceAll('_', '\\_')}\\_w%`}
      order by datname`
    for (const { datname } of copies) {
      await admin.unsafe(`drop database if exists "${datname}" with (force)`)
    }
  } catch (error) {
    throw unreachable(error)
  } finally {
    await admin.end()
  }

  const client = postgres(url.toString(), { max: 1, onnotice: () => undefined })
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    // A test database is where a skipped stamp shows first: it lives on between branches.
    await assertEveryMigrationApplied(client, { migrationsFolder: MIGRATIONS })
  } finally {
    await client.end()
  }

  process.env.TEST_DATABASE_URL = url.toString()

  // Three files test the production bundle; built once here rather than by each of them, which in
  // parallel rewrote `backend/dist` under a neighbour reading it.
  execFileSync('node', ['bin/bundle.mjs', 'backend'], { cwd: root, stdio: 'pipe' })
  return hold.release
}
