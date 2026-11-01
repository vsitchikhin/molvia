import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  chanceColumns,
  identityColumns,
  MAY_READ,
  uniqueKeys,
  unorderedReads,
} from './check-ordered-reads.mjs'

const FILE = 'a.integration.test.ts'
const CHANCE = new Set([
  'sessions.id',
  'sessions.expiresAt',
  't.createdAt',
  'events.occurredAt',
  'ownerNotices.createdAt',
  'verdicts.id',
])
const IDENTITY = new Set(['t.id', 'ownerNotices.id'])
const KEYS = [['sessions.id'], ['verdicts.id'], ['t.id'], ['ownerNotices.id']]

const lines = (source: string): number[] =>
  unorderedReads(FILE, source, CHANCE, IDENTITY, KEYS).map((found) => Number.parseInt(found))

const inTest = (body: string): string => `it('x', async () => {\n${body}\n})`
const found = (body: string): string[] => unorderedReads(FILE, inTest(body), CHANCE, IDENTITY, KEYS)

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
      `const rows = await db.select().from(t)\nexpect(rows.filter((r) => r.ok)).toEqual([a, b])`,
    ],
    [
      'through slice and map',
      `expect((await db.select().from(t)).slice(1).map((r) => r.x)).toEqual([a, b])`,
    ],
    [
      'named twice',
      `const rows = await db.select().from(t)\nconst texts = rows.map((r) => r.x)\nexpect(texts).toEqual([a, b])`,
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
    ['joined', `expect((await db.select().from(t)).map((r) => r.x).join()).toBe('a,b')`],
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
      `expect((await db.select().from(t)).map((r, i) => r.x === want[i]).every((ok) => ok)).toBe(true)`,
    ],
    [
      'reduce by its index',
      `expect((await db.select().from(t)).reduce((all, r, i) => all + i * r.n, 0)).toBe(5)`,
    ],
    ['a spread against rows in place', `expect(await db.select().from(t)).toEqual([...want])`],
    // round 2, Б2: rows in the order of chance are as closed as rows with none
    [
      'chance joined',
      `const rows = await db.select().from(sessions).orderBy(sessions.id)\nexpect(rows.map((r) => r.x).join(' / ')).toBe('a / b')`,
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
      `expect((await db.select().from(sessions).orderBy(sessions.id)).map((r) => r.x)).toEqual(Array(2).fill(a))`,
    ],
    [
      'chance against a string in place',
      `expect((await db.select().from(sessions).orderBy(sessions.id)).map((r) => r.x).join()).toEqual('a,b')`,
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
      `const devices = ['a', 'b']\nexpect((await db.select().from(sessions).orderBy(sessions.id)).map((r) => r.x)).toEqual(devices)`,
    ],
    [
      'chance against ids pushed as written',
      `const ids = []\nids.push(await signIn(a))\nexpect((await db.select().from(sessions).orderBy(sessions.id)).map((r) => r.x)).toEqual(ids)`,
    ],
    [
      'chance against a literal mapped',
      `expect((await db.select().from(sessions).orderBy(sessions.id)).map((r) => r.x)).toEqual([anna, boris].map((one) => one.id))`,
    ],
    [
      'chance on the other side of a constant',
      `const devices = ['a', 'b']\nconst rows = await db.select().from(sessions).orderBy(sessions.id)\nexpect(devices).toEqual(rows.map((r) => r.x))`,
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
    // round 4, Г3: what decides is the moment before the identity — order by the identity alone
    [
      'a moment before an identity, desc',
      `expect(await db.select().from(t).orderBy(desc(t.createdAt), desc(t.id))).toEqual([a, b])`,
    ],
    // round 4, Г4: a callback the parse cannot read is in doubt
    [
      'every by a callback a helper builds',
      `const matchesIn = (texts) => (row, i) => row.text === texts[i]\nexpect((await db.select().from(t)).every(matchesIn(['a', 'b']))).toBe(true)`,
    ],
    [
      'every by a method of an object',
      `const check = { inOrder: (row, i) => row.x === i }\nexpect((await db.select().from(t)).every(check.inOrder)).toBe(true)`,
    ],
    [
      'map by an imported function',
      `expect((await db.select().from(t)).map(toId)).toEqual([a, b])`,
    ],
    // round 5, Д1: through a join a parent's identity repeats, and the moment after it decides
    [
      'a parent identity then a child moment, by a join',
      `expect(await db.select().from(feedback).innerJoin(ownerNotices, on).orderBy(t.id, ownerNotices.createdAt)).toEqual([a, b])`,
    ],
    [
      'the same, joined the other way, asc',
      `expect(await db.select().from(ownerNotices).leftJoin(t, on).orderBy(asc(t.id), asc(ownerNotices.createdAt))).toEqual([a, b])`,
    ],
    // round 5, Д2: not turns a comparison over, never into one the order cannot tell
    ['not.toEqual', `expect(await db.select().from(t)).not.toEqual([a, b])`],
    ['soft not.toStrictEqual', `expect.soft(await db.select().from(t)).not.toStrictEqual([a, b])`],
    [
      'not.toEqual on the other side',
      `const rows = await db.select().from(t)\nexpect([a, b]).not.toEqual(rows)`,
    ],
    // round 5, Д3: an index without a parameter for it
    [
      'every by a count kept outside',
      `let i = 0\nexpect((await db.select().from(t)).every((r) => r.text === texts[i++])).toBe(true)`,
    ],
    [
      'find by a count kept outside',
      `let n = 0\nexpect((await db.select().from(t)).find(() => n++ === 1)).toEqual(a)`,
    ],
    [
      'every by the rest of its arguments',
      `expect((await db.select().from(t)).every((...args) => args[0].text === want[args[1]])).toBe(true)`,
    ],
    [
      'map(parseInt) — it takes the index',
      `expect((await db.select().from(t)).map((r) => r.n).map(parseInt)).toEqual([1, 2])`,
    ],
    // round 6, №15: a lateral join is a join
    [
      'a parent identity then a child moment, by a lateral join',
      `expect(await db.select().from(feedback).innerJoinLateral(sub, on).orderBy(t.id, ownerNotices.createdAt)).toEqual([a, b])`,
    ],
    // round 6, Е1, №16: a callback that takes the order outside, by a call, a field or an iterator
    [
      'every pushing outside',
      `const seen = []\nexpect((await db.select().from(t)).every((r) => seen.push(r.text) > 0)).toBe(true)`,
    ],
    [
      'some pushing outside in a block',
      `const out = []\n;(await db.select().from(t)).some((r) => {\nout.push(r.text)\n})`,
    ],
    [
      'map pushing outside, its answer a length',
      `const out = []\nexpect((await db.select().from(t)).map((r) => out.push(r.text))).toHaveLength(2)`,
    ],
    [
      'every by a count in a field',
      `const at = { i: 0 }\nexpect((await db.select().from(t)).every((r) => r.text === texts[at.i++])).toBe(true)`,
    ],
    [
      'every by an iterator',
      `const next = want.values()\nexpect((await db.select().from(t)).every((r) => r.text === next.next().value)).toBe(true)`,
    ],
    [
      'every handing an outside name to a call',
      `const out = {}\nexpect((await db.select().from(t)).every((r) => Object.assign(out, { [r.k]: r.v }))).toBe(true)`,
    ],
    // round 6, Е2: not frees only a matcher free without it
    [
      'not.toHaveProperty by an index',
      `expect(await db.select().from(t)).not.toHaveProperty('1.text', 'a')`,
    ],
    [
      'not.toSatisfy',
      `expect(await db.select().from(t)).not.toSatisfy((all) => all[0]?.text === 'b')`,
    ],
    [
      'not.toMatch of the rows stringified',
      `expect(JSON.stringify(await db.select().from(t))).not.toMatch(/a.*b/)`,
    ],
    // round 7, Ж1: a callback calling a function of this file from outside, which may change what it likes
    [
      'every handing rows to a spy',
      `const spy = vi.fn()\nexpect((await db.select().from(t)).every((r) => spy(r.text))).toBe(true)`,
    ],
    [
      'every handing rows to a function that records',
      `const seen = []\nconst record = (text) => seen.push(text)\nexpect((await db.select().from(t)).every((r) => record(r.text))).toBe(true)`,
    ],
    [
      'every drawing from a function of the file',
      `function nextText() {\nreturn want.shift()\n}\nexpect((await db.select().from(t)).every((r) => r.text === nextText())).toBe(true)`,
    ],
    // round 7, Ж2: toContain of the rows made one string reads them in place
    [
      'toContain of the rows stringified',
      `expect(JSON.stringify((await db.select().from(t)).map((r) => ({ text: r.text })))).toContain('{"text":"a"},{"text":"b"}')`,
    ],
    [
      'not.toContain of the rows stringified',
      `expect(JSON.stringify([...(await db.select().from(t))])).not.toContain(secret)`,
    ],
    // round 8, З3: a method of the rows made one string reads them in place
    [
      'includes of the rows stringified',
      `expect(JSON.stringify(await db.select().from(t)).includes('{"text":"a"},{"text":"b"}')).toBe(true)`,
    ],
    [
      'indexOf of the rows stringified',
      `expect(JSON.stringify(await db.select().from(t)).indexOf('b') > JSON.stringify(x).indexOf('a')).toBe(true)`,
    ],
    // round 9, И1: columns of an order given by a name, spread from an array, a constant of asc
    [
      'an order by a name of a moment',
      `const by = ownerNotices.createdAt\nexpect(await db.select().from(ownerNotices).orderBy(by)).toEqual([a, b])`,
    ],
    [
      'an order spread from an array',
      `const order = [ownerNotices.createdAt] as const\nexpect(await db.select().from(ownerNotices).orderBy(...order)).toEqual([a, b])`,
    ],
    [
      'an order by a constant of asc',
      `const OLDEST = asc(ownerNotices.createdAt)\nexpect(await db.select().from(ownerNotices).orderBy(OLDEST)).toEqual([a, b])`,
    ],
    // round 9, И2: what the parse cannot read is no order
    [
      'an order by a fragment of sql',
      'expect(await db.select().from(t).orderBy(sql`${t.id} desc`)).toEqual([a, b])',
    ],
    [
      'an order by a call',
      `expect(await db.select().from(t).orderBy(byNewest(t))).toEqual([a, b])`,
    ],
    [
      'an order by a let',
      `let by = t.id\nexpect(await db.select().from(t).orderBy(by)).toEqual([a, b])`,
    ],
    // round 9: a query begun in a const, or its sql
    [
      'a query begun in a const, carried on',
      `const base = db.select().from(t)\nexpect(await base.where(c)).toEqual([a, b])`,
    ],
    [
      'sql in a const handed to execute',
      'const q = sql`select id from t`\nexpect(await db.execute(q)).toEqual([a, b])',
    ],
    // after round 9: every place the parse recognises a read, closed — what it cannot read is a read with no order
    ['execute of a text built by a call', `expect(await db.execute(queryOf(t))).toEqual([a, b])`],
    [
      'execute of sql.raw with no order',
      'expect(await db.execute(sql.raw(`select id from t`))).toEqual([a, b])',
    ],
    [
      'a template handed to a helper that executes it',
      'const read = (q) => db.execute(q)\nexpect(await read(sql`select id from t`)).toEqual([a, b])',
    ],
    [
      'a query carried on from a helper',
      `const rows = () => db.select().from(t)\nexpect(await rows().where(c)).toEqual([a, b])`,
    ],
    ['unsafe SQL as a string', `expect(await sql.unsafe('select id from t')).toEqual([a, b])`],
  ])('refuses %s', (_, body) => {
    expect(found(body)).toHaveLength(1)
  })

  // round 4, Г1: another read of chance in another order is no snapshot of the same — each side refused
  it('refuses rows of chance against another order of chance, by name and in place', () => {
    expect(
      found(
        `const byId = await db.select().from(sessions).orderBy(sessions.id)\nconst byExpiry = await db.select().from(sessions).orderBy(sessions.expiresAt)\nexpect(byId).toEqual(byExpiry)`,
      ),
    ).toHaveLength(2)
    expect(
      found(
        `expect(await db.select().from(sessions).orderBy(sessions.id)).toEqual(await db.select().from(sessions).orderBy(sessions.expiresAt))`,
      ),
    ).toHaveLength(2)
  })

  // round 7, Ж3: an order of chance with ties is two orders — a snapshot meets a snapshot only by a total one
  it('refuses a snapshot by a moment with ties, and lets one by a unique key meet itself', () => {
    expect(
      found(
        `const before = await db.select().from(ownerNotices).orderBy(ownerNotices.createdAt)\nconst after = await db.select().from(ownerNotices).orderBy(ownerNotices.createdAt)\nexpect(after).toEqual(before)`,
      ),
    ).toHaveLength(2)
    expect(
      found(
        `const before = await db.select().from(sessions).orderBy(sessions.id)\nconst after = await db.select().from(sessions).orderBy(sessions.id)\nexpect(after).toEqual(before)`,
      ),
    ).toEqual([])
  })

  // round 8, З2: a key of one table read through a join is no key — every table's is needed
  it('refuses a snapshot through a join by one table’s key, and lets one by every table’s meet itself', () => {
    expect(
      found(
        `const read = () => db.select().from(t).innerJoin(ownerNotices, on).orderBy(ownerNotices.createdAt, t.id)\nconst before = await read()\nexpect(await read()).toEqual(before)`,
      ),
    ).not.toEqual([])
    expect(
      found(
        `const read = () => db.select().from(t).innerJoin(sessions, on).orderBy(t.id, sessions.id)\nconst before = await read()\nexpect(await read()).toEqual(before)`,
      ),
    ).toEqual([])
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
          verdicts: await db.select().from(verdicts).where(eq(verdicts.actorId, id)).orderBy(verdicts.id),
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
    expect(lines(source)).toEqual([14, 15])
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
    ['sort', `expect((await db.select().from(t)).map((r) => r.x).sort()).toEqual([a, b])`],
    [
      'toSorted through a name',
      `const rows = await db.select().from(t)\nexpect(rows.map((r) => r.x).toSorted()).toEqual([a, b])`,
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
    ['find', `expect((await db.select().from(t)).find((r) => r.id === a)).toEqual([a, b])`],
    ['some', `expect((await db.select().from(t)).some((r) => r.ok)).toBe(true)`],
    ['a sum', `expect((await db.select().from(t)).reduce((all, r) => all + r.n, 0)).toBe(3)`],
    ['a loop', `for (const row of await db.select().from(t)) expect(row.n).toBe(1)`],
    ['a Set', `expect(new Set((await db.select().from(t)).map((r) => r.x)).size).toBe(1)`],
    [
      'notInArray',
      `const ids = (await db.select().from(t)).map((r) => r.x)\nwhere(notInArray(t.id, ids.length > 0 ? ids : [x]))`,
    ],
    [
      'arrayContaining',
      `expect(await db.select().from(t)).toEqual(expect.arrayContaining([a, b]))`,
    ],
    ['toContainEqual', `expect(await db.select().from(t)).toContainEqual(a)`],
    ['not containing', `expect(await db.select().from(t)).not.toContainEqual(a)`],
    ['not of a length', `expect(await db.select().from(t)).not.toHaveLength(0)`],
    // round 5, №14: the platform's casts take their first argument alone
    [
      'filter(Boolean) before a length',
      `expect((await db.select().from(t)).filter(Boolean)).toHaveLength(2)`,
    ],
    [
      'map(String) into a Set',
      `expect(new Set((await db.select().from(t)).map(String)).size).toBe(2)`,
    ],
    // round 5, Д3: a name of the callback's own is no count kept outside
    [
      'every with a count of its own',
      `expect((await db.select().from(t)).every((r) => {\nlet n = 0\nn += r.k\nreturn n > 0\n})).toBe(true)`,
    ],
    // round 5, Д1: an identity of the read's own table, no join
    [
      'an identity before a moment, no join',
      `expect(await db.select().from(t).orderBy(t.id, t.createdAt)).toEqual([a, b])`,
    ],
    [
      'stringified row by row, not containing',
      `for (const row of await db.select().from(t)) expect(JSON.stringify(row)).not.toContain(secret)`,
    ],
    // round 7, Ж1: a function handed in as a parameter is not followed — the price
    [
      'a sum by a function handed in',
      `const rows = await db.select().from(t)\nconst sum = (pick) => rows.reduce((all, row) => all + pick(row), 0)`,
    ],
    [
      'a schema of another file parsing each row',
      `expect((await db.select().from(t)).map((r) => schema.parse(r))).toHaveLength(2)`,
    ],
    ['a type of it', `const rows = await db.select().from(t)\ntype Row = (typeof rows)[number]`],
    ['discarded', `await db.select().from(t)`],
    ['an insert returning', `expect(await db.insert(t).values(v).returning()).toEqual([a, b])`],
    [
      'a template that selects nothing',
      'expect(await db.execute(sql`delete from t`)).toEqual([a, b])',
    ],
    // round 4, Г1, Г2: a snapshot in the same order, by name, in place or through map
    [
      'chance against the same order of chance',
      `const before = await db.select().from(sessions).orderBy(sessions.id)\nconst after = await db.select().from(sessions).orderBy(sessions.id)\nexpect(after).toEqual(before)`,
    ],
    [
      'chance mapped against the same mapped',
      `const before = await db.select().from(sessions).orderBy(sessions.id)\nconst after = await db.select().from(sessions).orderBy(sessions.id)\nexpect(after.map((r) => r.seenAt)).toEqual(before.map((r) => r.seenAt))`,
    ],
    [
      'chance against the same mapped',
      `const before = await db.select().from(sessions).orderBy(sessions.id)\nexpect((await db.select().from(sessions).orderBy(sessions.id)).map((r) => r.x)).toEqual(before.map((r) => r.x))`,
    ],
    // round 4, №11: what follows an identity decides nothing
    [
      'an identity before a moment',
      `expect(await db.select().from(ownerNotices).orderBy(ownerNotices.id, ownerNotices.createdAt)).toEqual([a, b])`,
    ],
    [
      'an identity before a uuid',
      `expect(await db.select().from(t).orderBy(t.id, sessions.id)).toEqual([a, b])`,
    ],
    // round 9: the same orders the parse can read
    [
      'an order by a name of an identity',
      `const by = t.id\nexpect(await db.select().from(t).orderBy(by)).toEqual([a, b])`,
    ],
    [
      'an order spread from an array of an identity',
      `const order = [desc(t.id)] as const\nexpect(await db.select().from(t).orderBy(...order)).toEqual([a, b])`,
    ],
    [
      'a query begun in a const and ordered after',
      `const base = db.select().from(t)\nexpect(await base.where(c).orderBy(t.id)).toEqual([a, b])`,
    ],
    [
      'sql in a const with its order',
      'const q = sql`select id from t order by id`\nexpect(await db.execute(q)).toEqual([a, b])',
    ],
    [
      'execute of sql.raw that updates',
      "await expect(db.execute(sql.raw(`update t set x = 1 where id = '${id}'`))).rejects.toThrow()",
    ],
    [
      'a template handed to a helper, with its order',
      'const read = (q) => db.execute(q)\nexpect(await read(sql`select id from t order by id`)).toEqual([a, b])',
    ],
    [
      'a query carried on from a helper, ordered',
      `const rows = () => db.select().from(t)\nexpect(await rows().where(c).orderBy(t.id)).toEqual([a, b])`,
    ],
    [
      'unsafe SQL with its order',
      `expect(await sql.unsafe('select id from t order by id')).toEqual([a, b])`,
    ],
    ['a refused promise', `await expect(db.select().from(t)).rejects.toThrow()`],
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

describe('identityColumns', () => {
  it('names the identities of the schema: a message’s id, never a session’s uuid', () => {
    const schema = readFileSync('backend/src/db/schema.ts', 'utf8')
    const identity = identityColumns(schema)
    expect(identity.has('feedback.id')).toBe(true)
    expect(identity.has('ownerNotices.id')).toBe(true)
    expect(identity.has('sessions.id')).toBe(false)
    expect([...identity].every((column) => !chanceColumns(schema).has(column))).toBe(true)
  })
})

describe('uniqueKeys', () => {
  it('names the unique keys of the schema: a column’s, a table’s, never a unique index with a where', () => {
    const schema = `
      export const sessions = pgTable('sessions', {
        id: uuid('id').primaryKey(),
        token: char('token', { length: 64 }).notNull().unique(),
        actorId: uuid('actor_id').notNull(),
      })
      export const picks = pgTable(
        'picks',
        { actorId: uuid('actor_id'), key: text('key'), itemId: uuid('item_id') },
        (table) => [
          primaryKey({ columns: [table.actorId, table.key, table.itemId] }),
          unique('picks_key').on(table.key, table.itemId).nullsNotDistinct(),
          uniqueIndex('picks_live').on(table.itemId).where(sql\`true\`),
          // round 8, №17: an expression in a key, and NULLs that are distinct, make no key
          uniqueIndex('picks_identity').on(table.key, identityOf(table.itemId)),
          unique('picks_open').on(table.key, table.itemId),
        ],
      )
    `
    expect(uniqueKeys(schema)).toEqual([
      ['sessions.id'],
      ['sessions.token'],
      ['picks.actorId', 'picks.key', 'picks.itemId'],
      ['picks.key', 'picks.itemId'],
    ])
  })

  it('finds the schema’s own: a search pick’s key and a budget plan’s', () => {
    const keys = uniqueKeys(readFileSync('backend/src/db/schema.ts', 'utf8')).map((key) =>
      key.join(),
    )
    expect(keys).toContain('searchPicks.actorId,searchPicks.queryKey,searchPicks.itemId')
    expect(keys).toContain('budgetPlans.actorId,budgetPlans.categoryId,budgetPlans.fromMonth')
    expect(keys).toContain('sessions.id')
    // round 8: an expression shortened no key, and a NULL of a key is distinct
    expect(keys).not.toContain('places.kind,places.country')
    expect(keys).not.toContain('spendings.transferId')
    expect(keys).not.toContain(
      'storeMemory.tin,storeMemory.kind,storeMemory.key,storeMemory.actorId',
    )
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
