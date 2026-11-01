import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chanceColumns, MAY_READ, unorderedReads } from './check-ordered-reads.mjs'

const FILE = 'a.integration.test.ts'
const CHANCE = new Set(['sessions.id', 't.createdAt', 'events.occurredAt'])

const lines = (source: string): number[] =>
  unorderedReads(FILE, source, CHANCE).map((found) => Number.parseInt(found))

const inTest = (body: string): string => `it('x', async () => {\n${body}\n})`
const found = (body: string): string[] => unorderedReads(FILE, inTest(body), CHANCE)

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
    // round 2, Б1: a use known orderless made to tell the order
    [
      'every by its index',
      `const rows = await db.select().from(t)\nexpect(rows.every((r, i) => r.x === want[i])).toBe(true)`,
    ],
    [
      'some by its index',
      `expect((await db.select().from(t)).some((r, i) => i === 3 && r.x)).toBe(true)`,
    ],
    [
      'map by its index',
      `expect((await db.select().from(t)).map((r, i) => r.x === want[i]).every(Boolean)).toBe(true)`,
    ],
    [
      'reduce by its index',
      `expect((await db.select().from(t)).reduce((all, r, i) => all + i * r.n, 0)).toBe(5)`,
    ],
    ['a spread against rows in place', `expect(await db.select().from(t)).toEqual([...want])`],
    // round 2, Б2: rows in the order of chance are as closed as rows with none
    [
      'chance joined',
      `const rows = await db.select().from(sessions).orderBy(sessions.id)\nexpect(rows.map(f).join(' / ')).toBe('a / b')`,
    ],
    [
      'chance by forEach',
      `const rows = await db.select().from(sessions).orderBy(sessions.id)\nrows.forEach((r, i) => expect(r).toBe(all[i]))`,
    ],
    [
      'chance by the last index',
      `const rows = await db.select().from(sessions).orderBy(sessions.id)\nexpect(rows[rows.length - 1]).toBe(a)`,
    ],
    [
      'chance reversed',
      `expect((await db.select().from(sessions).orderBy(sessions.id)).reverse()).toEqual(x)`,
    ],
    [
      'chance in an inline snapshot',
      `expect(await db.select().from(sessions).orderBy(sessions.id)).toMatchInlineSnapshot()`,
    ],
    [
      'chance against Array(n)',
      `expect((await db.select().from(sessions).orderBy(sessions.id)).map(f)).toEqual(Array(2).fill(a))`,
    ],
    [
      'chance against a string in place',
      `expect((await db.select().from(sessions).orderBy(sessions.id)).map(f).join()).toEqual('a,b')`,
    ],
    // round 2, Б3: chance is the schema's, never a name
    [
      'a moment of another name against rows in place',
      `expect(await db.select().from(events).orderBy(events.occurredAt)).toEqual([a, b])`,
    ],
    // round 2, Б4: the text of a template read once, from the start
    [
      "a '--' in a string, no order",
      "expect(await db.execute(sql`select id from t where x <> '--'`)).toEqual([a, b])",
    ],
    [
      'a statement wholly in parentheses',
      'expect(await db.execute(sql`(select id from t) union all (select id from u)`)).toEqual([a, b])',
    ],
    ['none against another read', `expect(await db.select().from(t)).toEqual(before)`],
    [
      'none on the other side of toEqual',
      `const rows = await db.select().from(t)\nexpect(before).toEqual(rows)`,
    ],
    // round 3, В1: a moment is chance whoever writes it
    [
      'a moment with an identity after it, against rows in place',
      `expect(await db.select().from(t).orderBy(t.createdAt, t.id)).toEqual([a, b])`,
    ],
    // round 3, В2: «another read» is a read of chance, never what the test builds
    [
      'chance against a constant',
      `const devices = ['a', 'b']\nexpect((await db.select().from(sessions).orderBy(sessions.id)).map(f)).toEqual(devices)`,
    ],
    [
      'chance against ids pushed as written',
      `const ids = []\nids.push(await signIn(a))\nexpect((await db.select().from(sessions).orderBy(sessions.id)).map(f)).toEqual(ids)`,
    ],
    [
      'chance against a literal mapped',
      `expect((await db.select().from(sessions).orderBy(sessions.id)).map(f)).toEqual([anna, boris].map(g))`,
    ],
    [
      'chance on the other side of a constant',
      `const devices = ['a', 'b']\nconst rows = await db.select().from(sessions).orderBy(sessions.id)\nexpect(devices).toEqual(rows.map(f))`,
    ],
    [
      'chance against a read in another order',
      `const rows = await db.select().from(sessions).orderBy(sessions.id)\nexpect(rows).toEqual(await db.select().from(sessions).orderBy(sessions.position))`,
    ],
    // round 3, В3: a column of chance decides the ties of those before it
    [
      'a kind broken by a uuid',
      `expect(await db.select().from(sessions).orderBy(sessions.kind, sessions.id)).toEqual([a, b])`,
    ],
    [
      'a kind broken by a uuid, asc and desc',
      `expect(await db.select().from(sessions).orderBy(asc(sessions.kind), desc(sessions.id))).toEqual([a, b])`,
    ],
    // round 3, В4: a callback by the index, named
    [
      'every by a named callback with the index',
      `const inOrder = (row, i) => row.text === want[i]\nexpect((await db.select().from(t)).every(inOrder)).toBe(true)`,
    ],
    [
      'some by a function with the index',
      `function lastIsB(row, i) {\nreturn i === 1 && row.b\n}\nexpect((await db.select().from(t)).some(lastIsB)).toBe(true)`,
    ],
  ])('refuses %s', (_, body) => {
    expect(found(body)).toHaveLength(1)
  })

  // round 2, №7: a helper whose order is learnt as none late, after a pass read it as chance
  it('reads again a helper whose order changes from chance to none', () => {
    const source = `
      const x = async () => db.select().from(t)
      const h = async (k: boolean) => (k ? db.select().from(t).orderBy(t.createdAt) : x())
      it('x', async () => {
        expect(await h(false)).toEqual(want)
      })
    `
    expect(lines(source)).toEqual([5])
  })

  // a snapshot with a snapshot: the order of chance is one order of the same rows, an object of them followed
  it('lets a snapshot of rows in the order of chance meet another, and no snapshot of rows with none', () => {
    const source = `
      async function snapshot(id: string) {
        return {
          sessions: await db.select().from(sessions).where(eq(sessions.actorId, id)).orderBy(sessions.id),
        }
      }
      async function loose(id: string) {
        return { sessions: await db.select().from(sessions).where(eq(sessions.actorId, id)) }
      }
      it('x', async () => {
        const before = await snapshot(me)
        expect(await snapshot(me)).toEqual(before)
        expect(await loose(me)).toEqual(await loose(me))
        expect(await snapshot(me)).toEqual({ sessions: [a, b] })
      })
    `
    expect(lines(source)).toEqual([13, 14])
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
      'a position broken by an identity',
      `expect(await db.select().from(t).orderBy(t.position, t.id)).toEqual([a, b])`,
    ],
    [
      'a uuid against another read of chance',
      `const before = await db.select().from(sessions).orderBy(sessions.id)\nexpect(await db.select().from(sessions).orderBy(sessions.id)).toEqual(before)`,
    ],
    [
      "a '--' in a string, then an order",
      "expect(await db.execute(sql`select id from t where x <> '--' order by id`)).toEqual([a, b])",
    ],
    [
      'every by the row alone',
      `expect((await db.select().from(t)).every((r) => r.n > 0)).toBe(true)`,
    ],
    [
      'every by a named callback of the row alone',
      `const positive = (r) => r.n > 0\nexpect((await db.select().from(t)).every(positive)).toBe(true)`,
    ],
    [
      'sort by a comparator',
      `expect((await db.select().from(t)).toSorted((a, b) => a.id - b.id)).toEqual([a, b])`,
    ],
    [
      'find by a key',
      `const rows = await db.select().from(t)\nexpect(rows.find((r) => r.id === a)?.n).toBe(1)`,
    ],
    ['a Map by its key', `const byId = new Map((await db.select().from(t)).map((r) => [r.id, r]))`],
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

describe('chanceColumns', () => {
  it('names the columns of chance by the names the tests import: a uuid, a moment whoever writes it', () => {
    const schema = `
      export const sessions = pgTable('sessions', {
        id: uuid('id').primaryKey(),
        actorId: uuid('actor_id').notNull().references(() => actors.id),
        name: varchar('device_name', { length: 64 }),
        seenAt: timestamp('seen_at').notNull().defaultNow(),
        createdAt: timestamp('created_at').notNull().default(sql\`clock_timestamp()\`),
        day: date('day').notNull().default(sql\`current_date\`),
        expiresAt: timestamp('expires_at').notNull(),
      })
      export const feedback = pgTable('feedback', {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
      })
    `
    expect([...chanceColumns(schema)]).toEqual([
      'sessions.id',
      'sessions.actorId',
      'sessions.seenAt',
      'sessions.createdAt',
      'sessions.expiresAt',
    ])
  })

  it('finds the schema’s own: a session’s id and a message’s moment are chance, a message’s id is not', () => {
    const chance = chanceColumns(readFileSync('backend/src/db/schema.ts', 'utf8'))
    expect(chance.has('sessions.id')).toBe(true)
    expect(chance.has('events.occurredAt')).toBe(true)
    expect(chance.has('feedback.createdAt')).toBe(true)
    // round 3, В1: a moment the repository writes, one for a whole batch (`failures-repository`)
    expect(chance.has('ownerNotices.createdAt')).toBe(true)
    expect(chance.has('feedback.id')).toBe(false)
    expect(chance.has('receiptLines.position')).toBe(false)
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
