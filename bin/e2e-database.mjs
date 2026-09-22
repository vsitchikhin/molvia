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
// The raw slice, never decoded: postgres.js opens the path exactly as written and so does
// the integration setup. Decoding it here would let this script recreate one database while
// the run wrote into another — and report success, which is the very failure MOL-60 exists
// to remove, only silent.
const database = target.pathname.slice(1)

// A script that runs `drop database` off an environment variable is a loaded gun, and a
// suffix check is not a safety catch: the name is interpolated into the statement, so a
// quote inside it ends the identifier and `--` comments the rest away — `victim" --_e2e`
// passes endsWith and drops `victim`. The name is written by bin/init-env.sh and is always
// molvia_<index>_e2e, so anything outside that shape is refused rather than escaped.
if (!/^[A-Za-z0-9_]+_e2e$/.test(database)) {
  console.error(
    `e2e database: refusing to drop "${database}" — an end-to-end database is named in ` +
      'letters, digits and underscores and ends in _e2e. Check E2E_DATABASE_URL in .env.',
  )
  process.exit(1)
}

const maintenance = new URL(target.toString())
maintenance.pathname = '/postgres'

const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined })
let failed = false
try {
  // Deliberately without `with (force)`: it cannot tell a connection left by a dead run
  // from the API of a run that is going right now, and killing the live one leaves both
  // sides believing they are fine. Postgres refusing with 55006 is the louder answer, and
  // the window is real — a second run passes playwright's one-off port check during the
  // two or three seconds the first spends preparing the database and migrating.
  await admin.unsafe(`drop database if exists "${database}"`)
  await admin.unsafe(`create database "${database}"`)
} catch (error) {
  failed = true
  if (error && typeof error === 'object' && 'code' in error && error.code === '55006') {
    console.error(
      `e2e database: "${database}" is in use and was left alone. Another end-to-end run is ` +
        'going in this copy — there can only be one. If nothing is running, a dead process ' +
        'left a connection behind and `make down && make up` clears it.',
    )
  } else {
    // The server is down, or it refused the statement. The error itself says which, so it
    // is printed rather than summarised.
    console.error(
      `e2e database: could not prepare "${database}" at ${target.host}. If Postgres is not up, the dev stack starts it: make up.`,
    )
    console.error(error)
  }
} finally {
  await admin.end()
}

if (failed) process.exit(1)
