import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeMigrationFailure } from '@/db/failure'
import { connect } from './db'

/** What a person typed, already in a table when the deploy comes. */
const TYPED = 'Молоко Мариан 1Л у Ашота'

/**
 * A migration failing on a deploy, through drizzle's own migrator, as `migrateToLatest` runs it
 * (MOL-153, adversarial А). A folder and a journal of its own, so the app's chain is untouched.
 */
describe('лог упавшей миграции — вид и инструкция, без значения строки', () => {
  const sql = connect()
  const folders: string[] = []

  async function failingMigration(statement: string): Promise<unknown> {
    const folder = mkdtempSync(join(tmpdir(), 'mol153-'))
    folders.push(folder)
    mkdirSync(join(folder, 'meta'))
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [
          { idx: 0, version: '7', when: 1759300000000, tag: '0000_mol153', breakpoints: true },
        ],
      }),
    )
    writeFileSync(join(folder, '0000_mol153.sql'), statement)
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
    const error = await failingMigration(statement)

    // The danger is real: the value is in the cause's message.
    expect(String((error as Error).cause)).toContain(TYPED)
    const summary = describeMigrationFailure(error)
    expect(summary).toMatchObject({ errorName: 'Error', code: '22P02', statement })
    expect(JSON.stringify(summary)).not.toContain(TYPED)
  })
})
