import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { env } from '@/env'

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

export async function migrateToLatest(): Promise<void> {
  const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
  } finally {
    await client.end()
  }
}
