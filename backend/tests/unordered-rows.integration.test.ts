import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ownerNotices } from '@/db/schema'
import { connect, connectDrizzle } from './db'
import { clearAll } from './fixtures'
import { onlyRow, sorted, sum } from './rows'
import { inNoOrder, reversed, unordered } from './unordered-rows'

// MOL-323: the net of the integration tests — rows read with no ORDER BY come back reversed. This file reads so on
// purpose, the one file `bin/check-ordered-reads.mjs` leaves out.

const { db, close } = connectDrizzle()
const client = connect()

const WRITTEN = ['failure', 'failure_count', 'silence']
const REVERSED = ['silence', 'failure_count', 'failure']

beforeEach(async () => {
  await clearAll(db)
  await db
    .insert(ownerNotices)
    .values(
      WRITTEN.map((kind) => ({ kind, payload: { kind, id: randomUUID() }, createdAt: new Date() })),
    )
})
afterAll(async () => {
  await clearAll(db)
  await client.end()
  await close()
})

const kinds = (rows: readonly { kind: string }[]): string[] => rows.map((row) => row.kind)

describe('rows given in no order come back reversed', () => {
  it('reverses a read of Drizzle with no orderBy, and leaves one with it', async () => {
    expect(kinds(await db.select({ kind: ownerNotices.kind }).from(ownerNotices))).toEqual(REVERSED)
    expect(
      kinds(
        await db.select({ kind: ownerNotices.kind }).from(ownerNotices).orderBy(ownerNotices.id),
      ),
    ).toEqual(WRITTEN)
  })

  it('reverses execute of a template with no order of its own, an order in a subquery none', async () => {
    const read = (text: ReturnType<typeof sql>) =>
      db.execute<{ kind: string }>(text).then((rows) => kinds([...rows]))
    expect(await read(sql`select kind from owner_notices`)).toEqual(REVERSED)
    expect(
      await read(sql`select kind from (select kind, id from owner_notices order by id) n`),
    ).toEqual(REVERSED)
    expect(await read(sql`select kind from owner_notices order by id`)).toEqual(WRITTEN)
  })

  it('reverses a query of postgres.js, by its tag and as a string', async () => {
    expect(kinds(await client<{ kind: string }[]>`select kind from owner_notices`)).toEqual(
      REVERSED,
    )
    expect(kinds(await client.unsafe('select kind from owner_notices'))).toEqual(REVERSED)
  })

  it('reverses a read inside a transaction too', async () => {
    const inside = await db.transaction((tx) =>
      tx.select({ kind: ownerNotices.kind }).from(ownerNotices),
    )
    expect(kinds(inside)).toEqual(REVERSED)
  })

  // review round 13, Н1: every two rows the other way round, so which of two comes first always changes
  it('puts each two rows the other way round: the first of several alike changes', async () => {
    await db
      .insert(ownerNotices)
      .values({ kind: 'failure', payload: { kind: 'failure', n: 2 }, createdAt: new Date() })
    const rows = await db.select({ payload: ownerNotices.payload }).from(ownerNotices)
    const ordered = await db
      .select({ payload: ownerNotices.payload })
      .from(ownerNotices)
      .orderBy(ownerNotices.id)
    const first = (all: typeof rows) =>
      all.find((row) => (row.payload as { kind: string }).kind === 'failure')
    expect(first(rows)).not.toEqual(first(ordered))
  })

  // review round 13, Н2: an update or a delete returns its rows in no promised order either
  it('reverses the rows an update and a delete return, by Drizzle and by a tag', async () => {
    const updated = await db
      .update(ownerNotices)
      .set({ tries: 1 })
      .returning({ kind: ownerNotices.kind })
    expect(kinds(updated)).toEqual(REVERSED)
    expect(
      kinds(await client<{ kind: string }[]>`update owner_notices set tries = 2 returning kind`),
    ).toEqual(REVERSED)
    expect(kinds(await db.delete(ownerNotices).returning({ kind: ownerNotices.kind }))).toEqual(
      REVERSED,
    )
  })

  it('leaves the rows an insert returns in the order of its values, and a lone row as it is', async () => {
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
    expect(
      kinds(
        await db
          .select({ kind: ownerNotices.kind })
          .from(ownerNotices)
          .where(eq(ownerNotices.kind, 'silence')),
      ),
    ).toEqual(['silence'])
  })
})

// review round 14, О1: the net's limit, named — what `bin/check-ordered-reads.mjs` holds instead
describe('what the net cannot tell', () => {
  it('reads values the same reversed alike: the first row of failure, silence, failure is failure either way', async () => {
    await clearAll(db)
    await db.insert(ownerNotices).values(
      ['failure', 'silence', 'failure'].map((kind, n) => ({
        kind,
        payload: { n },
        createdAt: new Date(),
      })),
    )
    const [reversedFirst] = kinds(await db.select({ kind: ownerNotices.kind }).from(ownerNotices))
    const [writtenFirst] = kinds(
      await db.select({ kind: ownerNotices.kind }).from(ownerNotices).orderBy(ownerNotices.id),
    )
    expect(reversedFirst).toBe(writtenFirst)
  })
})

describe('what makes a use of rows with no order free (rows.ts)', () => {
  it('takes the one row or none, and refuses two', () => {
    expect(onlyRow<string>([])).toBeUndefined()
    expect(onlyRow([{ kind: 'failure' }])).toEqual({ kind: 'failure' })
    expect(onlyRow(new Set(['failure']))).toBe('failure')
    expect(() => onlyRow([{ n: 0 }, { n: 1 }])).toThrow('onlyRow: 2 rows')
    expect(() => onlyRow([{ n: 0 }, { n: 0 }])).toThrow('onlyRow: 2 rows')
  })

  it('sorts values the same whatever order they came in', () => {
    const values = ['b', 'a', 'a', 'c']
    expect(sorted(values)).toEqual(['a', 'a', 'b', 'c'])
    expect(sorted(values.toReversed())).toEqual(['a', 'a', 'b', 'c'])
    expect(sorted([10, 9, 1])).toEqual([1, 9, 10])
    expect(sorted([0, -0, Number.NaN, 1])).toEqual([Number.NaN, -0, 0, 1])
    expect(sorted([0, Number.NaN, -0, 1])).toEqual([Number.NaN, -0, 0, 1])
    // `undefined` last, as every sort puts it, never handed to the comparison
    expect(sorted([true, undefined, false, null, 1n, 'x', 1])).toEqual([
      null,
      false,
      true,
      1,
      1n,
      'x',
      undefined,
    ])
    expect(sorted([[1, true], [1, false], [0], 'z'])).toEqual(['z', [0], [1, false], [1, true]])
    expect(sorted(new Set([2, 1]))).toEqual([1, 2])
  })

  it('refuses what ties with its like and keeps the order it came in', () => {
    const message = 'sorted: only values that are not objects sort the same in any order'
    expect(() => sorted([{ n: 1 } as never])).toThrow(message)
    expect(() => sorted([new Date(0) as never])).toThrow(message)
    expect(() => sorted([(() => 1) as never])).toThrow(message)
    expect(() => sorted([Symbol('a') as never])).toThrow(message)
    expect(() => sorted([[{ n: 1 }] as never])).toThrow(message)
    // eslint-disable-next-line no-sparse-arrays -- a hole is what is refused: `toEqual` takes it for `undefined`
    expect(() => sorted([[, 1] as never])).toThrow(message)
  })

  it('sums whole numbers, and refuses a fraction and a sum past them', () => {
    expect(sum([])).toBe(0)
    expect(sum([1, 2, 3])).toBe(6)
    expect(() => sum([0.1, 0.2])).toThrow('sum: 0.1 is not a whole number')
    expect(() => sum([Number.NaN])).toThrow('is not a whole number')
    expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow('past the whole numbers')
  })
})

describe('what is in no order', () => {
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

  it.each([
    ['SELECT', true],
    ['UPDATE', true],
    ['DELETE', true],
    ['MERGE', true],
    ['INSERT', false],
  ])('a result of %s', (command, expected) => {
    expect(inNoOrder(Object.assign([1, 2], { command }), 'x')).toBe(expected)
  })

  it('reverses rows in place, a lone row and none as they are', () => {
    const rows = Object.assign([1, 2, 3], { command: 'SELECT' })
    expect(reversed(rows)).toBe(rows)
    expect([...rows]).toEqual([3, 2, 1])
    expect(rows.command).toBe('SELECT')
    expect(reversed([1])).toEqual([1])
    expect(reversed([])).toEqual([])
  })
})
