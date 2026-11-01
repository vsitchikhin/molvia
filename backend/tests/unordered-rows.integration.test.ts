import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { ownerNotices } from '@/db/schema'
import { connect, connectDrizzle } from './db'
import { clearAll } from './fixtures'
import { turned, unordered } from './unordered-rows'

// MOL-323: the net of the integration tests — rows read with no ORDER BY come back turned by one. This file reads
// so on purpose, the one file `bin/check-ordered-reads.mjs` leaves out.

const { db, close } = connectDrizzle()
const client = connect()

beforeEach(async () => {
  await clearAll(db)
  await db.insert(ownerNotices).values(
    ['failure', 'failure_count', 'silence'].map((kind) => ({
      kind,
      payload: { kind, id: randomUUID() },
      createdAt: new Date(),
    })),
  )
})
afterAll(async () => {
  await clearAll(db)
  await client.end()
  await close()
})

const kinds = (rows: readonly { kind: string }[]): string[] => rows.map((row) => row.kind)

describe('rows read with no order come back turned by one', () => {
  it('turns a read of Drizzle with no orderBy, and leaves one with it', async () => {
    expect(kinds(await db.select({ kind: ownerNotices.kind }).from(ownerNotices))).toEqual([
      'failure_count',
      'silence',
      'failure',
    ])
    expect(
      kinds(
        await db.select({ kind: ownerNotices.kind }).from(ownerNotices).orderBy(ownerNotices.id),
      ),
    ).toEqual(['failure', 'failure_count', 'silence'])
  })

  it('turns execute of a template with no order of its own, an order in a subquery none', async () => {
    const read = (text: ReturnType<typeof sql>) =>
      db.execute<{ kind: string }>(text).then((rows) => kinds([...rows]))
    expect(await read(sql`select kind from owner_notices`)).toEqual([
      'failure_count',
      'silence',
      'failure',
    ])
    expect(
      await read(sql`select kind from (select kind, id from owner_notices order by id) n`),
    ).toEqual(['failure_count', 'silence', 'failure'])
    expect(await read(sql`select kind from owner_notices order by id`)).toEqual([
      'failure',
      'failure_count',
      'silence',
    ])
  })

  it('turns a query of postgres.js, by its tag and as a string', async () => {
    expect(kinds(await client<{ kind: string }[]>`select kind from owner_notices`)).toEqual([
      'failure_count',
      'silence',
      'failure',
    ])
    expect(kinds(await client.unsafe('select kind from owner_notices'))).toEqual([
      'failure_count',
      'silence',
      'failure',
    ])
  })

  it('turns a read inside a transaction too', async () => {
    const inside = await db.transaction((tx) =>
      tx.select({ kind: ownerNotices.kind }).from(ownerNotices),
    )
    expect(kinds(inside)).toEqual(['failure_count', 'silence', 'failure'])
  })

  it('leaves what is not a read: a write returning its rows', async () => {
    const written = await db
      .insert(ownerNotices)
      .values(
        ['model_spend', 'catalogue_merged'].map((kind) => ({
          kind,
          payload: { kind },
          createdAt: new Date(),
        })),
      )
      .returning({ kind: ownerNotices.kind })
    expect(kinds(written)).toEqual(['model_spend', 'catalogue_merged'])
  })
})

describe('what is unordered', () => {
  it.each([
    ['no order', 'select kind from t', true],
    ['an order of its own', 'select kind from t order by id', false],
    ['an order of a subquery only', 'select * from (select kind from t order by id) n', true],
    ['an order of an aggregate only', 'select array_agg(kind order by id) from t', true],
    ['an order in a comment', 'select kind from t -- order by id', true],
    ['an order in a string', "select 'order by' from t", true],
    ['an order in a quoted name', 'select "order by" from t', true],
    ['an order after a string with --', "select kind from t where k <> '--' order by id", false],
  ])('%s', (_, text, expected) => {
    expect(unordered(text)).toBe(expected)
  })

  it('turns rows by one in place, a lone row and none as they are', () => {
    const rows = Object.assign([1, 2, 3], { command: 'SELECT' })
    expect(turned(rows)).toBe(rows)
    expect([...rows]).toEqual([2, 3, 1])
    expect(rows.command).toBe('SELECT')
    expect(turned([1])).toEqual([1])
    expect(turned([])).toEqual([])
  })
})
