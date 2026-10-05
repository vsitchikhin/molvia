/**
 * `dist/merge.js` — the owner's hand on the merge of twins (MOL-106, В-2), as production runs it: from
 * the bundle alone, a dry run unless `--yes`, a merge by two ids and an undo by its number.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { items } from '@/db/schema'
import { connectDrizzle, testDatabaseUrl } from './db'
import { clearAll, insertItem } from './fixtures'

const { db, close } = connectDrizzle()
const root = fileURLToPath(new URL('../..', import.meta.url))

function merge(...args: string[]) {
  return spawnSync('node', [`${root}backend/dist/merge.js`, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: testDatabaseUrl(),
      // The bundle is built as production, and production refuses to start without these.
      TELEGRAM_BOT_USERNAME: 'molvia_test_bot',
      BOT_API_SECRET: randomBytes(32).toString('base64url'),
    },
  })
}

const mergedInto = async (id: string) =>
  (await db.select({ to: items.mergedInto }).from(items).where(eq(items.id, id)))[0]?.to

let older: string
let younger: string

beforeEach(async () => {
  await clearAll(db)
  older = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3 2' })
  younger = await insertItem(db, { name: 'Молоко 3.2%', searchKey: 'moloko 3 2' })
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('dist/merge.js', () => {
  it('merges nothing on a dry run, merges with --yes, and takes it back by its number', async () => {
    const dry = merge('merge', younger, older)
    expect([dry.status, dry.stdout]).toEqual([
      0,
      expect.stringContaining('dry run: nothing changed'),
    ])
    expect(await mergedInto(younger)).toBeNull()

    const done = merge('merge', younger, older, '--yes')
    expect(done.status).toBe(0)
    const number = /#(\d+)/.exec(done.stdout)?.[1] ?? ''
    expect(await mergedInto(younger)).toBe(older)

    expect(merge('unmerge', number).status).toBe(0)
    expect(await mergedInto(younger)).toBe(older)
    const undone = merge('unmerge', number, '--yes')
    expect([undone.status, undone.stdout]).toEqual([0, expect.stringContaining('apart again')])
    expect(await mergedInto(younger)).toBeNull()
  })

  it('says why a pair was refused, and nothing changes', async () => {
    const dish = await insertItem(db, { kind: 'dish', name: 'Хаш', searchKey: 'hash' })
    const refused = merge('merge', dish, older, '--yes')
    expect([refused.status, refused.stdout]).toEqual([1, expect.stringContaining('of two kinds')])
    expect(merge('unmerge', '424242', '--yes').status).toBe(1)
  })

  it('answers the usage for anything else', () => {
    for (const args of [
      [],
      ['merge', younger],
      ['merge', 'x', 'y'],
      ['unmerge', '0'],
      ['merge', younger, older, '--force'],
    ]) {
      const wrong = merge(...args)
      expect([wrong.status, wrong.stdout]).toEqual([2, expect.stringContaining('usage: merge')])
    }
  })

  it('refuses the first step of a chain, naming the one to undo first', async () => {
    const third = await insertItem(db, { name: 'Молоко 3.20%', searchKey: 'moloko 3 20' })
    const first = /#(\d+)/.exec(merge('merge', younger, older, '--yes').stdout)?.[1] ?? ''
    const second = /#(\d+)/.exec(merge('merge', older, third, '--yes').stdout)?.[1] ?? ''
    const refused = merge('unmerge', first, '--yes')
    expect([refused.status, refused.stdout]).toEqual([
      1,
      expect.stringContaining(`undo #${second} first`),
    ])
  })

  it('lists every candidate named and still apart, with its command (review №9)', async () => {
    const [a, b] = [older, younger].sort()
    await db.execute(sql`
      insert into catalogue_merge_candidates (subject, a, b, named_on)
      values ('item', ${a}, ${b}, '2026-10-06')`)
    const listed = merge('candidates')
    expect(listed.status).toBe(0)
    expect(listed.stdout).toContain(`make merge FROM=${younger} INTO=${older}`)
    expect(listed.stdout).toContain('1 candidates named and still apart')
    merge('merge', younger, older, '--yes')
    expect(merge('candidates').stdout).toContain('0 candidates named and still apart')
  })

  it('says two things apart, a dry run without --yes', async () => {
    expect(merge('apart', younger, older).stdout).toContain('dry run: nothing changed')
    expect(await db.execute(sql`select 1 from catalogue_apart`)).toEqual([])
    const said = merge('apart', younger, older, '--yes')
    expect([said.status, said.stdout]).toEqual([
      0,
      expect.stringContaining('never merges or names'),
    ])
    expect(merge('apart', older, younger, '--yes').stdout).toContain('apart already')
  })
})
