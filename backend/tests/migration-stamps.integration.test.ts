import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { MIGRATIONS, assertEveryMigrationApplied } from '@/db/migrate'
import { connect } from './db'

const client = connect()
afterAll(() => client.end())

it('passes on a database that ran every migration of the journal', async () => {
  await expect(assertEveryMigrationApplied(client, MIGRATIONS)).resolves.toBeUndefined()
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

    await expect(assertEveryMigrationApplied(client, folder)).rejects.toThrow(
      /skipped.*9999_stamped_too_early/,
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
