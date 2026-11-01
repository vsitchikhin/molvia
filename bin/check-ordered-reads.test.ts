import { describe, expect, it } from 'vitest'
import { MAY_READ, unorderedReads } from './check-ordered-reads.mjs'

const lines = (source: string): number[] =>
  unorderedReads('a.integration.test.ts', source).map((found) => Number.parseInt(found))

const inTest = (body: string): string => `it('x', async () => {\n${body}\n})`

describe('unorderedReads', () => {
  // «то же фото дважды» as it failed on CI 41022785698, and the reads of the sweep of MOL-323
  it('finds a read with no order compared to an array written there, through a name or in place', () => {
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

  it.each([
    ['an index past 0', `const rows = await db.select().from(t)\nexpect(rows[1]?.id).toBe(a)`],
    [
      'an index from the end',
      `const rows = await db.select().from(t)\nexpect(rows.at(-1)).toBe(a)`,
    ],
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
      'a template handed to execute',
      'expect(await db.execute(sql`select id from t`)).toEqual([a, b])',
    ],
    [
      'a template on its own',
      'const rows = await sql`select id from t`\nexpect(rows).toEqual([a, b])',
    ],
    ['findMany with no orderBy', `expect(await db.query.t.findMany({ where })).toEqual([a, b])`],
    ['selectDistinct', `expect(await db.selectDistinct().from(t)).toEqual([a, b])`],
    ['a cast', `expect((await db.select().from(t)) as Row[]).toEqual([a, b])`],
  ])('finds %s', (_, body) => {
    expect(unorderedReads('a.integration.test.ts', inTest(body))).toHaveLength(1)
  })

  it('finds a function of the file that returns such a read, and one that returns a call of it', () => {
    const source = `
      const told = async () =>
        (await db.select({ payload: t.payload }).from(t)).map((row) => row.payload)
      async function steps() {
        return (await told()).map((n) => n.step)
      }
      it('x', async () => {
        expect(await told()).toEqual([a, b])
        expect(await steps()).toEqual([90, 100])
      })
    `
    expect(lines(source)).toEqual([8, 9])
  })

  it('names the line of the read and why', () => {
    const [found] = unorderedReads(
      'a.integration.test.ts',
      inTest(`const rows = await db\n  .select()\n  .from(t)\nexpect(rows).toEqual([a, b])`),
    )
    expect(found).toBe('2: const rows = await db — rows toEqual([2]) at 5')
  })

  it.each([
    ['orderBy', `expect(await db.select().from(t).orderBy(t.id)).toEqual([a, b])`],
    [
      'orderBy before where',
      `expect(await db.select().from(t).orderBy(t.id).where(c)).toEqual([a, b])`,
    ],
    [
      'order by in the template',
      'expect(await db.execute(sql`select id from t order by id`)).toEqual([a, b])',
    ],
    [
      'findMany with orderBy',
      `expect(await db.query.t.findMany({ orderBy: t.id })).toEqual([a, b])`,
    ],
    ['sort', `expect((await db.select().from(t)).map(f).sort()).toEqual([a, b])`],
    [
      'toSorted',
      `const rows = await db.select().from(t)\nexpect(rows.toSorted(by)).toEqual([a, b])`,
    ],
    ['a length', `expect(await db.select().from(t)).toHaveLength(2)`],
    ['no rows', `expect(await db.select().from(t)).toEqual([])`],
    ['one row', `expect(await db.select().from(t)).toEqual([a])`],
    ['the first row taken apart', `const [row] = await db.select().from(t)`],
    ['the first row by index', `const rows = await db.select().from(t)\nexpect(rows[0]).toBe(a)`],
    ['find', `expect((await db.select().from(t)).find(f)).toEqual([a, b])`],
    [
      'arrayContaining',
      `expect(await db.select().from(t)).toEqual(expect.arrayContaining([a, b]))`,
    ],
    ['not', `expect(await db.select().from(t)).not.toEqual([a, b])`],
    ['an insert returning', `expect(await db.insert(t).values(v).returning()).toEqual([a, b])`],
    [
      'a template that selects nothing',
      'expect(await db.execute(sql`delete from t`)).toEqual([a, b])',
    ],
  ])('leaves alone %s', (_, body) => {
    expect(unorderedReads('a.integration.test.ts', inTest(body))).toEqual([])
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

describe('MAY_READ', () => {
  it('spares the binder a file that reads nothing', () => {
    expect(MAY_READ.test('await db.insert(t).values(v)')).toBe(false)
    expect(MAY_READ.test('await db.select().from(t)')).toBe(true)
    expect(MAY_READ.test('await db.query.t.findMany()')).toBe(true)
    expect(MAY_READ.test('sql`SELECT 1`')).toBe(true)
  })
})
