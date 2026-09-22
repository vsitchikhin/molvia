// Drops and recreates the database an end-to-end run writes to (MOL-60).
//
// Without this the run started the API against this copy's dev database and left a
// catalogue item and a purchase behind every time. The suite degraded from that: a
// leftover «Кефир 4a2d4992» outranked the canonical item a test expected, deterministically
// and only on a machine with history. Integration tests have had their own database from
// the start; this gives end-to-end the same protection.
//
// It is dropped rather than truncated: recreating also guarantees the schema matches the
// current migrations after a branch switch, and needs no hand-kept list of tables that a
// table added tomorrow would silently escape. Migrating is not this script's job — the API
// does it at boot, with the same migrateToLatest() that runs in production.
//
//   DATABASE_URL=postgres://…/molvia_0_e2e node bin/e2e-database.mjs

import process from 'node:process'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error(
    'e2e database: DATABASE_URL is not set. This script is run by playwright.config.ts.',
  )
  process.exit(1)
}

const target = new URL(url)
const database = decodeURIComponent(target.pathname.slice(1))

// A script that runs `drop database` off an environment variable is a loaded gun. A typo in
// the config then costs a red run instead of the database someone types into by hand.
if (!database.endsWith('_e2e')) {
  console.error(
    `e2e database: refusing to drop "${database}" — an end-to-end database's name must end in _e2e.`,
  )
  process.exit(1)
}

const maintenance = new URL(target.toString())
maintenance.pathname = '/postgres'

const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined })
try {
  // `with (force)` detaches a connection left by a run that died; without it a crashed
  // pass would block the next one.
  await admin.unsafe(`drop database if exists "${database}" with (force)`)
  await admin.unsafe(`create database "${database}"`)
} catch (error) {
  // Both failures land here and the hint fits both: the server is down, or it refused the
  // statement. The error itself says which, so it is printed rather than summarised.
  console.error(
    `e2e database: could not prepare "${database}" at ${target.host}. If Postgres is not up, the dev stack starts it: make up.`,
  )
  console.error(error)
  process.exit(1)
} finally {
  await admin.end()
}
