import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { actorCodec, ERROR, settingsOf, tripViewCodec } from '@molvia/model'
import type { ActorSettings } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, places } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()
let app: FastifyInstance
const initial: ActorSettings = {
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
}
const changed: ActorSettings = {
  ...initial,
  city: 'Ереван',
  spendCurrency: 'USD',
  incomeCurrency: 'EUR',
}
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

async function save(cookie: string, previous: ActorSettings, settings: ActorSettings) {
  return app.inject({
    method: 'PUT',
    url: '/actors/me/settings',
    headers: { cookie },
    payload: { previous, settings },
  })
}

describe('settings and offline trip context', () => {
  it('changes only the session owner, keeps identity/access, and accepts an exact repeat', async () => {
    const owner = await insertActor(db, { sharedUntil: new Date('2030-01-01') })
    const other = await insertActor(db)
    const cookie = await signIn(db, owner)
    const response = await save(cookie, initial, changed)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(settingsOf(actorCodec.parse(response.json()))).toEqual(changed)
    expect((await save(cookie, initial, changed)).statusCode).toBe(200)
    const rows = await db.select().from(actors)
    expect(rows.find((row) => row.id === other)).toMatchObject(initial)
    expect(rows.find((row) => row.id === owner)).toMatchObject({
      sharedUntil: new Date('2030-01-01'),
    })
    const extra = await app.inject({
      method: 'PUT',
      url: '/actors/me/settings',
      headers: { cookie },
      payload: { previous: changed, settings: initial, actorId: other },
    })
    expect(extra.statusCode).toBe(400)
  })

  it('two devices cannot overwrite one another from the same base', async () => {
    const owner = await insertActor(db)
    const first = await signIn(db, owner)
    const second = await signIn(db, owner)
    const replies = await Promise.all([
      save(first, initial, changed),
      save(second, initial, { ...initial, incomeCurrency: 'USD' }),
    ])
    expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 409])
    expect(replies.find((reply) => reply.statusCode === 409)?.json()).toMatchObject({
      code: ERROR.CONFLICT,
    })
    // Unrelated account changes are not a settings conflict.
    await db
      .update(actors)
      .set({ sharedUntil: new Date('2031-01-01') })
      .where(eq(actors.id, owner))
    const winner = actorCodec.parse(replies.find((reply) => reply.statusCode === 200)?.json())
    expect((await save(first, settingsOf(winner), initial)).statusCode).toBe(200)
  })

  it('requires a session and rejects unsupported new geography while preserving historical values', async () => {
    const owner = await insertActor(db, { country: 'GE', city: 'Тбилиси' })
    const cookie = await signIn(db, owner)
    const legacy = { ...initial, country: 'GE', city: 'Тбилиси' }
    expect((await save('', legacy, legacy)).statusCode).toBe(401)
    expect((await save(cookie, legacy, { ...legacy, incomeCurrency: 'AMD' })).statusCode).toBe(200)
    expect((await save(cookie, legacy, { ...legacy, city: 'Батуми' })).statusCode).toBe(400)
    expect((await save(cookie, { ...legacy, incomeCurrency: 'AMD' }, initial)).statusCode).toBe(200)
  })

  it('starts a queued trip in its captured city/currencies after another device changes settings', async () => {
    const owner = await insertActor(db)
    const cookie = await signIn(db, owner)
    await save(cookie, initial, changed)
    const id = randomUUID()
    const response = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { cookie },
      payload: { id, context: initial, place: { kind: 'store', name: 'SAS' } },
    })
    expect(response.statusCode).toBe(201)
    const trip = tripViewCodec.parse(response.json())
    expect(trip.currency).toBe('AMD')
    expect(await db.select().from(places).where(eq(places.id, trip.place.id))).toMatchObject([
      { country: 'AM', city: 'Гюмри' },
    ])
    const repeat = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { cookie },
      payload: { id, place: { kind: 'store', name: 'SAS' } },
    })
    expect(repeat.statusCode).toBe(200)
    expect(repeat.json()).toEqual(response.json())
    const here = await app.inject({
      method: 'GET',
      url: '/places/recent?country=AM&city=' + encodeURIComponent('Гюмри'),
      headers: { cookie },
    })
    const there = await app.inject({
      method: 'GET',
      url: '/places/recent?country=AM&city=' + encodeURIComponent('Ереван'),
      headers: { cookie },
    })
    expect(here.json()).toMatchObject({ places: [{ name: 'SAS' }] })
    expect(there.json()).toEqual({ places: [] })
  })

  it('refuses a trip in a geography the settings would refuse, and keeps the historical one', async () => {
    const owner = await insertActor(db, { country: 'GE', city: 'Тбилиси' })
    const cookie = await signIn(db, owner)
    const start = async (context: ActorSettings, name: string) =>
      app.inject({
        method: 'POST',
        url: '/trips',
        headers: { cookie },
        payload: { id: randomUUID(), context, place: { kind: 'store', name } },
      })
    const legacy = { ...initial, country: 'GE', city: 'Тбилиси' }
    expect((await start({ ...initial, city: 'Батуми' }, 'Гудвилл')).statusCode).toBe(400)
    expect((await start({ ...initial, country: 'ZZ', city: 'Нигде' }, 'Лавка')).statusCode).toBe(
      400,
    )
    // The city is the one the person holds, so the trip is theirs to start; and so is one of
    // today's two, which is what an offline start made before a move carries.
    expect((await start(legacy, 'Гудвилл')).statusCode).toBe(201)
    expect((await start(initial, 'SAS')).statusCode).toBe(409)
    expect(await db.select({ city: places.city }).from(places)).toEqual([{ city: 'Тбилиси' }])
  })

  it('finds a place whose city was written in another case, and ignores a stray query parameter', async () => {
    const owner = await insertActor(db)
    const cookie = await signIn(db, owner)
    const recent = async (query: string) =>
      app.inject({ method: 'GET', url: `/places/recent${query}`, headers: { cookie } })
    const response = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { cookie },
      payload: {
        id: randomUUID(),
        context: { ...initial, city: 'гюмри' },
        place: { kind: 'store', name: 'SAS' },
      },
    })
    expect(response.statusCode).toBe(400)
    await db.insert(places).values({
      id: randomUUID(),
      kind: 'store',
      name: 'SAS',
      country: 'AM',
      city: 'гюмри',
    })
    const started = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { cookie },
      payload: { id: randomUUID(), context: initial, place: { kind: 'store', name: 'SAS' } },
    })
    expect(started.statusCode).toBe(201)
    const city = encodeURIComponent('Гюмри')
    expect((await recent(`?country=AM&city=${city}`)).json()).toMatchObject({
      places: [{ name: 'SAS' }],
    })
    // A parameter this server never wrote — a cache-buster, one a portal appended — and half
    // a pair: answered, and answered without a filter, never with 400.
    expect((await recent(`?country=AM&city=${city}&t=1`)).statusCode).toBe(200)
    expect((await recent('?t=1')).json()).toMatchObject({ places: [{ name: 'SAS' }] })
    expect((await recent('?country=AM')).json()).toMatchObject({ places: [{ name: 'SAS' }] })
    expect((await recent(`?country=am&city=${city}`)).json()).toMatchObject({
      places: [{ name: 'SAS' }],
    })
  })

  it('holds an unknown legacy start without creating a place or trip', async () => {
    const owner = await insertActor(db)
    const cookie = await signIn(db, owner)
    const response = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { cookie },
      payload: { id: randomUUID(), place: { kind: 'store', name: 'Unknown city' } },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: ERROR.TRIP_CONTEXT_REQUIRED })
    expect(await db.select().from(places)).toEqual([])
  })
})
