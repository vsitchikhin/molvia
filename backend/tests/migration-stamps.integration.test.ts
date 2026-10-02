import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { MIGRATIONS, assertEveryMigrationApplied } from '@/db/migrate'
import { connect } from './db'

const client = connect()
afterAll(() => client.end())

it('passes on a database that ran every migration of the journal', async () => {
  await expect(
    assertEveryMigrationApplied(client, { migrationsFolder: MIGRATIONS }),
  ).resolves.toBeUndefined()
})

/**
 * MOL-105, adversarial Б: a branch's migration stamped before one already applied — MOL-147's
 * `0038` merged first, MOL-105's renumbered behind it with its old stamp. drizzle skips it and
 * says «migrated»; this is what stops the boot instead, naming the file.
 */
it('names a migration drizzle skipped because its stamp is older than one applied', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'molvia-journal-'))
  try {
    await cp(join(MIGRATIONS, 'meta'), join(folder, 'meta'), { recursive: true })
    const path = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(await readFile(path, 'utf8')) as {
      entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[]
    }
    const first = journal.entries[0]?.when ?? 0
    journal.entries.push({
      idx: journal.entries.length,
      when: first + 1,
      tag: '9999_stamped_too_early',
      version: '7',
      breakpoints: true,
    })
    await writeFile(path, JSON.stringify(journal))

    await expect(assertEveryMigrationApplied(client, { migrationsFolder: folder })).rejects.toThrow(
      /skipped.*9999_stamped_too_early/,
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

/**
 * Round 2, Е: the journal is read where the chain wrote it. A chain run into a schema and a table of
 * its own — as MOL-153's test runs one — was called skipped when the default table was read.
 */
it('reads the journal from the schema and table the chain was given', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'molvia-own-journal-'))
  const chain = {
    migrationsFolder: folder,
    migrationsSchema: 'mol105_own',
    migrationsTable: 'migrations',
  }
  try {
    await mkdir(join(folder, 'meta'))
    await writeFile(join(folder, '0000_note.sql'), 'create table mol105_own_note (id int);')
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [{ idx: 0, version: '7', when: 1, tag: '0000_note', breakpoints: true }],
      }),
    )
    await migrate(drizzle(client), chain)
    await expect(assertEveryMigrationApplied(client, chain)).resolves.toBeUndefined()
    await expect(assertEveryMigrationApplied(client, { migrationsFolder: folder })).rejects.toThrow(
      /skipped.*0000_note/,
    )
  } finally {
    await client`drop table if exists mol105_own_note`
    await client`drop schema if exists mol105_own cascade`
    await rm(folder, { recursive: true, force: true })
  }
})
