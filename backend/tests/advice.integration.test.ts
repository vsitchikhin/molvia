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

interface Bought {
  readonly quantity?: Quantity
  /** The day of the visit — what «the last purchase» means (Р-4). */
  readonly startedAt?: Date
  /** When the row reached the server. The offline queue makes these two differ. */
  readonly createdAt?: Date
}

async function bought(
  actorId: string,
  itemId: string,
  placeId: string,
  amount: Money,
  options: Bought = {},
) {
  const quantity = options.quantity ?? kilo
  const tripId = await insertTrip(db, {
    actorId,
    placeId,
    ...(options.startedAt ? { startedAt: options.startedAt } : {}),
  })
  await db.insert(expenses).values({
    id: randomUUID(),
    tripId,
    itemId,
    qtyMilli: quantity.milli,
    qtyUnit: quantity.unit,
    amountMinor: amount.minor,
    amountCurrency: amount.currency,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  })
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

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

/** Дефекты первого адверсариального раунда: каждый закреплён, чтобы не вернулся. */
describe('ревью 1', () => {
  it('F1 — порог не выносит цену из места, которое тот же ответ скрыл', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    const itemId = await insertItem(db, { name: 'Сыр «Чанах»' })
    const sas = await insertPlace(db, { name: 'SAS' })
    const carrefour = await insertPlace(db, { name: 'Carrefour' })
    const yerevanCity = await insertPlace(db, { name: 'Ереван Сити' })

    // Трое покупателей, но в трёх разных магазинах: ни один магазин порога не проходит.
    await bought(me, itemId, sas, amd(500_000))
    await bought(await insertActor(db), itemId, carrefour, amd(300_000))
    await bought(await insertActor(db), itemId, yerevanCity, amd(400_000))
    for (const who of [me, await insertActor(db), await insertActor(db)]) {
      await rate(who, itemId, 3)
    }

    const [row] = (await screen(me)).rows
    expect(row?.level === 'if_cheap' && row.places.map((place) => place.name)).toEqual(['SAS'])
    // Медиана считается по тем же строкам, что и места: моя одна покупка — не три наблюдения.
    expect(row?.level === 'if_cheap' && row.threshold).toBeNull()
  })

  it('F4 — ничью решает день похода, а не час, когда очередь дошла до сервера', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await rate(me, itemId, 5)

    // Поход десятидневной давности долежал в телефоне и ушёл сегодня.
    await bought(me, itemId, placeId, amd(500_000), {
      quantity: kilo,
      startedAt: daysAgo(10),
      createdAt: new Date(),
    })
    await bought(me, itemId, placeId, amd(570_000), {
      quantity: { milli: 1000n, unit: 'l' },
      startedAt: daysAgo(1),
      createdAt: daysAgo(1),
    })

    const [row] = (await screen(me)).rows
    expect(row?.level === 'take' && row.places[0]?.unitPrice.unit).toBe('l')
  })

  it('F5 — доступ не отбирает мои собственные цены из другого города', async () => {
    const me = await insertActor(db, { city: 'Гюмри' })
    const yerevan = await insertPlace(db, { name: 'SAS', city: 'Ереван' })
    const itemId = await insertItem(db)
    await rate(me, itemId, 3)
    for (const minor of [290_000, 300_000, 340_000]) {
      await bought(me, itemId, yerevan, amd(minor))
    }

    const free = (await screen(me)).rows[0]
    await grantAccess(me)
    const paid = (await screen(me)).rows[0]

    expect(free?.level === 'if_cheap' && free.threshold?.scaledMinor).toBe(perKilo(300_000))
    expect(paid?.level === 'if_cheap' && paid.places).toHaveLength(1)
    expect(paid?.level === 'if_cheap' && paid.threshold?.scaledMinor).toBe(perKilo(300_000))
  })

  it('F7 — строки и места в одном ответе идут по одному алфавиту', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'молоко' })
    const apple = await insertItem(db, { name: 'Яблоко' })
    await rate(me, milk, 5)
    await rate(me, apple, 5)
    // Два места с одной ценой: порядок между ними решает только название.
    const yezh = await insertPlace(db, { name: 'Ёжик' })
    const yezhevika = await insertPlace(db, { name: 'Ежевика' })
    await bought(me, milk, yezh, amd(500_000))
    await bought(me, milk, yezhevika, amd(500_000))

    const { rows } = await screen(me)
    const milkRow = rows.find((row) => row.name === 'молоко')

    expect(rows.map((row) => row.name)).toEqual(['молоко', 'Яблоко'])
    expect(milkRow?.level === 'take' && milkRow.places.map((place) => place.name)).toEqual([
      'Ежевика',
      'Ёжик',
    ])
  })
})
