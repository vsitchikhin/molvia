import { randomUUID } from 'node:crypto'
/**
 * The verdict, through the server rather than around it (MOL-27): the hook, the path and body
 * seams, the use cases, the central error handler and the wire contract all take part. The
 * numbers in the test names are the corners of the requirements, `requirements/MOL-27.md` §6.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ERROR, ISSUE, verdictCardCodec } from '@molvia/model'
import type { VerdictCard } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { events, verdicts } from '@/db/schema'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createTripRepository } from '@/db/trips-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { buildServer } from '@/server'
import { connect, connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const trips = createTripRepository(db)
const expenses = createExpenseRepository(db)
// The test pool holds one connection, and the server under test uses it: a withdrawal left
// open on it would queue the server rather than lock a row. The watcher sees who waits.
const withdrawing = connectDrizzle()
const watcher = connect()

const UNKNOWN_ID = '11111111-1111-4111-8111-111111111111'

let app: FastifyInstance

beforeAll(async () => {
  // Pointed at the test database: otherwise the server writes into the one entered by hand.
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
  await withdrawing.close()
  await watcher.end()
})

interface Reply {
  readonly status: number
  readonly raw: string
  readonly body: unknown
  readonly headers: Record<string, unknown>
}

async function call(
  method: 'PUT' | 'PATCH' | 'DELETE',
  actor: string | null,
  itemId: string,
  body?: unknown,
): Promise<Reply> {
  const response = await app.inject({
    method,
    url: `/verdicts/${encodeURIComponent(itemId)}`,
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
  return {
    status: response.statusCode,
    raw: response.body,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
    headers: response.headers,
  }
}

const rate = (actor: string | null, itemId: string, body: unknown) =>
  call('PUT', actor, itemId, body)
const amend = (actor: string | null, itemId: string, body: unknown) =>
  call('PATCH', actor, itemId, body)
const withdraw = (actor: string | null, itemId: string) => call('DELETE', actor, itemId)

/** Read through the contract the client parses — a server that drifted from it fails here. */
function card(reply: Reply): VerdictCard {
  return verdictCardCodec.parse(reply.body)
}

async function rows(itemId: string) {
  return db.select().from(verdicts).where(eq(verdicts.itemId, itemId))
}

/** In microseconds, as stored: a `Date` folds two instants inside one millisecond into one. */
async function stamps(itemId: string) {
  const [row] = await db.execute<{ rated: string; updated: string }>(sql`
    select rated_at::text as rated, updated_at::text as updated
    from verdicts where item_id = ${itemId}::uuid
  `)
  return row
}

async function eventCount(): Promise<number> {
  return (await db.select().from(events)).length
}

describe('PUT — поставить оценку', () => {
  it('1: первая оценка — 201, карточка, no-store', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    const reply = await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })

    expect(reply.status).toBe(201)
    expect(reply.headers['cache-control']).toBe('no-store')
    const verdict = card(reply)
    expect(verdict).toMatchObject({ itemId, score: 2, review: 'Пахнет крахмалом' })
    expect(verdict.updatedAt.getTime()).toBeGreaterThanOrEqual(verdict.ratedAt.getTime())
  })

  it('2: повтор того же черновика — 200, одна строка, след не сдвинулся', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })
    const before = await stamps(itemId)

    const reply = await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })

    expect(reply.status).toBe(200)
    expect(await rows(itemId)).toHaveLength(1)
    expect(await stamps(itemId)).toEqual(before)
  })

  it('3: переоценка — 200, одна строка, время первой оценки прежнее, след новее', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 5 })
    const before = await stamps(itemId)

    const reply = await rate(actor, itemId, { score: 2 })

    expect(reply.status).toBe(200)
    expect(card(reply).score).toBe(2)
    expect(await rows(itemId)).toHaveLength(1)
    const after = await stamps(itemId)
    expect(after?.rated).toBe(before?.rated)
    expect(after?.updated).not.toBe(before?.updated)
  })

  it('4: оценка без отзыва поверх отзыва — текст остаётся', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })

    const reply = await rate(actor, itemId, { score: 3 })

    expect(card(reply).review).toBe('Пахнет крахмалом')
  })

  it('9: отзыв в несколько строк хранится с \\n, \\r\\n сведён к нему', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    const reply = await rate(actor, itemId, {
      score: 2,
      review: 'Пахнет крахмалом.\r\nМясом — нет',
    })

    expect(card(reply).review).toBe('Пахнет крахмалом.\nМясом — нет')
    expect((await rows(itemId))[0]?.review).toBe('Пахнет крахмалом.\nМясом — нет')
  })

  it('9: отзыв на границе — 500 символов принят, 501 нет', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    expect((await rate(actor, itemId, { score: 3, review: 'а'.repeat(501) })).status).toBe(400)
    expect((await rate(actor, itemId, { score: 3, review: 'а'.repeat(500) })).status).toBe(201)
  })

  it('9: пустые строки подряд, одни пробелы, управляющий знак — 400 без записи', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    // The code, not only the status: it reaches the screen (Р-11).
    for (const review of ['раз\n\n\nдва', '   ', '\u2800\n\u2800', 'а\u202eб', '\u202e\nтекст']) {
      const reply = await rate(actor, itemId, { score: 3, review })
      expect(reply.status, JSON.stringify(review)).toBe(400)
      expect(reply.body, JSON.stringify(review)).toEqual({
        code: ISSUE.TEXT_NOT_VISIBLE,
        details: 'review',
      })
    }
    expect(await rows(itemId)).toHaveLength(0)
  })

  it('Е: сотни тысяч невидимых пустых строк в голове отзыва — отказ за миллисекунды', async () => {
    // The bound is the proof: parsing is synchronous, so a request in parallel would wait
    // out any blockage and still answer — it would show nothing (С-22).
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    const started = Date.now()
    const reply = await rate(actor, itemId, { score: 3, review: `${'\u2800\n'.repeat(200_000)}a` })

    expect(reply.status).toBe(400)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(await rows(itemId)).toHaveLength(0)
  })

  it('8: шкала — только целые от 1 до 5', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    for (const score of [0, 6, 4.5, '5', null]) {
      expect((await rate(actor, itemId, { score })).status, String(score)).toBe(400)
    }
    expect((await rate(actor, itemId, {})).status).toBe(400)
    expect(await rows(itemId)).toHaveLength(0)

    expect((await rate(actor, itemId, { score: 1 })).status).toBe(201)
    expect((await rate(actor, itemId, { score: 5 })).status).toBe(200)
  })

  it('10: место, владелец и позиция в теле — отказ с именем поля', async () => {
    const actor = await insertActor(db)
    const other = await insertActor(db)
    const itemId = await insertItem(db)
    const placeId = await insertPlace(db)

    for (const [field, value] of [
      ['placeId', placeId],
      ['actorId', other],
      ['itemId', itemId],
    ] as const) {
      const reply = await rate(actor, itemId, { score: 4, [field]: value })
      expect(reply.status).toBe(400)
      expect(reply.body).toEqual({ code: ISSUE.BODY_INVALID, details: field })
    }
    expect(await rows(itemId)).toHaveLength(0)
  })

  it('11: malformed and missing are 404; uppercase is the same item (MOL-25)', async () => {
    const actor = await insertActor(db)
    for (const id of [UNKNOWN_ID, 'молоко']) {
      expect(await rate(actor, id, { score: 4 })).toMatchObject({
        status: 404,
        body: { code: ERROR.NOT_FOUND },
      })
    }
    const itemId = await insertItem(db)
    expect(await rate(actor, itemId.toUpperCase(), { score: 4 })).toMatchObject({
      status: 201,
      body: { itemId },
    })
    expect(await rows(itemId)).toHaveLength(1)
  })

  it('12: блюдо, попавшее в справочник мимо API, — 400, а не 500', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db, { kind: 'dish', name: 'Карбонара', searchKey: 'karbonara' })

    expect(await rate(actor, itemId, { score: 4 })).toMatchObject({
      status: 400,
      body: { code: ISSUE.VERDICT_PLACE_NOT_FOR_KIND, details: 'placeId' },
    })
    expect(await rows(itemId)).toHaveLength(0)
  })

  it('16: позиция без штрихкода, заведённая латиницей, оценивается как любая', async () => {
    const actor = await insertActor(db)
    const proposed = await app.inject({
      method: 'POST',
      url: '/catalogue/items',
      headers: { cookie: await signIn(db, actor) },
      payload: { kind: 'product', name: 'Marianna moloko', defaultUnit: 'l' },
    })
    const { id } = JSON.parse(proposed.body) as { id: string }

    expect((await rate(actor, id, { score: 4 })).status).toBe(201)
  })

  it('17: двойной тап — одна строка', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    const replies = await Promise.all([
      rate(actor, itemId, { score: 4 }),
      rate(actor, itemId, { score: 4 }),
    ])

    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 201])
    expect(await rows(itemId)).toHaveLength(1)
  })
})

describe('PATCH — изменить оценку', () => {
  it('5: review null стирает текст и оставляет оценку', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })

    const reply = await amend(actor, itemId, { review: null })

    expect(reply.status).toBe(200)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(card(reply)).toMatchObject({ score: 2, review: null })
    expect((await rows(itemId))[0]?.review).toBeNull()
  })

  it('5: смена одной оценки текст не трогает', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })

    expect(card(await amend(actor, itemId, { score: 4 }))).toMatchObject({
      score: 4,
      review: 'Пахнет крахмалом',
    })
  })

  it('6: пустой патч — 400; оценки нет — 404', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    expect(await amend(actor, itemId, {})).toMatchObject({
      status: 400,
      body: { code: ISSUE.PATCH_EMPTY },
    })
    expect(await amend(actor, itemId, { score: 3 })).toMatchObject({
      status: 404,
      body: { code: ERROR.NOT_FOUND },
    })
  })

  it('6, 7: чужая оценка той же позиции — 404, и она цела', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(owner, itemId, { score: 5, review: 'моё' })

    expect((await amend(stranger, itemId, { review: null })).status).toBe(404)

    expect(await rows(itemId)).toMatchObject([{ actorId: owner, score: 5, review: 'моё' }])
  })

  it('Р-D: патч с тем же значением не двигает след', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 3 })
    const before = await stamps(itemId)

    expect((await amend(actor, itemId, { score: 3 })).status).toBe(200)
    expect(await stamps(itemId)).toEqual(before)
  })
})

describe('DELETE — снять оценку', () => {
  it('18: 204, строка остаётся для ворот — без текста, с оценкой и временем', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })
    const before = await stamps(itemId)

    const reply = await withdraw(actor, itemId)

    expect(reply.status).toBe(204)
    expect(reply.raw).toBe('')
    const [row] = await rows(itemId)
    expect(row?.deletedAt).toBeInstanceOf(Date)
    expect(row?.review).toBeNull()
    expect(row?.score).toBe(2)
    expect((await stamps(itemId))?.rated).toBe(before?.rated)
  })

  it('18: повтор, отсутствующая и чужая — 404; чужая цела', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const itemId = await insertItem(db)
    const lonely = await insertItem(db, { name: 'Кефир', searchKey: 'kefir' })
    await rate(owner, itemId, { score: 5 })

    expect((await withdraw(stranger, itemId)).status).toBe(404)
    expect((await rows(itemId))[0]?.deletedAt).toBeNull()

    expect((await withdraw(owner, itemId)).status).toBe(204)
    expect((await withdraw(owner, itemId)).status).toBe(404)
    expect((await withdraw(owner, lonely)).status).toBe(404)
    expect((await withdraw(owner, 'молоко')).status).toBe(400)
  })

  it('19: оценка после снятия — 201, та же строка, время первой оценки прежнее, старый текст не вернулся', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 2, review: 'Пахнет крахмалом' })
    const before = await stamps(itemId)
    await withdraw(actor, itemId)

    const reply = await rate(actor, itemId, { score: 4 })

    expect(reply.status).toBe(201)
    expect(card(reply)).toMatchObject({ score: 4, review: null })
    const all = await rows(itemId)
    expect(all).toHaveLength(1)
    expect(all[0]?.deletedAt).toBeNull()
    expect((await stamps(itemId))?.rated).toBe(before?.rated)
  })

  it('Б: оценка, вставшая за незафиксированным снятием, — 201, а не «заменена»', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 4, review: 'нормально' })

    let put: Promise<Reply> | undefined
    await withdrawing.db.transaction(async (tx) => {
      expect(await createVerdictRepository(tx).withdraw(actor, itemId)).toBe(true)
      put = rate(actor, itemId, { score: 5 })
      // Until the rating is actually waiting on the row's lock, committing proves nothing —
      // and a test that committed anyway would pass on the old code too (С-19).
      let waited = false
      for (let tries = 0; tries < 500 && !waited; tries += 1) {
        const [waiting] = await watcher<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and datname = current_database()
        `
        waited = (waiting?.n ?? 0) > 0
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(waited).toBe(true)
    })
    const reply = await put!

    expect(reply.status).toBe(201)
    expect(await rows(itemId)).toMatchObject([{ score: 5, deletedAt: null, review: null }])
  })

  it('Б: две оценки наперегонки по снятой — одна 201, другая 200', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 4 })
    await withdraw(actor, itemId)

    const replies = await Promise.all([
      rate(actor, itemId, { score: 5 }),
      rate(actor, itemId, { score: 5 }),
    ])

    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 201])
  })

  it('21: снятая оценка не правится и не закрывает покупку', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    const { trip } = await trips.start(
      actor,
      { id: randomUUID(), placeId: await insertPlace(db) },
      'AMD',
      null,
    )
    await expenses.add(actor, { id: randomUUID(), tripId: trip.id, itemId })
    await rate(actor, itemId, { score: 4 })
    expect(await expenses.unratedFor(actor, 10)).toHaveLength(0)

    await withdraw(actor, itemId)

    expect((await amend(actor, itemId, { score: 5 })).status).toBe(404)
    expect(await expenses.unratedFor(actor, 10)).toHaveLength(1)
  })
})

describe('что не должно сработать', () => {
  it('13: без заголовка владельца — 401 на всех трёх, строк нет', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actor, itemId, { score: 3 })

    expect((await rate(null, itemId, { score: 1 })).status).toBe(401)
    expect((await amend(null, itemId, { review: null })).status).toBe(401)
    expect((await withdraw(null, itemId)).status).toBe(401)
    expect(await rows(itemId)).toMatchObject([{ score: 3, deletedAt: null }])
  })

  it('14, 20: ни одна из трёх ручек не пишет в журнал — ворота 0.2 считают по verdicts', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)
    const before = await eventCount()

    await rate(actor, itemId, { score: 3, review: 'так себе' })
    await amend(actor, itemId, { review: null })
    await withdraw(actor, itemId)
    await rate(actor, itemId, { score: 4 })

    expect(await eventCount()).toBe(before)
  })

  it('15: ни владелец, ни id строки не уходят в ответе — ни полем, ни значением', async () => {
    const actor = await insertActor(db)
    const itemId = await insertItem(db)

    const replies = [
      await rate(actor, itemId, { score: 3 }),
      await amend(actor, itemId, { score: 4 }),
    ]

    const [row] = await rows(itemId)
    for (const reply of replies) {
      expect(reply.raw).not.toContain(actor)
      expect(reply.raw).not.toContain(row?.id ?? 'no row')
      expect(Object.keys(reply.body as object).sort()).toEqual(
        ['itemId', 'ratedAt', 'review', 'score', 'updatedAt'].sort(),
      )
    }
  })
})
