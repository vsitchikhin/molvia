import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAY_READ, unorderedReads, uuidColumns } from './check-ordered-reads.mjs'

const FILE = 'a.integration.test.ts'
const UUIDS = new Set(['sessions.id'])

const lines = (source: string): number[] =>
  unorderedReads(FILE, source, UUIDS).map((found) => Number.parseInt(found))

const inTest = (body: string): string => `it('x', async () => {\n${body}\n})`
const found = (body: string): string[] => unorderedReads(FILE, inTest(body), UUIDS)

describe('unorderedReads', () => {
  // «то же фото дважды» as it failed on CI 41022785698, and the reads of the sweep of MOL-323
  it('finds a read with no order compared in order, through a name or in place', () => {
    expect(
      lines(`
        const words = await db.select().from(feedback).where(eq(feedback.threadId, thread))
        expect(words.map((row) => [row.text, row.pictures])).toEqual([['', 1], ['', 1]])
        expect(await db.select().from(sessions)).toStrictEqual([a, b])
        expect((await db.select().from(lines)).map((l) => l.hs)).toMatchObject(['56.10', '56.10'])
        expect.soft(await db.select().from(notices)).toEqual([a, b])
      `),
    ).toEqual([2, 4, 5, 6])
  })

  // the rule is closed (review of MOL-323, round 1): what is not known to be orderless is refused
  it.each([
    ['an index past 0', `const rows = await db.select().from(t)\nexpect(rows[1]?.id).toBe(a)`],
    [
      'an index from the end',
      `const rows = await db.select().from(t)\nexpect(rows.at(-1)).toBe(a)`,
    ],
    ['an index by the length', `const rows = await db.select().from(t)\nf(rows[rows.length - 1])`],
    ['taken apart into two', `const [a, b] = await db.select().from(t)`],
    ['taken apart past a hole', `const [, b] = await db.select().from(t)`],
    [
      'through filter',
      `const rows = await db.select().from(t)\nexpect(rows.filter(Boolean)).toEqual([a, b])`,
    ],
    [
      'through slice and map',
      `expect((await db.select().from(t)).slice(1).map(f)).toEqual([a, b])`,
    ],
    [
      'named twice',
      `const rows = await db.select().from(t)\nconst texts = rows.map(f)\nexpect(texts).toEqual([a, b])`,
    ],
    [
      'given by assignment',
      `let rows = []\nrows = await db.select().from(t)\nexpect(rows).toEqual([a, b])`,
    ],
    ['put in an object', `expect({ words: await db.select().from(t) }).toEqual({ words: [a, b] })`],
    [
      'taken from Promise.all',
      `const [words, n] = await Promise.all([db.select().from(t), count()])\nexpect(words).toEqual([a, b])`,
    ],
    ['joined', `expect((await db.select().from(t)).map(f).join()).toBe('a,b')`],
    [
      'forEach',
      `const rows = await db.select().from(t)\nrows.forEach((row, i) => expect(row).toBe(all[i]))`,
    ],
    [
      'entries',
      `for (const [i, row] of (await db.select().from(t)).entries()) expect(row).toBe(all[i])`,
    ],
    ['reversed', `expect((await db.select().from(t)).reverse()).toEqual(x)`],
    ['spread', `expect([...(await db.select().from(t))]).toEqual([a, b])`],
    ['resolves', `await expect(db.select().from(t)).resolves.toEqual([a, b])`],
    ['an inline snapshot', `expect(await db.select().from(t)).toMatchInlineSnapshot()`],
    ['compared with another read', `expect(await db.select().from(t)).toEqual(before)`],
    ['stringified and compared', `expect(JSON.stringify(await db.select().from(t))).toBe('[1,2]')`],
    ['handed to a function', `expect(sum(await db.select().from(t))).toBe(3)`],
    [
      'a template handed to execute',
      'expect(await db.execute(sql`select id from t`)).toEqual([a, b])',
    ],
    [
      'a template on its own',
      'const rows = await sql`select id from t`\nexpect(rows).toEqual([a, b])',
    ],
    [
      'order by of an aggregate only',
      'expect(await db.execute(sql`select array_agg(x order by id) from t group by k`)).toEqual([a, b])',
    ],
    [
      'order by of a window only',
      'expect(await db.execute(sql`select row_number() over (order by id) from t`)).toEqual([a, b])',
    ],
    [
      'order by in a comment',
      'expect(await db.execute(sql`select id from t -- order by id`)).toEqual([a, b])',
    ],
    [
      'order by in a string',
      "expect(await db.execute(sql`select 'order by' from t`)).toEqual([a, b])",
    ],
    ['findMany with no orderBy', `expect(await db.query.t.findMany({ where })).toEqual([a, b])`],
    ['selectDistinct', `expect(await db.selectDistinct().from(t)).toEqual([a, b])`],
    ['a cast', `expect((await db.select().from(t)) as Row[]).toEqual([a, b])`],
    ['orderBy() with nothing', `expect(await db.select().from(t).orderBy()).toEqual([a, b])`],
    [
      'orderBy(createdAt) against rows in place',
      `expect(await db.select().from(t).orderBy(t.createdAt)).toEqual([a, b])`,
    ],
    [
      'orderBy of a uuid against rows in place',
      `expect(await db.select().from(sessions).orderBy(desc(sessions.id))).toEqual([a, b])`,
    ],
    [
      'orderBy of a uuid by an index',
      `const rows = await db.select().from(sessions).orderBy(sessions.id)\nexpect(rows[1]).toBe(a)`,
    ],
  ])('refuses %s', (_, body) => {
    expect(found(body)).toHaveLength(1)
  })

  it('finds a function of the file that returns such a read — in place, named first, and through another', () => {
    const source = `
      const told = async () =>
        (await db.select({ payload: t.payload }).from(t)).map((row) => row.payload)
      async function verdictsOf(id: string) {
        const rows = await db.select().from(verdicts).where(eq(verdicts.actorId, id))
        return rows.map((row) => row.itemId)
      }
      async function steps() {
        return (await told()).map((n) => n.step)
      }
      it('x', async () => {
        expect(await told()).toEqual([a, b])
        expect(await verdictsOf(me)).toEqual([milk, bread])
        expect(await steps()).toEqual([90, 100])
      })
    `
    expect(lines(source)).toEqual([12, 13, 14])
  })

  it('names the line of the read and why', () => {
    const [first] = found(
      `const rows = await db\n  .select()\n  .from(t)\nexpect(rows).toEqual([a, b])`,
    )
    expect(first).toBe('2: const rows = await db — toEqual([2]) at 5')
  })

  it.each([
    ['orderBy', `expect(await db.select().from(t).orderBy(t.id)).toEqual([a, b])`],
    [
      'orderBy before where',
      `expect(await db.select().from(t).orderBy(t.id).where(c)).toEqual([a, b])`,
    ],
    [
      'createdAt with a second column',
      `expect(await db.select().from(t).orderBy(t.createdAt, t.id)).toEqual([a, b])`,
    ],
    [
      'a uuid against another read',
      `expect(await db.select().from(sessions).orderBy(sessions.id)).toEqual(before)`,
    ],
    [
      'order by in the template',
      'expect(await db.execute(sql`select id from t where x in (select y from u) order by id`)).toEqual([a, b])',
    ],
    [
      'a select with no from — one row',
      'expect(await db.execute(sql`select ${n}::int as n`)).toEqual([a, b])',
    ],
    [
      'findMany with orderBy',
      `expect(await db.query.t.findMany({ orderBy: t.id })).toEqual([a, b])`,
    ],
    ['sort', `expect((await db.select().from(t)).map(f).sort()).toEqual([a, b])`],
    [
      'toSorted through a name',
      `const rows = await db.select().from(t)\nexpect(rows.map(f).toSorted()).toEqual([a, b])`,
    ],
    ['a length', `expect(await db.select().from(t)).toHaveLength(2)`],
    [
      'a length through a name',
      `const rows = await db.select().from(t)\nexpect(rows.length).toBe(2)`,
    ],
    ['no rows', `expect(await db.select().from(t)).toEqual([])`],
    ['one row', `expect(await db.select().from(t)).toEqual([a])`],
    ['the first row taken apart', `const [row] = await db.select().from(t)`],
    ['the first row by index', `const rows = await db.select().from(t)\nexpect(rows[0]).toBe(a)`],
    ['the first row through a branch', `const [row] = x ? [] : await db.select().from(t)`],
    ['find', `expect((await db.select().from(t)).find(f)).toEqual([a, b])`],
    ['some', `expect((await db.select().from(t)).some(f)).toBe(true)`],
    ['a sum', `expect((await db.select().from(t)).reduce((all, r) => all + r.n, 0)).toBe(3)`],
    ['a loop', `for (const row of await db.select().from(t)) expect(row.n).toBe(1)`],
    ['a Set', `expect(new Set((await db.select().from(t)).map(f)).size).toBe(1)`],
    [
      'notInArray',
      `const ids = (await db.select().from(t)).map(f)\nwhere(notInArray(t.id, ids.length > 0 ? ids : [x]))`,
    ],
    [
      'arrayContaining',
      `expect(await db.select().from(t)).toEqual(expect.arrayContaining([a, b]))`,
    ],
    ['toContainEqual', `expect(await db.select().from(t)).toContainEqual(a)`],
    ['not', `expect(await db.select().from(t)).not.toEqual([a, b])`],
    [
      'stringified, not containing',
      `expect(JSON.stringify([...(await db.select().from(t))])).not.toContain(secret)`,
    ],
    ['a type of it', `const rows = await db.select().from(t)\ntype Row = (typeof rows)[number]`],
    ['discarded', `await db.select().from(t)`],
    ['an insert returning', `expect(await db.insert(t).values(v).returning()).toEqual([a, b])`],
    [
      'a template that selects nothing',
      'expect(await db.execute(sql`delete from t`)).toEqual([a, b])',
    ],
  ])('leaves alone %s', (_, body) => {
    expect(found(body)).toEqual([])
  })

  // names by TypeScript's binder: another test's `rows` holds an ordered read
  it('follows a name by its symbol, not its spelling', () => {
    const source = `
      it('a', async () => {
        const rows = await db.select().from(t)
        expect(rows).toHaveLength(2)
      })
      it('b', async () => {
        const rows = await db.select().from(t).orderBy(t.id)
        expect(rows).toEqual([a, b])
      })
    `
    expect(lines(source)).toEqual([])
  })
})

describe('uuidColumns', () => {
  it('names the uuid columns of a table by the names the tests import', () => {
    const schema = `
      export const sessions = pgTable('sessions', {
        id: uuid('id').primaryKey(),
        actorId: uuid('actor_id').notNull().references(() => actors.id),
        name: varchar('device_name', { length: 64 }),
      })
      export const feedback = pgTable('feedback', {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
      })
    `
    expect([...uuidColumns(schema)]).toEqual(['sessions.id', 'sessions.actorId'])
  })

  it('finds the schema’s own: a session’s id is a uuid, a message’s an identity', () => {
    const uuids = uuidColumns(readFileSync('backend/src/db/schema.ts', 'utf8'))
    expect(uuids.has('sessions.id')).toBe(true)
    expect(uuids.has('feedback.id')).toBe(false)
  })
})

describe('MAY_READ', () => {
  it('spares the binder a file that reads nothing', () => {
    expect(MAY_READ.test('await db.insert(t).values(v)')).toBe(false)
    expect(MAY_READ.test('await db.select().from(t)')).toBe(true)
    expect(MAY_READ.test('await db.selectDistinct().from(t)')).toBe(true)
    expect(MAY_READ.test('await db.query.t.findMany()')).toBe(true)
    expect(MAY_READ.test('sql`SELECT 1`')).toBe(true)
  })
})
