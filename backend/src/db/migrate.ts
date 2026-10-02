import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { MigrationConfig } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { env } from '@/env'
import { journalOf } from './journal'

/**
 * The folder sits at a different depth depending on how the code is being run: from
 * source this module is `src/db/`, in the production image the whole app is one bundled
 * file with `drizzle/` beside it. Both are checked rather than guessed, so a wrong
 * layout fails at startup with a clear message instead of "can't find _journal.json".
 */
function resolveMigrations(): string {
  const candidates = [
    fileURLToPath(new URL('../../drizzle', import.meta.url)), // running from source
    fileURLToPath(new URL('../drizzle', import.meta.url)), // running from the bundle
  ]

  const found = candidates.find((path) => existsSync(`${path}/meta/_journal.json`))
  if (!found) {
    throw new Error(`no migrations folder next to the code; looked in ${candidates.join(', ')}`)
  }
  return found
}

export const MIGRATIONS = resolveMigrations()

/**
 * The config is a test's own folder and journal; the app runs the chain as it is. A failure leaves
 * the client open: both callers exit on it at once. Closing it there is what lost the log (MOL-153,
 * adversarial З): on a connection the server cut mid-migration, `end()` makes postgres.js 3.4.9
 * write to a socket already gone from a `setImmediate`, and that throw kills the process before
 * the caller's `catch` says «migrations failed» and why — measured, as is that
 * `end({ timeout: 0 })` throws the same.
 */
export async function migrateToLatest(config: Partial<MigrationConfig> = {}): Promise<void> {
  const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS, ...config })
  await assertEveryMigrationApplied(client, config.migrationsFolder ?? MIGRATIONS)
  await client.end()
}

/**
 * drizzle runs a migration only if its stamp, the journal's `when`, is later than the last one
 * applied, and never compares the files with what ran (MOL-105, adversarial Б). Two branches whose
 * stamps lie in another order than they merge in — MOL-147's `0038` two minutes after MOL-105's,
 * merged first — and the earlier is skipped: «migrated», the API up, `vector` missing, the indexes
 * of musl answering under glibc. So after the chain every entry of the journal must have its row,
 * found by the stamp drizzle writes as its `created_at`; one missing stops the boot, `make migrate`
 * and the tests' setup, naming the file.
 */
export async function assertEveryMigrationApplied(client: Sql, folder: string): Promise<void> {
  const rows = await client<{ created_at: string }[]>`
    select created_at::text from drizzle.__drizzle_migrations`
  const applied = new Set(rows.map((row) => row.created_at))
  const skipped = journalOf(folder).filter((entry) => !applied.has(String(entry.when)))
  if (skipped.length > 0) {
    throw new Error(
      `migrations skipped, their stamp is older than one applied after them: ${skipped
        .map((entry) => entry.tag)
        .join(', ')}`,
    )
  }
}
