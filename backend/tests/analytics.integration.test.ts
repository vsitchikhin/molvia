/**
 * «Учитывать меня в статистике» (MOL-96): off erases the person's log and stops it, back on starts
 * it afresh; the moments gate 0.3 reads are kept on the row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { EVENT, analyticsSettingSchema } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createEventRepository } from '@/db/events-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { actors, events, verdicts } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const log = createEventRepository(db)
const verdictRepository = createVerdictRepository(db)
let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})
beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

async function owner() {
  const id = await insertActor(db)
  await db
    .update(actors)
    .set({ sharedUntil: sql`now() + interval '30 days'` })
    .where(eq(actors.id, id))
  return { id, cookie: await signIn(db, id) }
}

type Owner = Awaited<ReturnType<typeof owner>>

async function choose(me: Owner, on: boolean) {
  const reply = await app.inject({
    method: 'PUT',
    url: '/actors/me/analytics',
    headers: { cookie: me.cookie },
    payload: { on },
  })
  expect(reply.statusCode).toBe(200)
  expect(reply.headers['cache-control']).toBe('no-store')
  return analyticsSettingSchema.parse(reply.json())
}

async function setting(me: Owner) {
  const reply = await app.inject({
    method: 'GET',
    url: '/actors/me/analytics',
    headers: { cookie: me.cookie },
  })
  expect(reply.statusCode).toBe(200)
  expect(reply.headers['cache-control']).toBe('no-store')
  return analyticsSettingSchema.parse(reply.json())
}

async function moments(id: string) {
  const [row] = await db
    .select({ offAt: actors.analyticsOffAt, onAt: actors.analyticsOnAt })
    .from(actors)
    .where(eq(actors.id, id))
  return row
}

async function rowsOf(id: string) {
  return db.select().from(events).where(eq(events.actorId, id))
}

async function rate(me: Owner, itemId: string) {
  const reply = await app.inject({
    method: 'PUT',
    url: `/verdicts/${itemId}`,
    headers: { cookie: me.cookie },
    payload: { score: 2, review: 'Пахнет крахмалом' },
  })
  expect([200, 201]).toContain(reply.statusCode)
}

async function withdraw(me: Owner, itemId: string) {
  const reply = await app.inject({
    method: 'DELETE',
    url: `/verdicts/${itemId}`,
    headers: { cookie: me.cookie },
  })
  expect(reply.statusCode).toBe(204)
}

async function verdictsOf(id: string) {
  const rows = await db
    .select({ itemId: verdicts.itemId, deletedAt: verdicts.deletedAt })
    .from(verdicts)
    .where(eq(verdicts.actorId, id))
  return rows.map((row) => ({ itemId: row.itemId, withdrawn: row.deletedAt !== null }))
}

async function openAdvice(me: Owner) {
  const reply = await app.inject({ method: 'GET', url: '/advice', headers: { cookie: me.cookie } })
  expect(reply.statusCode).toBe(200)
}

describe('дверь', () => {
  it('без личности — 401, и ничего не пишет', async () => {
    const someone = await owner()
    for (const method of ['GET', 'PUT'] as const) {
      const reply = await app.inject({
        method,
        url: '/actors/me/analytics',
        ...(method === 'PUT' ? { payload: { on: false } } : {}),
      })
      expect(reply.statusCode).toBe(401)
    }
    expect(await moments(someone.id)).toEqual({ offAt: null, onAt: null })
  })

  it('тело не по контракту — 400, и ничего не меняется', async () => {
    const me = await owner()
    await openAdvice(me)
    for (const payload of [{ on: 'no' }, { on: false, off: true }, {}]) {
      const reply = await app.inject({
        method: 'PUT',
        url: '/actors/me/analytics',
        headers: { cookie: me.cookie },
        payload,
      })
      expect(reply.statusCode).toBe(400)
    }
    expect(await moments(me.id)).toEqual({ offAt: null, onAt: null })
    expect(await rowsOf(me.id)).toHaveLength(1)
  })
})

describe('выключение', () => {
  it('включено, пока человек не возразил', async () => {
    const me = await owner()
    expect(await setting(me)).toEqual({ off: false })
  })

  it('стирает весь журнал человека, старые виды событий тоже, и только его (В-1)', async () => {
    const me = await owner()
    const other = await owner()
    await openAdvice(me)
    await openAdvice(other)
    await log.record({ actorId: me.id, type: EVENT.SESSION_STARTED })
    await log.record({
      actorId: me.id,
      type: EVENT.CATALOGUE_VIEWED,
      payload: { subject: 'venue' },
    })
    expect(await rowsOf(me.id)).toHaveLength(3)

    expect(await choose(me, false)).toEqual({ off: true })
    expect(await setting(me)).toEqual({ off: true })
    expect(await rowsOf(me.id)).toHaveLength(0)
    expect(await rowsOf(other.id)).toHaveLength(1)
    expect((await moments(me.id))?.offAt).toBeInstanceOf(Date)
  })

  it('выключенному «Что брать» с доступом не пишет ни строки', async () => {
    const me = await owner()
    await choose(me, false)
    await openAdvice(me)
    expect(await rowsOf(me.id)).toHaveLength(0)
    expect(
      await log.recordOncePerDay({
        actorId: me.id,
        type: EVENT.ADVICE_VIEWED,
        payload: { subject: 'product' },
      }),
    ).toBe(false)
  })

  it('повторное «выключить» не двигает момент возражения', async () => {
    const me = await owner()
    await choose(me, false)
    const first = await moments(me.id)
    await choose(me, false)
    expect(await moments(me.id)).toEqual(first)
  })

  it('пишущий визит и выключение не оставляют строки, в каком бы порядке ни пришли', async () => {
    for (let round = 0; round < 10; round += 1) {
      const me = await owner()
      await Promise.all([
        log.recordOncePerDay({
          actorId: me.id,
          type: EVENT.ADVICE_VIEWED,
          payload: { subject: 'product' },
        }),
        log.chooseAnalytics(me.id, true),
      ])
      expect(await rowsOf(me.id)).toHaveLength(0)
    }
  })
})

describe('снятые оценки (MOL-97, В1)', () => {
  // A withdrawn verdict has a second reader besides gate 0.2: the reminder skips a purchase made
  // before the withdrawal (MOL-101). Off stops the gate's counting, which reads the objection as it
  // stands; the row stays for the reminder, on the contract.
  it('выключение снятые оценки не стирает — их читает напоминание', async () => {
    const me = await owner()
    const milk = await insertItem(db)
    const bread = await insertItem(db, { name: 'Хлеб', searchKey: 'hleb', defaultUnit: 'piece' })
    await rate(me, milk)
    await rate(me, bread)
    await withdraw(me, milk)

    await choose(me, false)
    expect(await verdictsOf(me.id)).toEqual(
      expect.arrayContaining([
        { itemId: milk, withdrawn: true },
        { itemId: bread, withdrawn: false },
      ]),
    )
  })

  it('снятие у выключенного оставляет строку, как у включённого', async () => {
    const me = await owner()
    const milk = await insertItem(db)
    await choose(me, false)
    await rate(me, milk)
    expect(await verdictRepository.withdraw(me.id, milk)).toBe(true)
    expect(await verdictsOf(me.id)).toEqual([{ itemId: milk, withdrawn: true }])
  })
})

describe('стирание', () => {
  it('выключение и «Удалить мои данные» разом не встают в замок и не оставляют строк (ревью 1, №2)', async () => {
    // Erasure never takes the log's lock, and the switch holds nothing erasure needs while it
    // waits for the row: no cycle. Held by a test, should erasure ever take that lock.
    for (let round = 0; round < 20; round += 1) {
      const me = await owner()
      await openAdvice(me)
      const [off, erase] = await Promise.all([
        app.inject({
          method: 'PUT',
          url: '/actors/me/analytics',
          headers: { cookie: me.cookie },
          payload: { on: false },
        }),
        app.inject({ method: 'DELETE', url: '/actors/me', headers: { cookie: me.cookie } }),
      ])
      expect([200, 401]).toContain(off.statusCode)
      expect(erase.statusCode).toBe(204)
      expect(await rowsOf(me.id)).toHaveLength(0)
      expect(await moments(me.id)).toBeUndefined()
    }
  })
})

describe('включение обратно', () => {
  it('журнал начинается заново, а момент включения записан (Р-3)', async () => {
    const me = await owner()
    await choose(me, false)
    expect(await choose(me, true)).toEqual({ off: false })
    const after = await moments(me.id)
    expect(after?.offAt).toBeNull()
    expect(after?.onAt).toBeInstanceOf(Date)
    await openAdvice(me)
    expect(await rowsOf(me.id)).toHaveLength(1)
  })

  it('после «выкл → вкл → выкл» момент возражения — последний: истории нет (ревью 1, №1, А3)', async () => {
    const me = await owner()
    await choose(me, false)
    await choose(me, true)
    await choose(me, false)
    const now = await moments(me.id)
    expect(now?.offAt).toBeInstanceOf(Date)
    expect(now?.onAt).toBeInstanceOf(Date)
    expect(now?.offAt?.getTime()).toBeGreaterThanOrEqual(now?.onAt?.getTime() ?? Infinity)
  })

  it('«включить» у того, кто не выключал, не ставит момента включения', async () => {
    const me = await owner()
    await choose(me, true)
    expect(await moments(me.id)).toEqual({ offAt: null, onAt: null })
  })

  it('повторное «включить» не двигает момент включения', async () => {
    const me = await owner()
    await choose(me, false)
    await choose(me, true)
    const first = await moments(me.id)
    await choose(me, true)
    expect(await moments(me.id)).toEqual(first)
  })
})
