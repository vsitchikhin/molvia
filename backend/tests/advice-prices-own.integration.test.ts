/**
 * «Тут дешевле» through the server (MOL-92): `GET /advice/prices` — the person's own last prices of
 * an item in the record's city, and the other items of its kind with the rating «Что брать» shows.
 * The corners are «Что проверяют тесты» of `plans/MOL-92.md`.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  ZONE_HEADER,
  ownNeverResponseSchema,
  ownPricesResponseSchema,
  toSearchKey,
  unitPrice,
} from '@molvia/model'
import type { Money, OwnPrices, OwnPricesResponse, Quantity } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, events, expenses, searchPicks, trips, verdicts } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

const { db, close } = connectDrizzle()

let app: FastifyInstance

const litre: Quantity = { milli: 1000n, unit: 'l' }
const amd = (minor: number): Money => ({ minor: BigInt(minor), currency: 'AMD' })
const perLitre = (amount: number) => unitPrice(amd(amount * 100), litre).scaledMinor

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

interface Asked {
  readonly item: string
  readonly city?: string
  /** A record the server holds, named instead of a city (review №1). */
  readonly trip?: string
  readonly except?: string
  readonly zone?: string
}

async function ask(actor: string | null, { item, city = 'Ереван', trip, except, zone }: Asked) {
  const query = new URLSearchParams(trip ? { item, trip } : { item, country: 'AM', city })
  if (except) query.set('except', except)
  const headers: Record<string, string> = {}
  if (actor !== null) headers.cookie = await signIn(db, actor)
  if (zone) headers[ZONE_HEADER] = zone
  const response = await app.inject({
    method: 'GET',
    url: `/advice/prices?${query.toString()}`,
    headers,
  })
  return { status: response.statusCode, headers: response.headers, body: response.body }
}

/** Read through the contract the client parses — a server that drifted from it fails here. */
async function answered(actor: string, asked: Asked): Promise<OwnPricesResponse> {
  const reply = await ask(actor, asked)
  expect(reply.status).toBe(200)
  return ownPricesResponseSchema.parse(JSON.parse(reply.body))
}

async function prices(actor: string, asked: Asked): Promise<OwnPrices> {
  return (await answered(actor, asked)).prices
}

const item = (name: string, kind: 'product' | 'dish' = 'product') =>
  insertItem(db, { name, searchKey: toSearchKey(name), kind })

const erevan = (name: string) => insertPlace(db, { name, city: 'Ереван' })

async function rate(actorId: string, itemId: string, score: number) {
  await db
    .insert(verdicts)
    .values({ id: randomUUID(), actorId, itemId, itemKind: 'product', score })
}

interface Bought {
  readonly on?: string | null
  readonly at?: Date
  readonly amount?: Money | null
  readonly quantity?: Quantity | null
  readonly tripId?: string
}

/** A purchase in its own record unless one is named; returns the purchase and its record. */
async function bought(
  actorId: string,
  itemId: string,
  placeId: string,
  price: number,
  extra: Bought = {},
) {
  const tripId =
    extra.tripId ??
    (await insertTrip(db, {
      actorId,
      placeId,
      startedOn: extra.on === undefined ? '2026-09-12' : extra.on,
      ...(extra.at ? { startedAt: extra.at } : {}),
    }))
  const amount = extra.amount === undefined ? amd(price * 100) : extra.amount
  const quantity = extra.quantity === undefined ? litre : extra.quantity
  const id = randomUUID()
  await db.insert(expenses).values({
    id,
    tripId,
    itemId,
    qtyMilli: quantity?.milli ?? null,
    qtyUnit: quantity?.unit ?? null,
    amountMinor: amount?.minor ?? null,
    amountCurrency: amount?.currency ?? null,
  })
  return { id, tripId }
}

function placesOf(answer: OwnPrices) {
  if (answer.level === 'never') throw new Error('a «never» answer has no places')
  return answer.places.map((place) => ({
    name: place.name,
    price: place.unitPrice.scaledMinor,
    day: place.day,
    observations: place.observations,
  }))
}

describe('GET /advice/prices — the item’s own places', () => {
  it('names the last price of a place, not its lowest — «цены поднимаются, а спускаются редко» (В-3)', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, milk, zovuni, 540, { on: '2026-06-12' })
    await bought(me, milk, zovuni, 600, { on: '2026-09-12' })
    await bought(me, milk, zovuni, 590, { on: '2026-08-20' })

    expect(placesOf(await prices(me, { item: milk }))).toEqual([
      { name: 'Зовуни', price: perLitre(600), day: '2026-09-12', observations: 3 },
    ])
  })

  it('puts the cheapest last price first, and leaves another city out (В-4)', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Ереван Сити'), 600, { on: '2026-09-03' })
    await bought(me, milk, await erevan('Зовуни'), 540)
    await bought(me, milk, await insertPlace(db, { name: 'SAS', city: 'Гюмри' }), 400)

    expect(placesOf(await prices(me, { item: milk })).map((place) => place.name)).toEqual([
      'Зовуни',
      'Ереван Сити',
    ])
    expect(
      placesOf(await prices(me, { item: milk, city: 'Гюмри' })).map((place) => place.name),
    ).toEqual(['SAS'])
  })

  it('reads the city by the fold places are stored under', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Зовуни'), 540)

    expect(placesOf(await prices(me, { item: milk, city: 'ЕРЕВАН' }))).toHaveLength(1)
  })

  it('takes two packs of one record by the later row', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    const first = await bought(me, milk, zovuni, 540)
    await db.execute(sql`select pg_sleep(0.01)`)
    await bought(me, milk, zovuni, 560, { tripId: first.tripId })

    expect(placesOf(await prices(me, { item: milk }))[0]).toMatchObject({
      price: perLitre(560),
      observations: 2,
    })
  })

  it('leaves out the purchase the sheet amends, and only it (Т-9, Р-4)', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    const first = await bought(me, milk, zovuni, 540)
    await db.execute(sql`select pg_sleep(0.01)`)
    const second = await bought(me, milk, zovuni, 560, { tripId: first.tripId })

    expect(placesOf(await prices(me, { item: milk, except: second.id }))[0]?.price).toBe(
      perLitre(540),
    )
    expect(
      placesOf(await prices(me, { item: milk, except: second.id.toUpperCase() }))[0]?.price,
    ).toBe(perLitre(540))
    expect(placesOf(await prices(me, { item: milk, except: first.id }))[0]?.price).toBe(
      perLitre(560),
    )
  })

  it('shows none of a stranger’s prices, with access or without (Т-1)', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, milk, zovuni, 600)
    for (const price of [400, 410, 420]) await bought(await insertActor(db), milk, zovuni, price)
    await bought(await insertActor(db), milk, await erevan('Ташир'), 300)

    const without = placesOf(await prices(me, { item: milk }))
    await db
      .update(actors)
      .set({ sharedUntil: sql`now() + interval '30 days'` })
      .where(eq(actors.id, me))
    const withAccess = placesOf(await prices(me, { item: milk }))

    expect(without).toEqual([
      { name: 'Зовуни', price: perLitre(600), day: '2026-09-12', observations: 1 },
    ])
    expect(withAccess).toEqual(without)
  })

  it('leaves out a removed record and a row without a price or a quantity', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, milk, zovuni, 600)
    const removed = await bought(me, milk, await erevan('Ташир'), 300)
    await db.update(trips).set({ deletedAt: new Date() }).where(eq(trips.id, removed.tripId))
    await bought(me, milk, await erevan('Ереван Сити'), 0, { amount: null })
    await bought(me, milk, await erevan('Гранд Кэнди'), 300, { quantity: null })

    expect(placesOf(await prices(me, { item: milk })).map((place) => place.name)).toEqual([
      'Зовуни',
    ])
  })

  it('keeps currencies and units apart, each its own row', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, milk, zovuni, 540)
    await bought(me, milk, zovuni, 0, { amount: { minor: 15_000n, currency: 'RUB' } })
    await bought(me, milk, zovuni, 600, { quantity: { milli: 1000n, unit: 'piece' } })

    const answer = await prices(me, { item: milk })
    expect(
      answer.level !== 'never' &&
        answer.places.map((place) => place.unitPrice.currency + place.unitPrice.unit),
    ).toEqual(['AMDl', 'AMDpiece', 'RUBl'])
  })

  it('dates a record from an old queue by its moment in the zone of the request (MOL-121)', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    // 22:30 in Yerevan on the 12th is already the 13th in Tokyo.
    await bought(me, milk, await erevan('Зовуни'), 540, {
      on: null,
      at: new Date('2026-09-12T18:30:00Z'),
    })

    expect(placesOf(await prices(me, { item: milk }))[0]?.day).toBe('2026-09-12')
    expect(placesOf(await prices(me, { item: milk, zone: 'Asia/Tokyo' }))[0]?.day).toBe(
      '2026-09-13',
    )
  })
})

describe('GET /advice/prices — «last» in the zone of the request (review №3)', () => {
  it('orders a record from an old queue by its day in the zone its day is printed in', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    // No day of its own: 01:30 of the 13th in Yerevan, 14:30 of the 12th in Los Angeles.
    await bought(me, milk, zovuni, 540, { on: null, at: new Date('2026-09-12T21:30:00Z') })
    // The 12th as its phone named it, begun later in the evening.
    await bought(me, milk, zovuni, 600, { on: '2026-09-12', at: new Date('2026-09-12T23:00:00Z') })

    expect(placesOf(await prices(me, { item: milk }))[0]).toMatchObject({
      price: perLitre(540),
      day: '2026-09-13',
    })
    expect(
      placesOf(await prices(me, { item: milk, zone: 'America/Los_Angeles' }))[0],
    ).toMatchObject({ price: perLitre(600), day: '2026-09-12' })
  })
})

describe('GET /advice/prices — a zone Postgres does not know (adversarial Ж)', () => {
  it('orders a record from an old queue by Yerevan’s day rather than answering 500', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Зовуни'), 540, {
      on: null,
      at: new Date('2026-09-12T10:00:00Z'),
    })

    // `Intl` knows the name, tzdata does not.
    const reply = await ask(me, { item: milk, zone: 'US/Pacific-New' })

    expect(reply.status).toBe(200)
    const answer = ownPricesResponseSchema.parse(JSON.parse(reply.body))
    expect(placesOf(answer.prices)).toHaveLength(1)
  })
})

describe('GET /verdicts/never — one’s own «не брать нигде» (adversarial Б′)', () => {
  async function never(actor: string): Promise<string[]> {
    const response = await app.inject({
      method: 'GET',
      url: '/verdicts/never',
      headers: { cookie: await signIn(db, actor) },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    return ownNeverResponseSchema.parse(JSON.parse(response.body)).itemIds.sort()
  }

  it('lists one’s own «1» and «2», not «3», not a withdrawn one, not a stranger’s', async () => {
    const me = await insertActor(db)
    const stranger = await insertActor(db)
    const [one, two, three, withdrawn, theirs] = await Promise.all(
      ['Молоко 1', 'Молоко 2', 'Молоко 3', 'Молоко 4', 'Молоко 5'].map((name) => item(name)),
    )
    if (!one || !two || !three || !withdrawn || !theirs) throw new Error('no items')
    await rate(me, one, 1)
    await rate(me, two, 2)
    await rate(me, three, 3)
    await rate(me, withdrawn, 1)
    await db
      .update(verdicts)
      .set({ deletedAt: sql`clock_timestamp()` })
      .where(eq(verdicts.itemId, withdrawn))
    await rate(stranger, theirs, 1)

    expect(await never(me)).toEqual([one, two].sort())
  })

  it('lists one’s own «1» with access while three strangers’ «5» put it in «Брать» on «Что брать»', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await rate(me, milk, 1)
    for (let n = 0; n < 3; n += 1) await rate(await insertActor(db), milk, 5)
    await db
      .update(actors)
      .set({ sharedUntil: sql`now() + interval '30 days'` })
      .where(eq(actors.id, me))

    expect(await never(me)).toEqual([milk])
  })
})

describe('GET /advice/prices — the record names the city (review №1)', () => {
  it('reads the city off the place of a record held on the server, not off the settings', async () => {
    // Settings say Gyumri; the record is in an Erevan shop.
    const me = await insertActor(db, { city: 'Гюмри' })
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Зовуни'), 540)
    await bought(me, milk, await insertPlace(db, { name: 'SAS', city: 'Гюмри' }), 400)
    const record = await insertTrip(db, { actorId: me, placeId: await erevan('Ереван Сити') })

    const answer = await answered(me, { item: milk, trip: record.toUpperCase() })

    expect(answer.where).toEqual({ country: 'AM', city: 'Ереван' })
    expect(placesOf(answer.prices).map((place) => place.name)).toEqual(['Зовуни'])
  })

  it('answers empty, with no city, for a record of someone else’s, a removed one or none', async () => {
    const me = await insertActor(db)
    const stranger = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, milk, zovuni, 540)
    const theirs = await insertTrip(db, { actorId: stranger, placeId: zovuni })
    const removed = await insertTrip(db, { actorId: me, placeId: zovuni, deletedAt: new Date() })

    for (const trip of [theirs, removed, randomUUID()]) {
      expect(await answered(me, { item: milk, trip })).toEqual({
        where: null,
        prices: { itemId: milk, level: 'unrated', places: [], alternatives: [] },
      })
    }
  })
})

describe('GET /advice/prices — the level', () => {
  it('answers «не брать нигде» with no prices at all (Т-3), and prices again once withdrawn', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Зовуни'), 540)
    await rate(me, milk, 1)

    expect(JSON.parse((await ask(me, { item: milk })).body)).toEqual({
      where: { country: 'AM', city: 'Ереван' },
      prices: { itemId: milk, level: 'never' },
    })

    await db
      .update(verdicts)
      .set({ deletedAt: sql`clock_timestamp()` })
      .where(eq(verdicts.itemId, milk))
    expect(await prices(me, { item: milk })).toMatchObject({
      level: 'unrated',
      places: [{ name: 'Зовуни' }],
    })
  })

  it('carries the level and the rating «Что брать» shows', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Зовуни'), 540)
    await rate(me, milk, 3)

    expect(await prices(me, { item: milk })).toMatchObject({ level: 'if_cheap', rating: '3.0' })
  })

  it('has nothing for a dish (Р-1), nor for an item the catalogue does not hold', async () => {
    const me = await insertActor(db)
    const dish = await item('Хоровац', 'dish')
    await bought(me, dish, await erevan('Таверна'), 3000)
    const nobody = randomUUID()

    expect(await prices(me, { item: dish })).toEqual({
      itemId: dish,
      level: 'unrated',
      places: [],
      alternatives: [],
    })
    expect(await prices(me, { item: nobody.toUpperCase() })).toEqual({
      itemId: nobody,
      level: 'unrated',
      places: [],
      alternatives: [],
    })
  })
})

describe('GET /advice/prices — one’s own verdicts, with access or without (adversarial Д)', () => {
  const grant = (actorId: string) =>
    db
      .update(actors)
      .set({ sharedUntil: sql`now() + interval '30 days'` })
      .where(eq(actors.id, actorId))

  it('keeps one’s own prices on one’s own «5» whatever three strangers gave', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Зовуни'), 540)
    await rate(me, milk, 5)
    for (let n = 0; n < 3; n += 1) await rate(await insertActor(db), milk, 1)

    const without = await prices(me, { item: milk })
    await grant(me)
    const withAccess = await prices(me, { item: milk })

    expect(without).toMatchObject({ level: 'take', rating: '5.0', places: [{ name: 'Зовуни' }] })
    expect(withAccess).toEqual(without)
  })

  it('offers no alternative rated only by strangers', async () => {
    const me = await insertActor(db)
    const anelik = await item('Молоко Анелик 1 л')
    const marianna = await item('Молоко Марианна 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, anelik, zovuni, 620)
    await rate(me, anelik, 4)
    await bought(me, marianna, zovuni, 480)
    for (let n = 0; n < 3; n += 1) await rate(await insertActor(db), marianna, 5)
    await grant(me)

    const answer = await prices(me, { item: anelik })
    expect(answer.level !== 'never' && answer.alternatives).toEqual([])
  })
})

describe('GET /advice/prices — another item of the kind (В-3, В-7)', () => {
  it('brings one’s own rated products of the same word of the kind, with their last prices', async () => {
    const me = await insertActor(db)
    const ashhar = await item('Молоко Ашхар 1 л')
    const marianna = await item('Молоко Марианна 3,2% 1 л')
    const condensed = await item('Молоко сгущённое Рогачёв')
    const kefir = await item('Кефир Марианна 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, ashhar, zovuni, 620)
    await bought(me, marianna, zovuni, 480, { on: '2026-09-28' })
    await bought(me, condensed, zovuni, 900, { quantity: { milli: 1000n, unit: 'piece' } })
    await bought(me, kefir, zovuni, 450)
    await rate(me, marianna, 5)
    await rate(me, condensed, 4)
    await rate(me, kefir, 5)

    const answer = await prices(me, { item: ashhar })
    expect(answer.level !== 'never' && answer.alternatives).toEqual([
      expect.objectContaining({ itemId: marianna, level: 'take', rating: '5.0' }),
      expect.objectContaining({ itemId: condensed, level: 'take', rating: '4.0' }),
    ])
    const places = answer.level === 'never' ? [] : (answer.alternatives[0]?.places ?? [])
    expect(places.map((place) => [place.name, place.day, place.unitPrice.unit])).toEqual([
      ['Зовуни', '2026-09-28', 'l'],
    ])
  })

  it('brings none that is unrated, «не брать нигде», bought only elsewhere, or only by a stranger', async () => {
    const me = await insertActor(db)
    const stranger = await insertActor(db)
    const ashhar = await item('Молоко Ашхар 1 л')
    const unrated = await item('Молоко Анелик 1 л')
    const never = await item('Молоко Бюрегаван 1 л')
    const gyumri = await item('Молоко Гюмри 1 л')
    const theirs = await item('Молоко Дилижан 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, ashhar, zovuni, 620)
    await bought(me, unrated, zovuni, 400)
    await bought(me, never, zovuni, 400)
    await rate(me, never, 1)
    await bought(me, gyumri, await insertPlace(db, { name: 'SAS', city: 'Гюмри' }), 400)
    await rate(me, gyumri, 5)
    await bought(stranger, theirs, zovuni, 400)
    await rate(me, theirs, 5)

    const answer = await prices(me, { item: ashhar })
    expect(answer.level !== 'never' && answer.alternatives).toEqual([])
  })

  it('carries alternatives beside an item not rated', async () => {
    const me = await insertActor(db)
    const ashhar = await item('Молоко Ашхар 1 л')
    const marianna = await item('Молоко Марианна 1 л')
    const zovuni = await erevan('Зовуни')
    await bought(me, ashhar, zovuni, 620)
    await bought(me, marianna, zovuni, 480)
    await rate(me, marianna, 4)

    expect(await prices(me, { item: ashhar })).toMatchObject({
      level: 'unrated',
      alternatives: [{ itemId: marianna, rating: '4.0' }],
    })
  })
})

describe('GET /advice/prices — the request', () => {
  it('writes nothing — no visit, no pick (Т-6)', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')
    await bought(me, milk, await erevan('Зовуни'), 540)
    await db
      .update(actors)
      .set({ sharedUntil: sql`now() + interval '30 days'` })
      .where(eq(actors.id, me))

    const reply = await ask(me, { item: milk })

    expect(reply.status).toBe(200)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(await db.select().from(events)).toEqual([])
    expect(await db.select().from(searchPicks)).toEqual([])
  })

  it('refuses a malformed query, and a request with no session', async () => {
    const me = await insertActor(db)
    const milk = await item('Молоко Ашхар 1 л')

    expect((await ask(me, { item: 'milk' })).status).toBe(400)
    expect((await ask(me, { item: milk, except: 'row' })).status).toBe(400)
    expect((await ask(me, { item: milk, trip: 'record' })).status).toBe(400)
    expect((await ask(null, { item: milk })).status).toBe(401)
  })
})
