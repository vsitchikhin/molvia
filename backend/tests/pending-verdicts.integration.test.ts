/**
 * «Оценки» through the server (MOL-28): what was bought and not rated, one card per item. The
 * numbers in the test names are the corners of `requirements/MOL-28.md` §5.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PENDING_VERDICTS_LIMIT, pendingVerdictsCodec } from '@molvia/model'
import type { PendingVerdicts } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { events, expenses } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

const { db, close } = connectDrizzle()

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

async function pending(actor: string | null) {
  const response = await app.inject({
    method: 'GET',
    url: '/verdicts/pending',
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
  })
  return { status: response.statusCode, headers: response.headers, body: response.body }
}

/** Read through the contract the client parses — a server that drifted from it fails here. */
async function queue(actor: string): Promise<PendingVerdicts> {
  const reply = await pending(actor)
  expect(reply.status).toBe(200)
  return pendingVerdictsCodec.parse(JSON.parse(reply.body))
}

/** Bought on a trip of that day: the day of a purchase is its trip's, not its row's. */
async function bought(actorId: string, itemId: string, placeId: string, at: string) {
  const tripId = await insertTrip(db, { actorId, placeId, startedAt: new Date(at) })
  await db.insert(expenses).values({ id: randomUUID(), tripId, itemId, createdAt: new Date(at) })
}

async function rate(actor: string, itemId: string, score = 4) {
  return app.inject({
    method: 'PUT',
    url: `/verdicts/${itemId}`,
    headers: { cookie: await signIn(db, actor) },
    payload: { score },
  })
}

describe('GET /verdicts/pending', () => {
  it('1: три покупки одной позиции в двух местах — одна карточка, место и день последней', async () => {
    const actor = await insertActor(db)
    const milk = await insertItem(db)
    const sas = await insertPlace(db)
    const city = await insertPlace(db, { name: 'Ереван Сити' })
    await bought(actor, milk, sas, '2026-09-15T10:00:00.000Z')
    await bought(actor, milk, city, '2026-09-18T17:40:00.000Z')
    await bought(actor, milk, sas, '2026-09-16T09:00:00.000Z')

    expect(await queue(actor)).toEqual({
      items: [
        {
          itemId: milk,
          name: 'Молоко «Ашхар»',
          placeName: 'Ереван Сити',
          boughtAt: new Date('2026-09-18T17:40:00.000Z'),
        },
      ],
      total: 1,
    })
  })

  it('новые покупки сверху, по последней покупке позиции', async () => {
    const actor = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const bread = await insertItem(db, { name: 'Хлеб', searchKey: 'hleb', defaultUnit: 'piece' })
    await bought(actor, milk, place, '2026-09-16T10:00:00.000Z')
    await bought(actor, bread, place, '2026-09-17T10:00:00.000Z')
    await bought(actor, milk, place, '2026-09-18T10:00:00.000Z')

    expect((await queue(actor)).items.map((card) => card.name)).toEqual(['Молоко «Ашхар»', 'Хлеб'])
  })

  it('2: оценённая позиция уходит, снятая оценка возвращает её', async () => {
    const actor = await insertActor(db)
    const milk = await insertItem(db)
    await bought(actor, milk, await insertPlace(db), '2026-09-18T10:00:00.000Z')

    await rate(actor, milk)
    expect(await queue(actor)).toEqual({ items: [], total: 0 })

    await app.inject({
      method: 'DELETE',
      url: `/verdicts/${milk}`,
      headers: { cookie: await signIn(db, actor) },
    })
    expect((await queue(actor)).total).toBe(1)
  })

  it('оценка, поставленная до покупки, тоже закрывает её — вердикт один на позицию', async () => {
    const actor = await insertActor(db)
    const milk = await insertItem(db)
    await rate(actor, milk)
    await bought(actor, milk, await insertPlace(db), '2026-09-18T10:00:00.000Z')

    expect((await queue(actor)).total).toBe(0)
  })

  it('3: чужая покупка не видна, чужой вердикт мою не закрывает', async () => {
    const me = await insertActor(db)
    const stranger = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const bread = await insertItem(db, { name: 'Хлеб', searchKey: 'hleb', defaultUnit: 'piece' })
    await bought(me, milk, place, '2026-09-18T10:00:00.000Z')
    await bought(stranger, bread, place, '2026-09-18T11:00:00.000Z')
    await rate(stranger, milk)

    expect((await queue(me)).items.map((card) => card.itemId)).toEqual([milk])
    expect((await queue(stranger)).items.map((card) => card.itemId)).toEqual([bread])
  })

  it('4: ровно 50 — список 50; 51 — список 50 и total 51', async () => {
    const actor = await insertActor(db)
    const place = await insertPlace(db)
    const buy = async (n: number) => {
      const itemId = await insertItem(db, {
        name: `Позиция ${String(n)}`,
        searchKey: `pozicia ${String(n)}`,
      })
      await bought(actor, itemId, place, new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString())
    }
    for (let n = 1; n <= PENDING_VERDICTS_LIMIT; n++) await buy(n)

    const full = await queue(actor)
    expect(full.items).toHaveLength(PENDING_VERDICTS_LIMIT)
    expect(full.total).toBe(PENDING_VERDICTS_LIMIT)

    await buy(PENDING_VERDICTS_LIMIT + 1)

    const over = await queue(actor)
    expect(over.items).toHaveLength(PENDING_VERDICTS_LIMIT)
    expect(over.total).toBe(PENDING_VERDICTS_LIMIT + 1)
    // The newest first, so the one that did not fit is the oldest.
    expect(over.items[0]?.name).toBe(`Позиция ${String(PENDING_VERDICTS_LIMIT + 1)}`)
    expect(over.items.map((card) => card.name)).not.toContain('Позиция 1')
  })

  it('B1: дописанное в закрытый поход куплено не позже его закрытия, а не «сегодня»', async () => {
    const actor = await insertActor(db)
    const sas = await insertPlace(db)
    const city = await insertPlace(db, { name: 'Ереван Сити' })
    const sauce = await insertItem(db, { name: 'Соевый соус', searchKey: 'soevii sous' })
    const bread = await insertItem(db, { name: 'Хлеб', searchKey: 'hleb', defaultUnit: 'piece' })
    await bought(actor, bread, city, '2026-09-18T10:00:00.000Z')
    // Last week's trip, the sauce written into it only now — found in the bag at home.
    const lastWeek = await insertTrip(db, {
      actorId: actor,
      placeId: sas,
      startedAt: new Date('2026-09-12T10:00:00.000Z'),
      finishedAt: new Date('2026-09-12T11:00:00.000Z'),
    })
    await db.insert(expenses).values({ id: randomUUID(), tripId: lastWeek, itemId: sauce })

    const { items } = await queue(actor)

    expect(items.map((card) => card.name)).toEqual(['Хлеб', 'Соевый соус'])
    expect(items[1]).toMatchObject({
      placeName: 'SAS',
      boughtAt: new Date('2026-09-12T11:00:00.000Z'),
    })
  })

  it('R6: в незакрытом походе сегодняшняя покупка — сегодняшняя, а не день открытия', async () => {
    const actor = await insertActor(db)
    const cheese = await insertItem(db, { name: 'Сыр', searchKey: 'sir' })
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
    const open = await insertTrip(db, {
      actorId: actor,
      placeId: await insertPlace(db),
      startedAt: threeDaysAgo,
    })
    const before = Date.now()
    await db.insert(expenses).values({ id: randomUUID(), tripId: open, itemId: cheese })

    const [card] = (await queue(actor)).items
    expect(card?.boughtAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('в одном походе у покупок один день — первой стоит набранная последней', async () => {
    const actor = await insertActor(db)
    const tripId = await insertTrip(db, { actorId: actor, placeId: await insertPlace(db) })
    const names = ['Творог', 'Сметана', 'Кефир']
    for (const [n, name] of names.entries()) {
      const itemId = await insertItem(db, { name, searchKey: name })
      const createdAt = new Date(Date.UTC(2026, 8, 19, 10, n))
      await db.insert(expenses).values({ id: randomUUID(), tripId, itemId, createdAt })
    }

    expect((await queue(actor)).items.map((card) => card.name)).toEqual([
      'Кефир',
      'Сметана',
      'Творог',
    ])
  })

  it('блюдо в очередь не идёт: до 0.3 путь вердикта не принимает место', async () => {
    const actor = await insertActor(db)
    const dish = await insertItem(db, {
      kind: 'dish',
      name: 'Карбонара',
      searchKey: 'karbonara',
      defaultUnit: 'piece',
    })
    await bought(actor, dish, await insertPlace(db, { kind: 'venue' }), '2026-09-18T10:00:00.000Z')

    expect(await queue(actor)).toEqual({ items: [], total: 0 })
  })

  it('без покупок — пусто, не ошибка; ответ не кешируется и журнал не пишется', async () => {
    const actor = await insertActor(db)
    const reply = await pending(actor)

    expect(reply.status).toBe(200)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(reply.body)).toEqual({ items: [], total: 0 })
    expect(await db.select().from(events)).toEqual([])
  })

  it('без заголовка владельца — 401', async () => {
    expect((await pending(null)).status).toBe(401)
  })
})
