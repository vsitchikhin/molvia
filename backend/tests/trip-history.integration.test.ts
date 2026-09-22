import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { ERROR, tripHistoryCodec, tripViewCodec } from '@molvia/model'
import { createTripRepository } from '@/db/trips-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { insertActor, insertPlace, insertTrip, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const app = buildServer({ db })
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await close()
})

describe('history of completed trips', () => {
  it('returns none for a new owner and never exposes another owner', async () => {
    const actor = await insertActor(db)
    const other = await insertActor(db)
    const place = await insertPlace(db)
    const trip = await insertTrip(db, { actorId: other, placeId: place })
    const cookie = await signIn(db, actor)
    const page = await app.inject({ url: '/trips/history', headers: { cookie } })
    expect(page.headers['cache-control']).toBe('no-store')
    expect(tripHistoryCodec.parse(page.json())).toEqual({ trips: [], nextCursor: null })
    for (const id of [trip, randomUUID(), 'not-a-uuid']) {
      const answer = await app.inject({ url: `/trips/${id}`, headers: { cookie } })
      expect(answer.statusCode).toBe(404)
      expect(answer.json()).toMatchObject({ code: ERROR.NOT_FOUND })
    }
    expect((await app.inject({ url: '/trips/history' })).statusCode).toBe(401)
  })

  it('keeps the first device time even when it is before the server start', async () => {
    const actor = await insertActor(db)
    const place = await insertPlace(db)
    const id = await insertTrip(db, { actorId: actor, placeId: place })
    const cookie = await signIn(db, actor)
    const finish = (time: string) =>
      app.inject({
        method: 'POST',
        url: `/trips/${id.toUpperCase()}/finish`,
        headers: { cookie },
        payload: { finishedOnDeviceAt: time },
      })
    expect((await finish('2026-01-01T10:00:00.000Z')).statusCode).toBe(204)
    const read = async () =>
      tripViewCodec.parse(
        (await app.inject({ url: `/trips/${id.toUpperCase()}`, headers: { cookie } })).json(),
      )
    const first = await read()
    expect(first.id).toBe(id)
    expect(first.finishedOnDeviceAt).toEqual(new Date('2026-01-01T10:00:00Z'))
    expect(first.finishedAt?.getTime()).toBeGreaterThanOrEqual(first.startedAt.getTime())
    expect((await finish('2026-02-01T10:00:00.000Z')).statusCode).toBe(204)
    expect(await read()).toEqual(first)
  })

  it.each([19, 20, 21])(
    'paginates %i completed rows without losing microsecond boundaries',
    async (count) => {
      const actor = await insertActor(db)
      const place = await insertPlace(db)
      const ids: string[] = []
      for (let i = 0; i < count; i += 1) {
        const id = await insertTrip(db, {
          actorId: actor,
          placeId: place,
          startedAt: new Date('2026-01-01T00:00:00Z'),
        })
        ids.push(id)
        await db.execute(
          sql`update trips set finished_at = '2026-01-02 00:00:00.123456+00'::timestamptz where id = ${id}`,
        )
      }
      // An unfinished row must not use up a slot in the history.
      await insertTrip(db, { actorId: actor, placeId: place })
      const repo = createTripRepository(db)
      const first = await repo.history(actor)
      expect(first.trips).toHaveLength(Math.min(count, 20))
      expect(first.nextCursor !== null).toBe(count > 20)
      const second = first.nextCursor ? await repo.history(actor, first.nextCursor) : null
      expect([...first.trips, ...(second?.trips ?? [])].map((trip) => trip.id)).toEqual(
        ids.sort().reverse(),
      )
      if (second) expect(second.nextCursor).toBeNull()
    },
  )

  it('sorts by device completion with a server fallback for legacy rows', async () => {
    const actor = await insertActor(db)
    const place = await insertPlace(db)
    const legacy = await insertTrip(db, {
      actorId: actor,
      placeId: place,
      startedAt: new Date('2026-01-01'),
      finishedAt: new Date('2026-01-03'),
    })
    const delayed = await insertTrip(db, {
      actorId: actor,
      placeId: place,
      startedAt: new Date('2026-01-04'),
      finishedAt: new Date('2026-01-05'),
      finishedOnDeviceAt: new Date('2026-01-02'),
    })
    const page = await createTripRepository(db).history(actor)
    expect(page.trips.map((trip) => trip.id)).toEqual([legacy, delayed])
  })

  it('rejects invalid device timestamps and incomplete cursors', async () => {
    const actor = await insertActor(db)
    const cookie = await signIn(db, actor)
    const id = await insertTrip(db, { actorId: actor, placeId: await insertPlace(db) })
    for (const time of ['tomorrow', '2026-02-31T00:00:00Z', 42]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/trips/${id}/finish`,
            headers: { cookie },
            payload: { finishedOnDeviceAt: time },
          })
        ).statusCode,
      ).toBe(400)
    }
    expect(
      (await app.inject({ url: '/trips/history?before=2026-01-01T00:00:00Z', headers: { cookie } }))
        .statusCode,
    ).toBe(400)
    expect((await createTripRepository(db).byId(id, actor))?.finishedAt).toBeNull()
  })
})
