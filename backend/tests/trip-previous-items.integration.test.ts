import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { ERROR, previousItemsResponseSchema, toSearchKey } from '@molvia/model'
import { expenses } from '@/db/schema'
import { buildServer } from '@/server'
import { PREVIOUS_ITEMS_LIMIT } from '@/usecases/previous-items'
import { connectDrizzle } from './db'
import { insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const app = buildServer({ db })
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await close()
})

async function item(name: string): Promise<string> {
  const unique = `${name} ${randomUUID().slice(0, 8)}`
  return insertItem(db, { name: unique, searchKey: toSearchKey(unique) })
}

/** Purchases in the order given, a millisecond apart, so «first bought» is never a tie. */
async function bought(tripId: string, itemIds: readonly string[], from = Date.UTC(2026, 9, 1)) {
  let at = from
  for (const itemId of itemIds) {
    await db.insert(expenses).values({ id: randomUUID(), tripId, itemId, createdAt: new Date(at) })
    at += 1
  }
}

function finished(day: number, deviceDay?: number) {
  return {
    startedAt: new Date(Date.UTC(2026, 9, day, 9)),
    finishedAt: new Date(Date.UTC(2026, 9, day, 10)),
    ...(deviceDay === undefined
      ? {}
      : { finishedOnDeviceAt: new Date(Date.UTC(2026, 9, deviceDay, 10)) }),
  }
}

function ask(cookie: string, tripId: string) {
  return app.inject({ url: `/trips/${tripId}/previous-items`, headers: { cookie } })
}

async function previousOf(cookie: string, tripId: string) {
  const answer = await ask(cookie, tripId)
  expect(answer.statusCode).toBe(200)
  expect(answer.headers['cache-control']).toBe('no-store')
  return previousItemsResponseSchema.parse(answer.json())
}

describe('«Брали здесь в прошлый раз» (MOL-209)', () => {
  it('answers the last finished trip at the place, its items once in the order first bought', async () => {
    const actor = await insertActor(db)
    const cookie = await signIn(db, actor)
    const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
    const [milk, bread, eggs] = [await item('Молоко'), await item('Хлеб'), await item('Яйца')]

    const older = await insertTrip(db, { actorId: actor, placeId: place, ...finished(1) })
    await bought(older, [eggs])
    const last = await insertTrip(db, { actorId: actor, placeId: place, ...finished(3) })
    await bought(last, [bread, milk, bread, eggs])
    const open = await insertTrip(db, { actorId: actor, placeId: place })

    const answer = await previousOf(cookie, open.toUpperCase())
    expect(answer.previous).toEqual({ tripId: last, at: new Date(Date.UTC(2026, 9, 3, 10)) })
    expect(answer.items.map((entry) => entry.id)).toEqual([bread, milk, eggs])
    // A catalogue card: nobody's author on the wire.
    expect(Object.keys(answer.items[0] ?? {})).not.toContain('createdBy')
  })

  it('never counts the trip itself, nor an open, removed or empty one, nor another place', async () => {
    const actor = await insertActor(db)
    const cookie = await signIn(db, actor)
    const name = `SAS ${randomUUID()}`
    const place = await insertPlace(db, { name })
    // One name in another city is another shop (MOL-120, Р-4).
    const twin = await insertPlace(db, { name, city: 'Ереван' })
    const [kept, removed, elsewhere, here] = [
      await item('Сыр'),
      await item('Мацун'),
      await item('Кефир'),
      await item('Тан'),
    ]

    const first = await insertTrip(db, { actorId: actor, placeId: place, ...finished(1) })
    await bought(first, [kept])
    const gone = await insertTrip(db, {
      actorId: actor,
      placeId: place,
      ...finished(2),
      deletedAt: new Date(),
    })
    await bought(gone, [removed])
    // Nothing in it says nothing of what was taken (Р-1): the one before speaks.
    await insertTrip(db, { actorId: actor, placeId: place, ...finished(3) })
    const yerevan = await insertTrip(db, { actorId: actor, placeId: twin, ...finished(4) })
    await bought(yerevan, [elsewhere])
    const open = await insertTrip(db, { actorId: actor, placeId: place })
    await bought(open, [here])

    const answer = await previousOf(cookie, open)
    expect(answer.previous?.tripId).toBe(first)
    expect(answer.items.map((entry) => entry.id)).toEqual([kept])

    // And from the other city's side, its own trip only — the open one in Gyumri is not finished.
    const next = await insertTrip(db, { actorId: actor, placeId: twin, ...finished(5) })
    expect((await previousOf(cookie, next)).items.map((entry) => entry.id)).toEqual([elsewhere])
  })

  it('a finished trip looks strictly before itself, in the order of «Записаны»', async () => {
    const actor = await insertActor(db)
    const cookie = await signIn(db, actor)
    const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
    const [a, b, c] = [await item('А'), await item('Б'), await item('В')]

    // Finished on the phone on the 2nd, heard by the server on the 6th: it stands on the 2nd.
    const delayed = await insertTrip(db, { actorId: actor, placeId: place, ...finished(6, 2) })
    await bought(delayed, [a])
    const middle = await insertTrip(db, { actorId: actor, placeId: place, ...finished(4) })
    await bought(middle, [b])
    const latest = await insertTrip(db, { actorId: actor, placeId: place, ...finished(7) })
    await bought(latest, [c])

    expect((await previousOf(cookie, latest)).previous?.tripId).toBe(middle)
    expect((await previousOf(cookie, middle)).previous?.tripId).toBe(delayed)
    expect(await previousOf(cookie, delayed)).toEqual({ previous: null, items: [] })
  })

  it('a removed purchase is gone from the answer', async () => {
    const actor = await insertActor(db)
    const cookie = await signIn(db, actor)
    const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
    const [kept, dropped] = [await item('Сыр'), await item('Мацун')]
    const last = await insertTrip(db, { actorId: actor, placeId: place, ...finished(1) })
    await bought(last, [kept, dropped])
    const open = await insertTrip(db, { actorId: actor, placeId: place })

    const removal = await app.inject({
      method: 'DELETE',
      url: `/trips/${last}/expenses/${await expenseOf(last, dropped)}`,
      headers: { cookie },
    })
    expect(removal.statusCode).toBe(200)
    expect((await previousOf(cookie, open)).items.map((entry) => entry.id)).toEqual([kept])
  })

  it.each([PREVIOUS_ITEMS_LIMIT - 1, PREVIOUS_ITEMS_LIMIT, PREVIOUS_ITEMS_LIMIT + 1])(
    'answers %i items bought at most the limit, the first bought',
    async (count) => {
      const actor = await insertActor(db)
      const cookie = await signIn(db, actor)
      const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
      const ids: string[] = []
      for (let i = 0; i < count; i += 1) ids.push(await item(`Позиция ${String(i)}`))
      const last = await insertTrip(db, { actorId: actor, placeId: place, ...finished(1) })
      await bought(last, ids)
      const open = await insertTrip(db, { actorId: actor, placeId: place })

      const answer = await previousOf(cookie, open)
      expect(answer.items.map((entry) => entry.id)).toEqual(ids.slice(0, PREVIOUS_ITEMS_LIMIT))
    },
    10_000,
  )

  // Owner's В-5 «а» of the review, adversarial А4: a receipt of 25 lines last time, the same taken
  // again in its order — cut before, 18 taken left the phone 2 of the 7 still to take, 20 none.
  it.each([18, PREVIOUS_ITEMS_LIMIT, 25])(
    'what this trip holds goes before the limit: %i of 25 taken again leaves the rest',
    async (taken) => {
      const actor = await insertActor(db)
      const cookie = await signIn(db, actor)
      const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
      const ids: string[] = []
      for (let i = 0; i < 25; i += 1) ids.push(await item(`Позиция ${String(i)}`))
      const last = await insertTrip(db, { actorId: actor, placeId: place, ...finished(1) })
      await bought(last, ids)
      const open = await insertTrip(db, { actorId: actor, placeId: place })
      await bought(open, ids.slice(0, taken), Date.UTC(2026, 9, 10))

      const answer = await previousOf(cookie, open)
      expect(answer.previous?.tripId).toBe(last)
      expect(answer.items.map((entry) => entry.id)).toEqual(ids.slice(taken))
    },
    10_000,
  )

  it('a finished trip asked about has what it holds taken out too, and another trip’s is not', async () => {
    const actor = await insertActor(db)
    const cookie = await signIn(db, actor)
    const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
    const [milk, bread, eggs] = [await item('Молоко'), await item('Хлеб'), await item('Яйца')]
    const last = await insertTrip(db, { actorId: actor, placeId: place, ...finished(1) })
    await bought(last, [milk, bread, eggs])
    const asked = await insertTrip(db, { actorId: actor, placeId: place, ...finished(3) })
    await bought(asked, [bread], Date.UTC(2026, 9, 3))
    // «Must not fire»: the trip going on holds the eggs, and the finished one is asked about.
    const open = await insertTrip(db, { actorId: actor, placeId: place })
    await bought(open, [eggs], Date.UTC(2026, 9, 10))

    const answer = await previousOf(cookie, asked)
    expect(answer.previous?.tripId).toBe(last)
    expect(answer.items.map((entry) => entry.id)).toEqual([milk, eggs])
  })

  it('a stranger’s, a missing, a removed and a malformed trip are one 404', async () => {
    const actor = await insertActor(db)
    const other = await insertActor(db)
    const cookie = await signIn(db, actor)
    const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
    const theirs = await insertTrip(db, { actorId: other, placeId: place })
    const removed = await insertTrip(db, { actorId: actor, placeId: place, deletedAt: new Date() })

    for (const id of [theirs, removed, randomUUID(), 'not-a-uuid']) {
      const answer = await ask(cookie, id)
      expect(answer.statusCode).toBe(404)
      expect(answer.json()).toMatchObject({ code: ERROR.NOT_FOUND })
    }
    expect((await app.inject({ url: `/trips/${theirs}/previous-items` })).statusCode).toBe(401)
  })

  it('another person’s trips at the same place are not this person’s last time', async () => {
    const actor = await insertActor(db)
    const other = await insertActor(db)
    const cookie = await signIn(db, actor)
    const place = await insertPlace(db, { name: `SAS ${randomUUID()}` })
    const theirs = await insertTrip(db, { actorId: other, placeId: place, ...finished(1) })
    await bought(theirs, [await item('Чужое')])
    const open = await insertTrip(db, { actorId: actor, placeId: place })

    expect(await previousOf(cookie, open)).toEqual({ previous: null, items: [] })
  })
})

async function expenseOf(tripId: string, itemId: string): Promise<string> {
  const [row] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.tripId, tripId), eq(expenses.itemId, itemId)))
  if (!row) throw new Error('no such purchase')
  return row.id
}
