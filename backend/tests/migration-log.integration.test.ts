import { execFile } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeMigrationFailure } from '@/db/failure'
import { connect, testDatabaseUrl } from './db'

/** What a person typed, already in a table when the deploy comes. */
const TYPED = 'Молоко Мариан 1Л у Ашота'

/**
 * A migration failing on a deploy, through drizzle's own migrator, as `migrateToLatest` runs it
 * (MOL-153, adversarial А). A folder and a journal of its own, so the app's chain is untouched.
 */
describe('лог упавшей миграции — вид и инструкция, без значения строки', () => {
  const sql = connect()
  const folders: string[] = []

  /** The journal names every tag; a tag whose statement is `null` has no file beside it. */
  async function failingMigration(files: Record<string, string | null>): Promise<unknown> {
    const folder = mkdtempSync(join(tmpdir(), 'mol153-'))
    folders.push(folder)
    mkdirSync(join(folder, 'meta'))
    const entries = Object.keys(files).map((tag, idx) => ({
      idx,
      version: '7',
      when: 1759300000000 + idx,
      tag,
      breakpoints: true,
    }))
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
    )
    for (const [tag, statement] of Object.entries(files)) {
      if (statement !== null) writeFileSync(join(folder, `${tag}.sql`), statement)
    }
    const client = connect()
    try {
      await migrate(drizzle(client), {
        migrationsFolder: folder,
        migrationsSchema: 'mol153',
        migrationsTable: 'mol153_migrations',
      })
    } catch (error) {
      return error
    } finally {
      await client.end()
    }
    throw new Error('the migration went through')
  }

  beforeEach(async () => {
    await sql`drop table if exists mol153_notes`
    await sql`create table mol153_notes (note text not null)`
    await sql`insert into mol153_notes values (${TYPED})`
  })

  afterEach(async () => {
    await sql`drop table if exists mol153_notes`
    await sql`drop schema if exists mol153 cascade`
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  afterAll(async () => {
    await sql.end()
  })

  it('смена типа столбца с текстом человека: Postgres кладёт значение в сообщение — в лог оно не идёт', async () => {
    const statement =
      'ALTER TABLE "mol153_notes" ALTER COLUMN "note" SET DATA TYPE numeric USING "note"::numeric;'
    const error = await failingMigration({ '0000_mol153': statement })

    // The danger is real: the value is in the cause's message.
    expect(String((error as Error).cause)).toContain(TYPED)
    const summary = describeMigrationFailure(error)
    expect(summary).toMatchObject({ errorName: 'Error', code: '22P02', statement })
    expect(JSON.stringify(summary)).not.toContain(TYPED)
  })

  it('журнал называет файл, которого нет, — в логе его имя: слова мигратора о наших файлах (Е)', async () => {
    const error = await failingMigration({
      '0000_mol153': 'SELECT 1;',
      '0001_folded_away': null,
    })

    const summary = describeMigrationFailure(error)
    expect(summary).not.toHaveProperty('code')
    expect(summary.reason).toContain('0001_folded_away.sql')
  })
})

/**
 * A boot whose connection the server cuts mid-migration — a restart of Postgres during a deploy
 * (MOL-153, adversarial З). Its own process, since what broke it was a throw that killed the
 * process before the `catch` of `index.ts` could log anything.
 */
const BOOT = `import process from 'node:process'
import postgres from 'postgres'
import { describeMigrationFailure } from '@/db/failure'
import { migrateToLatest } from '@/db/migrate'

const admin = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => undefined })
setTimeout(() => {
  void admin
    .unsafe("select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(3)%' and pid <> pg_backend_pid()")
    .then(() => admin.end())
}, 800)
try {
  await migrateToLatest({
    migrationsFolder: process.env.FOLDER,
    migrationsSchema: 'mol153_cut',
    migrationsTable: 'migrations',
  })
} catch (error) {
  console.log(JSON.stringify({ ...describeMigrationFailure(error), msg: 'migrations failed' }))
  process.exit(1)
}
console.log('migrated')
`

describe('соединение оборвано посреди миграции — «migrations failed» всё равно пишется', () => {
  const sql = connect()

  afterAll(async () => {
    await sql`drop schema if exists mol153_cut cascade`
    await sql.end()
  })

  it('процесс выходит с кодом 1 и строкой лога с CONNECTION_CLOSED, а не со стеком postgres.js', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'mol153-cut-'))
    mkdirSync(join(folder, 'meta'))
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [{ idx: 0, version: '7', when: 1, tag: '0000_sleep', breakpoints: true }],
      }),
    )
    writeFileSync(join(folder, '0000_sleep.sql'), 'SELECT pg_sleep(3);')
    // Beside this file, and run from the backend, so `tsx` resolves `@/` by the backend's own
    // tsconfig whichever directory the suite was started from (the root, in CI).
    const backend = fileURLToPath(new URL('..', import.meta.url))
    const script = join(backend, 'tests', `.mol153-boot-${String(process.pid)}.ts`)
    writeFileSync(script, BOOT)

    const run = await new Promise<{ exit: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', script],
        {
          cwd: backend,
          env: { ...process.env, DATABASE_URL: testDatabaseUrl(), FOLDER: folder },
          timeout: 20_000,
        },
        (error, stdout, stderr) => {
          resolve({ exit: error ? Number(error.code ?? 1) : 0, stdout, stderr })
        },
      )
    })
    rmSync(script, { force: true })
    rmSync(folder, { recursive: true, force: true })

    expect(run.stderr).not.toContain('postgres/src/connection.js')
    expect(run.exit).toBe(1)
    const line = JSON.parse(run.stdout.trim()) as Record<string, unknown>
    expect(line).toMatchObject({ msg: 'migrations failed', code: 'CONNECTION_CLOSED' })
  }, 30_000)
})

describe('`make migrate` — сбой печатается так же, как API пишет его в лог', () => {
  it('выход 1 и сводка по виду: ни стека отказа, ни пароля из адреса (адверсариальный И)', async () => {
    const backend = fileURLToPath(new URL('..', import.meta.url))
    const run = await new Promise<{ exit: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', join(backend, 'src', 'db', 'migrate-cli.ts')],
        {
          cwd: backend,
          // Nothing listens on port 1: the migrator fails before its first statement.
          env: { ...process.env, DATABASE_URL: 'postgres://molvia:mol153-secret@127.0.0.1:1/x' },
          timeout: 20_000,
        },
        (error, stdout, stderr) => {
          resolve({ exit: error ? Number(error.code ?? 1) : 0, stdout, stderr })
        },
      )
    })

    expect(run.exit).toBe(1)
    expect(run.stdout).not.toContain('migrations applied')
    expect(run.stderr).toContain('migrations failed')
    expect(run.stderr).toContain("code: 'ECONNREFUSED'")
    expect(run.stderr).not.toContain('mol153-secret')
    expect(run.stderr).not.toMatch(/^\s*cause:/m)
  }, 30_000)
})
