import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MONEY_TRIP_CATEGORY_HEADER,
  moneyMonthCodec,
  placeCategoriesCodec,
  spendingCategoriesResponseCodec,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { expenses, spendingCategories, trips } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'
import { onlyRow, sorted } from './rows'

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

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

async function presetId(me: Owner, preset: string): Promise<string> {
  const response = await app.inject({
    url: '/spending-categories',
    headers: { cookie: me.cookie },
  })
  const found = spendingCategoriesResponseCodec
    .parse(response.json())
    .categories.find((category) => category.preset === preset)
  if (!found) throw new Error(`no preset ${preset}`)
  return found.id
}

function categorize(me: Owner, tripId: string, categoryId: string) {
  return app.inject({
    method: 'PUT',
    url: `/trips/${tripId}/category`,
    headers: { cookie: me.cookie },
    payload: { categoryId },
  })
}

async function categoryOf(tripId: string) {
  return onlyRow(await db.select().from(trips).where(eq(trips.id, tripId)))?.categoryId
}

/** A trip finished on 2026-10-05 with one purchase of 4 500 ֏. */
async function finishedTrip(me: Owner, placeId: string, day = 5): Promise<string> {
  const tripId = await insertTrip(db, {
    actorId: me.id,
    placeId,
    startedAt: new Date(Date.UTC(2026, 9, day, 9)),
    finishedAt: new Date(Date.UTC(2026, 9, day, 10)),
    startedOn: `2026-10-0${String(day)}`,
    finishedOn: `2026-10-0${String(day)}`,
  })
  const itemId = await insertItem(db, { name: `Корм ${randomUUID()}`, searchKey: 'korm' })
  await db.insert(expenses).values({
    id: randomUUID(),
    tripId,
    itemId,
    amountMinor: 450_000n,
    amountCurrency: 'AMD',
  })
  return tripId
}

async function month(me: Owner, knowsCategory: boolean) {
  const response = await app.inject({
    url: '/money/months/2026-10',
    headers: {
      cookie: me.cookie,
      'x-molvia-today': '2026-10-20',
      ...(knowsCategory ? { [MONEY_TRIP_CATEGORY_HEADER]: '1' } : {}),
    },
  })
  expect(response.statusCode, response.body).toBe(200)
  return { view: moneyMonthCodec.parse(response.json()), raw: response.body }
}

describe('PUT /trips/:id/category (MOL-400)', () => {
  it('moves the trip’s money into the category in the month, answered by the header', async () => {
    const me = await owner()
    const place = await insertPlace(db, { name: `Зоомагазин ${randomUUID()}` })
    const tripId = await finishedTrip(me, place)
    const pets = await presetId(me, 'pets')
    const groceries = await presetId(me, 'groceries')

    const before = await month(me, true)
    expect(before.view.byCategory.map((one) => one.categoryId)).toEqual([groceries])

    const response = await categorize(me, tripId.toUpperCase(), pets)
    expect(response.statusCode).toBe(204)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(await categoryOf(tripId)).toBe(pets)
    // the same again is the same state: the queue sends it twice
    expect((await categorize(me, tripId, pets)).statusCode).toBe(204)

    const after = await month(me, true)
    expect(after.view.byCategory).toEqual([
      { categoryId: pets, amount: { minor: 450_000n, currency: 'AMD' } },
    ])
    const row = after.view.days[0]?.entries[0]
    expect(row?.kind === 'trip' ? row.categoryId : undefined).toBe(pets)

    // a phone of an earlier build reads the month strictly: no field it does not know
    const earlier = await month(me, false)
    const wire = z
      .object({ days: z.array(z.object({ entries: z.array(z.record(z.string(), z.unknown())) })) })
      .parse(JSON.parse(earlier.raw))
    expect(Object.keys(wire.days[0]?.entries[0] ?? {})).not.toContain('categoryId')
    expect(earlier.view.byCategory[0]?.categoryId).toBe(pets)
  })

  it('takes a removed category of the owner’s, and one not the owner’s moves nothing (А1)', async () => {
    const me = await owner()
    const stranger = await owner()
    const place = await insertPlace(db, { name: `Кафе ${randomUUID()}` })
    const tripId = await finishedTrip(me, place)
    const cafe = await presetId(me, 'cafe')
    await db
      .update(spendingCategories)
      .set({ archivedAt: new Date() })
      .where(eq(spendingCategories.id, cafe))

    expect((await categorize(me, tripId, cafe)).statusCode).toBe(204)
    expect(await categoryOf(tripId)).toBe(cafe)

    // someone else's, or one still on its way in the spendings' queue: the trip keeps «Кафе»
    const theirs = await presetId(stranger, 'cafe')
    expect((await categorize(me, tripId, theirs)).statusCode).toBe(204)
    expect((await categorize(me, tripId, randomUUID())).statusCode).toBe(204)
    expect(await categoryOf(tripId)).toBe(cafe)
  })

  it('answers a stranger’s, a missing and a removed trip as one 404', async () => {
    const me = await owner()
    const stranger = await owner()
    const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
    const theirs = await finishedTrip(stranger, place)
    const mine = await finishedTrip(me, place)
    await db.update(trips).set({ deletedAt: new Date() }).where(eq(trips.id, mine))
    const cafe = await presetId(me, 'cafe')

    for (const tripId of [theirs, mine, randomUUID(), 'not-a-trip']) {
      expect((await categorize(me, tripId, cafe)).statusCode, tripId).toBe(404)
      // a category not the owner's on a trip not the owner's is the same 404
      expect((await categorize(me, tripId, randomUUID())).statusCode, tripId).toBe(404)
    }
    expect(await categoryOf(theirs)).toBeNull()
    expect((await categorize(me, mine, 'not-an-id')).statusCode).toBe(400)
  })

  it('names the trip’s category in the journal of its account', async () => {
    const me = await owner()
    const place = await insertPlace(db, { name: `Аптека ${randomUUID()}` })
    const tripId = await finishedTrip(me, place)
    const health = await presetId(me, 'health')
    await categorize(me, tripId, health)
    // «не попали» are asked of a currency with an account, started before the trip
    const account = await app.inject({
      method: 'POST',
      url: '/money/accounts',
      headers: { cookie: me.cookie, 'x-molvia-today': '2026-10-01' },
      payload: {
        id: randomUUID(),
        name: 'Наличные',
        currency: 'AMD',
        savings: false,
        start: { amount: '100000', currency: 'AMD' },
        startOn: '2026-10-01',
      },
    })
    expect(account.statusCode, account.body).toBe(201)
    const response = await app.inject({
      url: '/money/accounts/unassigned',
      headers: { cookie: me.cookie, 'x-molvia-today': '2026-10-20' },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.body).toContain(`"categoryId":"${health}"`)
  })
})

describe('GET /trips/place-categories (MOL-400, Р-6)', () => {
  it('is the category of the last finished trip at each place, the person’s own', async () => {
    const me = await owner()
    const stranger = await owner()
    const zoo = await insertPlace(db, { name: `Зоомагазин ${randomUUID()}` })
    const cafe = await insertPlace(db, { name: `Кафе ${randomUUID()}` })
    const [pets, groceries, cafes] = [
      await presetId(me, 'pets'),
      await presetId(me, 'groceries'),
      await presetId(me, 'cafe'),
    ]

    await categorize(me, await finishedTrip(me, zoo, 1), groceries)
    await categorize(me, await finishedTrip(me, zoo, 3), pets)
    // a later trip with no category says nothing; a removed and an open one neither
    await finishedTrip(me, zoo, 4)
    const removed = await finishedTrip(me, zoo, 6)
    await categorize(me, removed, cafes)
    await db.update(trips).set({ deletedAt: new Date() }).where(eq(trips.id, removed))
    const open = await insertTrip(db, { actorId: me.id, placeId: zoo, categoryId: cafes })
    expect(open).toBeTruthy()
    await categorize(me, await finishedTrip(me, cafe, 2), cafes)
    await categorize(
      stranger,
      await finishedTrip(stranger, cafe, 7),
      await presetId(stranger, 'pets'),
    )

    const response = await app.inject({
      url: '/trips/place-categories',
      headers: { cookie: me.cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const { places } = placeCategoriesCodec.parse(response.json())
    expect(sorted(places.map((one) => `${one.placeId}:${one.categoryId}`))).toEqual(
      sorted([`${zoo}:${pets}`, `${cafe}:${cafes}`]),
    )
  })
})
