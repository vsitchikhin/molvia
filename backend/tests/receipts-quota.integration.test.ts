import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, RECEIPTS_DAY_MAX, RECEIPTS_UNRECORDED_MAX } from '@molvia/model'
import { madeUpSerbianLink } from '@molvia/model/testing/serbian-receipt'
import type { FastifyInstance } from 'fastify'
import { createReceiptRepository } from '@/db/receipts-repository'
import { actors, receipts, taxReceiptDays } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertPlace, insertTrip, signIn } from './fixtures'
import { onlyRow, sum } from './rows'

// MOL-360 — a receipt's photos live in the database until it is recorded, so a person sends at most
// `RECEIPTS_DAY_MAX` a day of their own and holds at most `RECEIPTS_UNRECORDED_MAX` not recorded at once.

// The tests here that send twenty receipts and more carry a timeout of their own (MOL-266): their work,
// a request each, comes near half a second on CI.

const { db, close } = connectDrizzle()
const repository = createReceiptRepository(db)
let app: FastifyInstance

beforeAll(async () => {
  // no reader, no tax office: what is sent waits in its queue
  app = buildServer({ db, receiptReader: null, purs: null })
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

async function owner(over: Parameters<typeof insertActor>[1] = {}): Promise<Owner> {
  const id = await insertActor(db, over)
  return { id, cookie: await signIn(db, id) }
}

const photo = () => ({
  id: randomUUID(),
  parts: 1,
  country: 'AM',
  language: 'ru',
  capturedAt: '2026-11-09T08:15:00.000Z',
})

let counter = 0
const byLink = () => ({
  id: randomUUID(),
  link: madeUpSerbianLink({
    totalHundredths: 48_637,
    at: new Date('2026-11-09T06:56:53.834Z'),
    counter: ++counter,
  }),
  country: 'RS',
  language: 'ru',
  capturedAt: '2026-11-09T07:10:00.000Z',
})

function send(me: Owner, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/receipts', headers: { cookie: me.cookie }, payload })
}

function remove(me: Owner, id: string) {
  return app.inject({ method: 'DELETE', url: `/receipts/${id}`, headers: { cookie: me.cookie } })
}

function restore(me: Owner, id: string) {
  return app.inject({
    method: 'POST',
    url: `/receipts/${id}/restore`,
    headers: { cookie: me.cookie },
  })
}

/** `n` receipts sent one after another, each taken: their ids. */
async function sent(
  me: Owner,
  n: number,
  made: () => { readonly id: string } & Record<string, unknown> = photo,
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const payload = made()
    expect((await send(me, payload)).statusCode).toBe(201)
    ids.push(payload.id)
  }
  return ids
}

function there<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('no row')
  return row
}

async function day(me: Owner) {
  const read = db
    .select({ day: actors.receiptsDay, sent: actors.receiptsSent, updatedAt: actors.updatedAt })
    .from(actors)
    .where(eq(actors.id, me.id))
  return there(onlyRow(await read))
}

async function held(id: string) {
  const read = db
    .select({ deletedAt: receipts.deletedAt })
    .from(receipts)
    .where(eq(receipts.id, id))
  return there(onlyRow(await read))
}

describe('the receipts of a day (MOL-360, В-1 «а»)', () => {
  it('takes forty and refuses the forty-first, removed ones and the timer giving no place back', async () => {
    const me = await owner()
    // twenty, removed, and twenty more: the removal gives back a place among the unrecorded, never one of the day
    for (const id of await sent(me, RECEIPTS_UNRECORDED_MAX)) {
      expect((await remove(me, id)).statusCode).toBe(204)
    }
    const kept = await sent(me, RECEIPTS_DAY_MAX - RECEIPTS_UNRECORDED_MAX)
    for (const id of kept.slice(0, 5)) expect((await remove(me, id)).statusCode).toBe(204)
    // past the ten minutes of «Вернуть» the timer takes the rows away: the day still counts them
    await db
      .update(receipts)
      .set({ deletedAt: sql`now() - interval '11 minutes'` })
      .where(sql`${receipts.deletedAt} is not null`)
    await repository.purgeStale()

    const refused = photo()
    const answer = await send(me, refused)
    expect(answer.statusCode).toBe(429)
    expect(answer.json()).toMatchObject({ code: ERROR.RECEIPTS_DAY_LIMITED })
    expect(await db.select().from(receipts).where(eq(receipts.id, refused.id))).toEqual([])
    expect((await day(me)).sent).toBe(RECEIPTS_DAY_MAX)
  }, 30_000)

  it('starts a new day over, and counts a day the phone names before the one begun in it', async () => {
    const me = await owner()
    await db
      .update(actors)
      .set({ receiptsDay: '2000-01-01', receiptsSent: RECEIPTS_DAY_MAX })
      .where(eq(actors.id, me.id))
    expect((await send(me, photo())).statusCode).toBe(201)
    const today = await day(me)
    expect(today.sent).toBe(1)
    expect(today.day).not.toBe('2000-01-01')

    // a header made up, or a flight west: the day only moves on
    await db
      .update(actors)
      .set({ receiptsDay: '2999-12-31', receiptsSent: RECEIPTS_DAY_MAX })
      .where(eq(actors.id, me.id))
    const answer = await send(me, photo())
    expect(answer.statusCode).toBe(429)
    expect(answer.json()).toMatchObject({ code: ERROR.RECEIPTS_DAY_LIMITED })
    expect(await day(me)).toMatchObject({ day: '2999-12-31', sent: RECEIPTS_DAY_MAX })
  })

  it('answers the same receipt sent again past the quota, and does not count it', async () => {
    const me = await owner()
    const payload = photo()
    expect((await send(me, payload)).statusCode).toBe(201)
    await db.update(actors).set({ receiptsSent: RECEIPTS_DAY_MAX }).where(eq(actors.id, me.id))
    expect((await send(me, payload)).statusCode).toBe(200)
    expect((await day(me)).sent).toBe(RECEIPTS_DAY_MAX)
  })

  it('is no change of the person’s row: `updated_at` stays', async () => {
    const me = await owner()
    const before = (await day(me)).updatedAt
    expect((await send(me, photo())).statusCode).toBe(201)
    expect(await day(me)).toMatchObject({ sent: 1, updatedAt: before })
  })
})

describe('the receipts not recorded at once (MOL-360)', () => {
  it('refuses the twenty-first, a failed one holding its place, a removed or recorded one giving it back', async () => {
    const me = await owner()
    const ids = await sent(me, RECEIPTS_UNRECORDED_MAX)
    const over = await send(me, photo())
    expect(over.statusCode).toBe(429)
    expect(over.json()).toMatchObject({ code: ERROR.RECEIPTS_UNRECORDED_LIMITED })

    // not read: its photo stays its 28 days, and so does its place
    const [failed = '', removed = '', recorded = ''] = ids
    await db
      .update(receipts)
      .set({ status: 'failed', failure: 'unreadable', queuedAt: sql`now()`, readAt: sql`now()` })
      .where(eq(receipts.id, failed))
    expect((await send(me, photo())).statusCode).toBe(429)

    expect((await remove(me, removed)).statusCode).toBe(204)
    expect((await send(me, photo())).statusCode).toBe(201)
    expect((await send(me, photo())).statusCode).toBe(429)

    const placeId = await insertPlace(db, { name: 'Ереван Сити' })
    const tripId = await insertTrip(db, { actorId: me.id, placeId })
    await db
      .update(receipts)
      .set({ status: 'recorded', tripId, queuedAt: sql`now()`, readAt: sql`now()` })
      .where(eq(receipts.id, recorded))
    expect((await send(me, photo())).statusCode).toBe(201)
    expect((await day(me)).sent).toBe(RECEIPTS_UNRECORDED_MAX + 2)
  }, 15_000)

  it('lets one of two receipts sent at once take the last place', async () => {
    const me = await owner()
    await sent(me, RECEIPTS_UNRECORDED_MAX - 1)
    const answers = await Promise.all([send(me, photo()), send(me, photo())])
    expect(answers.map((answer) => answer.statusCode).toSorted()).toEqual([201, 429])
    expect((await day(me)).sent).toBe(RECEIPTS_UNRECORDED_MAX)
  }, 15_000)

  it('refuses «Вернуть» with the places taken, the receipt left removed (В-2 «а»)', async () => {
    const me = await owner()
    const [first = '', second = ''] = await sent(me, RECEIPTS_UNRECORDED_MAX)
    expect((await remove(me, first)).statusCode).toBe(204)
    expect((await send(me, photo())).statusCode).toBe(201)

    const answer = await restore(me, first)
    expect(answer.statusCode).toBe(429)
    expect(answer.json()).toMatchObject({ code: ERROR.RECEIPTS_UNRECORDED_LIMITED })
    expect((await held(first)).deletedAt).not.toBeNull()

    expect((await remove(me, second)).statusCode).toBe(204)
    expect((await restore(me, first)).statusCode).toBe(200)
    expect((await held(first)).deletedAt).toBeNull()
  }, 15_000)

  it('counts a receipt by its link as a photo, and a refused one in no tally (В-3 «а»)', async () => {
    const me = await owner({ country: 'RS', city: 'Белград', spendCurrency: 'RSD' })
    await sent(me, RECEIPTS_UNRECORDED_MAX, byLink)
    const answer = await send(me, byLink())
    expect(answer.statusCode).toBe(429)
    expect(answer.json()).toMatchObject({ code: ERROR.RECEIPTS_UNRECORDED_LIMITED })
    const tallied = await db.select({ n: taxReceiptDays.sentUnnamed }).from(taxReceiptDays)
    expect(sum(tallied.map((row) => row.n))).toBe(RECEIPTS_UNRECORDED_MAX)
  }, 15_000)
})
