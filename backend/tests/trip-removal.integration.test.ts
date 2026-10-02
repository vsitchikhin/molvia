import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ERROR, currentTripResponseSchema, tripHistoryCodec, tripViewCodec } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createExchangeRepository } from '@/db/exchanges-repository'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createMoneyAccountRepository } from '@/db/money-accounts-repository'
import { createMoneyRepository } from '@/db/money-repository'
import { createPlaceRepository } from '@/db/places-repository'
import { expenses, trips } from '@/db/schema'
import { createTripRepository } from '@/db/trips-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import {
  insertActor,
  insertItem,
  insertPlace,
  insertTrip,
  ownPrices,
  signIn,
  tripContext,
} from './fixtures'

const { db, close } = connectDrizzle()
let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await close()
})

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

function call(
  me: Owner,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { cookie: me.cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

/** A trip of the owner with one priced purchase, as the queue would have written it. */
async function tripWithMilk(
  me: Owner,
  patch: { finished?: boolean; place?: string } = {},
): Promise<{ trip: string; item: string; place: string; expense: string }> {
  const place = patch.place ?? (await insertPlace(db, { name: `Removal ${randomUUID()}` }))
  const item = await insertItem(db)
  const trip = await insertTrip(db, {
    actorId: me.id,
    placeId: place,
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    ...(patch.finished ? { finishedAt: new Date(Date.now() - 60 * 60 * 1000) } : {}),
  })
  const expense = randomUUID()
  await db.insert(expenses).values({
    id: expense,
    tripId: trip,
    itemId: item,
    qtyMilli: 1000n,
    qtyUnit: 'l',
    amountMinor: 57_000n,
    amountCurrency: 'AMD',
  })
  return { trip, item, place, expense }
}

/** The mark moved back in time, as the minute timer would find it. */
async function markedAgo(trip: string, interval: string): Promise<void> {
  await db
    .update(trips)
    .set({ deletedAt: sql`clock_timestamp() - ${interval}::interval` })
    .where(eq(trips.id, trip))
}

describe('удалить поход (MOL-76)', () => {
  it('204, и 204 на повтор; чужой, несуществующий и кривой — один 404; без входа — 401', async () => {
    const me = await owner()
    const stranger = await owner()
    const { trip } = await tripWithMilk(me)

    for (const id of [trip, randomUUID(), 'not-a-uuid']) {
      const answer = await call(stranger, 'DELETE', `/trips/${id}`)
      expect(answer.statusCode).toBe(404)
      expect(answer.json()).toMatchObject({ code: ERROR.NOT_FOUND })
    }
    expect((await app.inject({ method: 'DELETE', url: `/trips/${trip}` })).statusCode).toBe(401)

    const first = await call(me, 'DELETE', `/trips/${trip.toUpperCase()}`)
    expect(first.statusCode).toBe(204)
    expect(first.headers['cache-control']).toBe('no-store')
    expect((await call(me, 'DELETE', `/trips/${trip}`)).statusCode).toBe(204)
  })

  it('удалённый поход не видит ни одна ручка похода', async () => {
    const me = await owner()
    const { trip, item, expense } = await tripWithMilk(me)
    expect((await call(me, 'DELETE', `/trips/${trip}`)).statusCode).toBe(204)

    expect(
      currentTripResponseSchema.parse((await call(me, 'GET', '/trips/current')).json()),
    ).toEqual({
      trip: null,
    })
    expect((await call(me, 'GET', `/trips/${trip}`)).statusCode).toBe(404)
    const add = await call(me, 'POST', `/trips/${trip}/expenses`, {
      id: randomUUID(),
      itemId: item,
    })
    expect(add.statusCode).toBe(404)
    expect(
      (await call(me, 'PATCH', `/trips/${trip}/expenses/${expense}`, { amount: null })).statusCode,
    ).toBe(404)
    expect((await call(me, 'DELETE', `/trips/${trip}/expenses/${expense}`)).statusCode).toBe(404)
    expect((await call(me, 'POST', `/trips/${trip}/finish`, {})).statusCode).toBe(404)
    expect(
      (await call(me, 'PUT', `/trips/${trip}/rate-choice`, { choice: 'jumped' })).statusCode,
    ).toBe(404)
    expect(
      (await call(me, 'PUT', `/trips/${trip}/payment`, { accountId: null, debited: null }))
        .statusCode,
    ).toBe(404)
    // The purchases are still there, only out of every reader's sight until the timer.
    expect(await db.select().from(expenses).where(eq(expenses.id, expense))).toHaveLength(1)
  })

  it('завершённый уходит из истории, и страница не теряет места', async () => {
    const me = await owner()
    const kept = await tripWithMilk(me, { finished: true })
    const removed = await tripWithMilk(me, { finished: true })
    await call(me, 'DELETE', `/trips/${removed.trip}`)
    const page = tripHistoryCodec.parse((await call(me, 'GET', '/trips/history')).json())
    expect(page.trips.map((row) => row.id)).toEqual([kept.trip])
  })

  it('открыт один: удалённый открытый не мешает начать новый', async () => {
    const me = await owner()
    const { trip } = await tripWithMilk(me)
    const context = await tripContext(db, me.id)
    const start = () =>
      call(me, 'POST', '/trips', {
        id: randomUUID(),
        place: { kind: 'store', name: 'SAS' },
        context,
      })
    expect((await start()).statusCode).toBe(409)
    await call(me, 'DELETE', `/trips/${trip}`)
    expect((await start()).statusCode).toBe(201)
  })
})

describe('«Вернуть» (MOL-76)', () => {
  it('в десять минут — поход целиком, с покупками; повтор — 200; после — 404', async () => {
    const me = await owner()
    const { trip, expense } = await tripWithMilk(me, { finished: true })
    await call(me, 'DELETE', `/trips/${trip}`)

    const back = await call(me, 'POST', `/trips/${trip.toUpperCase()}/restore`)
    expect(back.statusCode).toBe(200)
    expect(back.headers['cache-control']).toBe('no-store')
    const view = tripViewCodec.parse(back.json())
    expect(view.id).toBe(trip)
    expect(view.expenses.map((row) => row.id)).toEqual([expense])
    expect((await call(me, 'POST', `/trips/${trip}/restore`)).statusCode).toBe(200)

    await call(me, 'DELETE', `/trips/${trip}`)
    await markedAgo(trip, '9 minutes 50 seconds')
    expect((await call(me, 'POST', `/trips/${trip}/restore`)).statusCode).toBe(200)

    await call(me, 'DELETE', `/trips/${trip}`)
    await markedAgo(trip, '10 minutes 1 second')
    expect((await call(me, 'POST', `/trips/${trip}/restore`)).statusCode).toBe(404)
    // Past its time the removal is final for the removal too: the queue reads 404 as done.
    expect((await call(me, 'DELETE', `/trips/${trip}`)).statusCode).toBe(404)
  })

  it('повтор удаления не растягивает десять минут', async () => {
    const me = await owner()
    const { trip } = await tripWithMilk(me)
    await call(me, 'DELETE', `/trips/${trip}`)
    await markedAgo(trip, '9 minutes')
    await call(me, 'DELETE', `/trips/${trip}`)
    const [row] = await db.select().from(trips).where(eq(trips.id, trip))
    expect(row?.deletedAt?.getTime()).toBeLessThan(Date.now() - 8 * 60 * 1000)
  })

  it('чужой — 404, и пометка остаётся', async () => {
    const me = await owner()
    const stranger = await owner()
    const { trip } = await tripWithMilk(me)
    await call(me, 'DELETE', `/trips/${trip}`)
    expect((await call(stranger, 'POST', `/trips/${trip}/restore`)).statusCode).toBe(404)
    expect((await call(stranger, 'POST', `/trips/not-a-uuid/restore`)).statusCode).toBe(404)
    expect((await call(me, 'GET', `/trips/${trip}`)).statusCode).toBe(404)
  })

  it('открытый, когда начат другой, — 409 trip_open; завершённый — можно', async () => {
    const me = await owner()
    const open = await tripWithMilk(me)
    await call(me, 'DELETE', `/trips/${open.trip}`)
    const finished = await tripWithMilk(me, { finished: true })
    await call(me, 'DELETE', `/trips/${finished.trip}`)
    const context = await tripContext(db, me.id)
    expect(
      (
        await call(me, 'POST', '/trips', {
          id: randomUUID(),
          place: { kind: 'store', name: 'SAS' },
          context,
        })
      ).statusCode,
    ).toBe(201)

    const refused = await call(me, 'POST', `/trips/${open.trip}/restore`)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ code: ERROR.TRIP_OPEN })
    expect((await call(me, 'GET', `/trips/${open.trip}`)).statusCode).toBe(404)
    expect((await call(me, 'POST', `/trips/${finished.trip}/restore`)).statusCode).toBe(200)
  })
})

describe('«Вернуть» вместе с «Завершить» (MOL-76, раунд 3, В1)', () => {
  it('открытый на сервере, когда открыт другой, возвращается завершённым — с временем телефона', async () => {
    const me = await owner()
    const open = await tripWithMilk(me)
    await call(me, 'DELETE', `/trips/${open.trip}`)
    const context = await tripContext(db, me.id)
    const next = await call(me, 'POST', '/trips', {
      id: randomUUID(),
      place: { kind: 'store', name: 'SAS' },
      context,
    })
    expect(next.statusCode).toBe(201)

    const at = '2026-09-27T10:00:00.000Z'
    const back = await call(me, 'POST', `/trips/${open.trip}/restore`, {
      finish: { finishedOnDeviceAt: at },
    })
    expect(back.statusCode).toBe(200)
    const view = tripViewCodec.parse(back.json())
    expect(view.finishedAt).not.toBeNull()
    expect(view.finishedOnDeviceAt).toEqual(new Date(at))
    expect(view.expenses.map((row) => row.id)).toEqual([open.expense])
    // The trip going on stays the one going on.
    const current = currentTripResponseSchema.parse(
      (await call(me, 'GET', '/trips/current')).json(),
    )
    expect(current.trip?.id).toBe(tripViewCodec.parse(next.json()).id)
  })

  it('уже завершённый — время не двигается; время телефона из будущего отброшено', async () => {
    const me = await owner()
    const finished = await tripWithMilk(me, { finished: true })
    const [before] = await db.select().from(trips).where(eq(trips.id, finished.trip))
    await call(me, 'DELETE', `/trips/${finished.trip}`)
    const back = await call(me, 'POST', `/trips/${finished.trip}/restore`, {
      finish: { finishedOnDeviceAt: '2026-09-01T10:00:00.000Z' },
    })
    expect(back.statusCode).toBe(200)
    const [after] = await db.select().from(trips).where(eq(trips.id, finished.trip))
    expect(after?.finishedAt).toEqual(before?.finishedAt)
    expect(after?.finishedOnDeviceAt).toBeNull()

    const open = await tripWithMilk(me)
    await call(me, 'DELETE', `/trips/${open.trip}`)
    const future = await call(me, 'POST', `/trips/${open.trip}/restore`, {
      finish: { finishedOnDeviceAt: '2099-01-01T00:00:00.000Z' },
    })
    expect(tripViewCodec.parse(future.json()).finishedOnDeviceAt ?? null).toBeNull()
    expect(tripViewCodec.parse(future.json()).finishedAt).not.toBeNull()
  })

  it('тело не по контракту — 400; без тела — как раньше', async () => {
    const me = await owner()
    const { trip } = await tripWithMilk(me, { finished: true })
    await call(me, 'DELETE', `/trips/${trip}`)
    expect(
      (await call(me, 'POST', `/trips/${trip}/restore`, { finish: { at: 'вчера' } })).statusCode,
    ).toBe(400)
    expect((await call(me, 'POST', `/trips/${trip}/restore`)).statusCode).toBe(200)
  })
})

describe('старт из очереди после удаления (MOL-76, Р-1)', () => {
  it('в десять минут — 409 conflict, поход не заводится заново; после — новый поход', async () => {
    const me = await owner()
    const context = await tripContext(db, me.id)
    const id = randomUUID()
    const start = () =>
      call(me, 'POST', '/trips', { id, place: { kind: 'store', name: 'SAS' }, context })
    expect((await start()).statusCode).toBe(201)
    await call(me, 'DELETE', `/trips/${id}`)

    const again = await start()
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ code: ERROR.CONFLICT })

    await markedAgo(id, '11 minutes')
    const fresh = await start()
    expect(fresh.statusCode).toBe(201)
    const view = tripViewCodec.parse(fresh.json())
    expect(view.expenses).toEqual([])
    const [row] = await db.select().from(trips).where(eq(trips.id, id))
    expect(row?.deletedAt).toBeNull()
  })
})

describe('минутный таймер (MOL-76)', () => {
  it('удаляет помеченное раньше десяти минут назад с покупками и не трогает остальное', async () => {
    const me = await owner()
    const stale = await tripWithMilk(me, { finished: true })
    const recent = await tripWithMilk(me, { finished: true })
    const live = await tripWithMilk(me, { finished: true })
    await markedAgo(stale.trip, '10 minutes 1 second')
    await markedAgo(recent.trip, '9 minutes 50 seconds')

    await createTripRepository(db).purgeStale()

    const left = await db.select({ id: trips.id }).from(trips).where(eq(trips.actorId, me.id))
    expect(left.map((row) => row.id).sort()).toEqual([recent.trip, live.trip].sort())
    expect(await db.select().from(expenses).where(eq(expenses.id, stale.expense))).toEqual([])
    expect(await db.select().from(expenses).where(eq(expenses.id, recent.expense))).toHaveLength(1)
  })
})

describe('помеченный поход не видит ни один читатель (MOL-76, Т-1.3)', () => {
  it('«Оценки», «Что брать», месяц «Денег», счета, подсказка обмена, последние места', async () => {
    const me = await owner()
    const place = await insertPlace(db, { name: `Readers ${randomUUID()}` })
    const removed = await tripWithMilk(me, { finished: true, place })
    const expensesRepo = createExpenseRepository(db)
    const day = Date.now() - 60 * 60 * 1000
    const from = new Date(day - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const to = new Date(day + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    /** What every reader says about this one trip — the same questions before and after. */
    const seen = async () => ({
      pending: (await expensesRepo.pendingVerdictsFor(me.id, 50)).items.some(
        (card) => card.itemId === removed.item,
      ),
      pendingRoute: JSON.stringify((await call(me, 'GET', '/verdicts/pending')).json()).includes(
        removed.item,
      ),
      cheapest: (await expensesRepo.placePricesFor(ownPrices(me.id, [removed.item]))).length > 0,
      median: (await expensesRepo.medianPriceFor(ownPrices(me.id, [removed.item]))).length > 0,
      rows: (await expensesRepo.forTrip(removed.trip, me.id)).length > 0,
      month: (await createMoneyRepository(db).tripLines(me.id, from, to)).some(
        (line) => line.tripId === removed.trip,
      ),
      accounts: (await createMoneyAccountRepository(db).operations(me.id)).some(
        (operation) => operation.id === removed.trip,
      ),
      hint:
        (await createExchangeRepository(db).spentSince(
          me.id,
          'AMD',
          new Date(Date.now() - 24 * 60 * 60 * 1000),
        )) > 0n,
      places: (await createPlaceRepository(db).recentFor(me.id, 10)).some(
        (row) => row.id === place,
      ),
    })

    const everywhere = await seen()
    expect(Object.values(everywhere).every(Boolean)).toBe(true)
    await call(me, 'DELETE', `/trips/${removed.trip}`)
    const nowhere = await seen()
    expect(Object.values(nowhere).some(Boolean)).toBe(false)
    await call(me, 'POST', `/trips/${removed.trip}/restore`)
    expect(await seen()).toEqual(everywhere)
  })

  it('чужая цена удалённого похода уходит из общего агрегата города', async () => {
    const buyers = await Promise.all([owner(), owner(), owner()])
    const place = await insertPlace(db, { name: `Shared ${randomUUID()}` })
    const item = await insertItem(db)
    const tripOf = async (me: Owner) => {
      const trip = await insertTrip(db, {
        actorId: me.id,
        placeId: place,
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      })
      await db.insert(expenses).values({
        id: randomUUID(),
        tripId: trip,
        itemId: item,
        qtyMilli: 1000n,
        qtyUnit: 'l',
        amountMinor: 57_000n,
        amountCurrency: 'AMD',
      })
      return trip
    }
    const [first, second, third] = buyers
    const firstTrip = await tripOf(first)
    await tripOf(second)
    await tripOf(third)
    const asker = await owner()
    const shared = { ...ownPrices(asker.id, [item]), scope: 'shared' as const }
    const repo = createExpenseRepository(db)
    expect(await repo.placePricesFor(shared)).toHaveLength(1)

    await call(first, 'DELETE', `/trips/${firstTrip}`)
    // Two buyers are no aggregate: the place closes again.
    expect(await repo.placePricesFor(shared)).toEqual([])
  })
})
