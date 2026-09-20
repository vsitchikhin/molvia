/**
 * «Что брать» through the server (MOL-31): the rated rows in three groups, prices where a
 * price is allowed, and nothing of anyone else's without access. The corners are §6 of
 * `requirements/MOL-31.md`.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { EVENT, adviceResponseSchema, unitPrice } from '@molvia/model'
import type { AdviceResponse, Money, Quantity } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, events, expenses, verdicts } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip } from './fixtures'

const { db, close } = connectDrizzle()

let app: FastifyInstance

const kilo: Quantity = { milli: 1000n, unit: 'kg' }
const amd = (minor: number): Money => ({ minor: BigInt(minor), currency: 'AMD' })
const perKilo = (minor: number) => unitPrice(amd(minor), kilo).scaledMinor

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

async function ask(actor: string | null) {
  const response = await app.inject({
    method: 'GET',
    url: '/advice',
    headers: actor === null ? {} : { 'x-molvia-actor': actor },
  })
  return { status: response.statusCode, headers: response.headers, body: response.body }
}

/** Read through the contract the client parses — a server that drifted from it fails here. */
async function screen(actor: string): Promise<AdviceResponse> {
  const reply = await ask(actor)
  expect(reply.status).toBe(200)
  return adviceResponseSchema.parse(JSON.parse(reply.body))
}

async function rate(actorId: string, itemId: string, score: number, review?: string) {
  await db
    .insert(verdicts)
    .values({
      id: randomUUID(),
      actorId,
      itemId,
      itemKind: 'product',
      score,
      review: review ?? null,
    })
    .onConflictDoNothing()
}

async function bought(
  actorId: string,
  itemId: string,
  placeId: string,
  amount: Money,
  quantity: Quantity = kilo,
) {
  const tripId = await insertTrip(db, { actorId, placeId })
  await db.insert(expenses).values({
    id: randomUUID(),
    tripId,
    itemId,
    qtyMilli: quantity.milli,
    qtyUnit: quantity.unit,
    amountMinor: amount.minor,
    amountCurrency: amount.currency,
  })
}

/** Access is granted, never asked for: there is no route that sets this column. */
async function grantAccess(actorId: string) {
  await db
    .update(actors)
    .set({ sharedUntil: sql`now() + interval '30 days'` })
    .where(eq(actors.id, actorId))
}

describe('дверь', () => {
  it('без личности отвечает 401 и ничем больше', async () => {
    const reply = await ask(null)

    expect(reply.status).toBe(401)
    expect(await db.select().from(events)).toHaveLength(0)
  })

  it('не хранится кешем: данные личные', async () => {
    const actorId = await insertActor(db)

    expect((await ask(actorId)).headers['cache-control']).toBe('no-store')
  })

  it('пустой экран — пустой список, а не ошибка', async () => {
    const actorId = await insertActor(db)

    expect(await screen(actorId)).toEqual({ scope: 'own', rows: [] })
  })
})

describe('три группы', () => {
  it('раскладывает по оценке и ставит выше то, что нравится больше', async () => {
    const actorId = await insertActor(db)
    const beef = await insertItem(db, { name: 'Говядина' })
    const cheese = await insertItem(db, { name: 'Сыр «Чанах»' })
    const sausage = await insertItem(db, { name: 'Колбаса «Молочная»' })
    await rate(actorId, beef, 5)
    await rate(actorId, cheese, 3)
    await rate(actorId, sausage, 2, 'Пахнет крахмалом')

    const { rows } = await screen(actorId)

    expect(rows.map((row) => [row.name, row.level, row.rating])).toEqual([
      ['Говядина', 'take', '5.0'],
      ['Сыр «Чанах»', 'if_cheap', '3.0'],
      ['Колбаса «Молочная»', 'never', '2.0'],
    ])
  })

  it('у «не брать нигде» в ответе нет ни места, ни цены, ни порога — даже ключа', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db, { name: 'Колбаса «Молочная»' })
    await rate(actorId, itemId, 1, 'Пахнет крахмалом, а не мясом')
    for (const minor of [100_000, 120_000, 140_000]) {
      await bought(actorId, itemId, placeId, amd(minor))
    }

    const reply = await ask(actorId)
    const raw = JSON.parse(reply.body) as { rows: Record<string, unknown>[] }

    expect(Object.keys(raw.rows[0] ?? {}).sort()).toEqual([
      'itemId',
      'level',
      'name',
      'rating',
      'ratingsCount',
      'review',
    ])
    expect(reply.body).not.toContain('100000')
  })

  it('снятая оценка уходит с экрана и возвращается после повторной', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actorId, itemId, 5)

    await db
      .update(verdicts)
      .set({ deletedAt: sql`clock_timestamp()`, review: null })
      .where(eq(verdicts.itemId, itemId))
    expect((await screen(actorId)).rows).toEqual([])

    await db.update(verdicts).set({ deletedAt: null }).where(eq(verdicts.itemId, itemId))
    expect((await screen(actorId)).rows).toHaveLength(1)
  })
})

describe('цены', () => {
  it('отдаёт места по возрастанию цены за единицу с названием и числом наблюдений', async () => {
    const actorId = await insertActor(db)
    const market = await insertPlace(db, { name: 'Рынок в Гюмри' })
    const sas = await insertPlace(db, { name: 'SAS' })
    const itemId = await insertItem(db, { name: 'Говядина' })
    await rate(actorId, itemId, 5)
    await bought(actorId, itemId, sas, amd(510_000))
    await bought(actorId, itemId, market, amd(479_000))
    await bought(actorId, itemId, market, amd(490_000))

    const [row] = (await screen(actorId)).rows

    expect(row?.level === 'take' && row.places).toEqual([
      {
        placeId: market,
        name: 'Рынок в Гюмри',
        unitPrice: { scaledMinor: perKilo(479_000), currency: 'AMD', unit: 'kg' },
        observations: 2,
      },
      {
        placeId: sas,
        name: 'SAS',
        unitPrice: { scaledMinor: perKilo(510_000), currency: 'AMD', unit: 'kg' },
        observations: 1,
      },
    ])
  })

  it('порог появляется на третьей покупке и молчит на второй', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db, { name: 'Сыр «Чанах»' })
    await rate(actorId, itemId, 3)
    await bought(actorId, itemId, placeId, amd(290_000))
    await bought(actorId, itemId, placeId, amd(340_000))

    const two = (await screen(actorId)).rows[0]
    expect(two?.level === 'if_cheap' && two.threshold).toBeNull()

    await bought(actorId, itemId, placeId, amd(300_000))
    const three = (await screen(actorId)).rows[0]
    expect(three?.level === 'if_cheap' && three.threshold?.scaledMinor).toBe(perKilo(300_000))
  })

  it('оценённое, но не купленное приходит без ценового блока', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actorId, itemId, 5)

    const [row] = (await screen(actorId)).rows
    expect(row?.level === 'take' && row.places).toEqual([])
  })

  it('покупка без цены или без количества не наблюдение', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await rate(actorId, itemId, 5)
    const tripId = await insertTrip(db, { actorId, placeId })
    await db.insert(expenses).values({ id: randomUUID(), tripId, itemId })

    const [row] = (await screen(actorId)).rows
    expect(row?.level === 'take' && row.places).toEqual([])
  })

  it('не смешивает валюты: показывает ту, в которой покупали чаще', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await rate(actorId, itemId, 5)
    await bought(actorId, itemId, placeId, amd(479_000))
    await bought(actorId, itemId, placeId, amd(490_000))
    await bought(actorId, itemId, placeId, { minor: 50_000n, currency: 'RUB' })

    const [row] = (await screen(actorId)).rows
    expect(row?.level === 'take' && row.places).toHaveLength(1)
    expect(row?.level === 'take' && row.places[0]?.unitPrice.currency).toBe('AMD')
  })
})

describe('чужое', () => {
  it('без доступа не видно ничего чужого, сколько бы его ни было', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await rate(me, itemId, 5)
    for (let n = 0; n < 4; n += 1) {
      const stranger = await insertActor(db)
      await rate(stranger, itemId, 1)
      await bought(stranger, itemId, placeId, amd(100_000))
    }

    const [row] = (await screen(me)).rows

    expect(row?.rating).toBe('5.0')
    expect(row?.ratingsCount).toBe(1)
    expect(row?.level === 'take' && row.places).toEqual([])
  })

  it('с доступом — средняя по троим и общая цена', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db, { name: 'Говядина' })
    await rate(me, itemId, 5)
    await bought(me, itemId, placeId, amd(510_000))
    for (const score of [4, 4]) {
      const other = await insertActor(db)
      await rate(other, itemId, score)
      await bought(other, itemId, placeId, amd(479_000))
    }

    const answer = await screen(me)
    const [row] = answer.rows

    expect(answer.scope).toBe('shared')
    expect(row?.rating).toBe('4.3')
    expect(row?.ratingsCount).toBe(3)
    expect(row?.level === 'take' && row.places[0]?.unitPrice.scaledMinor).toBe(perKilo(479_000))
  })

  it('на двоих отдаёт мои цифры: из средней вычиталась бы чужая оценка', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    const itemId = await insertItem(db)
    await rate(me, itemId, 5)
    await rate(await insertActor(db), itemId, 1)

    const [row] = (await screen(me)).rows
    expect(row?.rating).toBe('5.0')
    expect(row?.ratingsCount).toBe(1)
  })

  it('не приносит цену из другого города', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    const erevan = await insertPlace(db, { name: 'SAS', city: 'Ереван' })
    const itemId = await insertItem(db)
    await rate(me, itemId, 5)
    for (let n = 0; n < 3; n += 1) {
      const other = await insertActor(db, { city: 'Ереван' })
      await rate(other, itemId, 5)
      await bought(other, itemId, erevan, amd(100_000))
    }

    const [row] = (await screen(me)).rows
    expect(row?.level === 'take' && row.places).toEqual([])
  })

  it('отдаёт мой отзыв и никогда чужой', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    const itemId = await insertItem(db)
    await rate(me, itemId, 2, 'Мой отзыв')
    for (const text of ['Чужой раз', 'Чужой два']) {
      await rate(await insertActor(db), itemId, 2, text)
    }

    const reply = await ask(me)
    expect(reply.body).toContain('Мой отзыв')
    expect(reply.body).not.toContain('Чужой')
  })
})

describe('журнал событий', () => {
  async function viewsOf(actorId: string) {
    return (await db.select().from(events)).filter(
      (row) => row.actorId === actorId && row.type === EVENT.ADVICE_VIEWED,
    )
  }

  it('в своём режиме не пишет ничего: чужого на экране не было', async () => {
    const actorId = await insertActor(db)
    await rate(actorId, await insertItem(db), 5)

    await screen(actorId)

    expect(await viewsOf(actorId)).toHaveLength(0)
  })

  it('в общем режиме пишет просмотр, и не чаще раза в сутки', async () => {
    const actorId = await insertActor(db)
    await grantAccess(actorId)

    await screen(actorId)
    await screen(actorId)
    await screen(actorId)

    const rows = await viewsOf(actorId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payload).toEqual({ subject: 'product' })
  })

  it('не пишет просмотр тому, кого нет', async () => {
    await ask(randomUUID())

    expect(await db.select().from(events)).toHaveLength(0)
  })
})
