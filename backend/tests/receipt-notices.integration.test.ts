import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { dueReceiptNoticesSchema } from '@molvia/model'
import { actors, receiptLines, receipts } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertPlace, insertTrip, signIn } from './fixtures'

// «Чек разобран» (MOL-129): the bot says a receipt was read only to someone the phone did not hand
// it to read — the list of «Покупки» or the review — within 30 s.

const { db, close } = connectDrizzle()
const botSecret = randomBytes(32).toString('base64url')
let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db, receiptReader: null, login: { username: 'molvia_bot', botSecret } })
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

type Status = typeof receipts.$inferSelect.status

/** A receipt where the reader left it: `secondsAgo` since it was read, with `lines` item lines. */
async function receipt(
  actorId: string,
  status: Status,
  {
    secondsAgo = 60,
    lines = 3,
    ...patch
  }: Partial<typeof receipts.$inferInsert> & {
    readonly secondsAgo?: number
    readonly lines?: number
  } = {},
): Promise<string> {
  const id = randomUUID()
  const read = status === 'parsed' || status === 'failed' || status === 'recorded'
  const readAt = new Date(Date.now() - secondsAgo * 1000)
  await db.insert(receipts).values({
    id,
    actorId,
    status,
    failure: status === 'failed' ? 'reshoot' : null,
    parts: 1,
    country: 'AM',
    language: 'ru',
    currency: 'AMD',
    capturedAt: new Date('2026-10-04T08:15:00.000Z'),
    queuedAt: status === 'uploading' ? null : readAt,
    readAt: read ? readAt : null,
    ...patch,
  })
  if (status !== 'failed' && lines > 0) {
    await db.insert(receiptLines).values(
      Array.from({ length: lines }, (_, position) => ({
        receiptId: id,
        position,
        printed: `Կաթ ${String(position)}`,
        settled: true,
      })),
    )
  }
  return id
}

async function heardOf(id: string) {
  const [row] = await db
    .select({ heard: receipts.heard, heardAt: receipts.heardAt })
    .from(receipts)
    .where(eq(receipts.id, id))
  return row
}

function get(me: Owner, url: string) {
  return app.inject({ method: 'GET', url, headers: { cookie: me.cookie } })
}

describe('heard in the app', () => {
  it('marks a receipt read, parsed or failed, once the list hands it over', async () => {
    const me = await owner()
    const parsed = await receipt(me.id, 'parsed')
    const failed = await receipt(me.id, 'failed')
    expect((await get(me, '/receipts')).statusCode).toBe(200)
    expect(await heardOf(parsed)).toMatchObject({ heard: 'app' })
    expect((await heardOf(parsed))?.heardAt).toBeInstanceOf(Date)
    expect(await heardOf(failed)).toMatchObject({ heard: 'app' })
  })

  it('marks it once the review hands it over', async () => {
    const me = await owner()
    const parsed = await receipt(me.id, 'parsed')
    expect((await get(me, `/receipts/${parsed}`)).statusCode).toBe(200)
    expect(await heardOf(parsed)).toMatchObject({ heard: 'app' })
  })

  it('must not mark a receipt not read yet, or recorded', async () => {
    const me = await owner()
    const uploading = await receipt(me.id, 'uploading')
    const queued = await receipt(me.id, 'queued')
    const reading = await receipt(me.id, 'reading')
    const recorded = await receipt(me.id, 'recorded')
    await get(me, '/receipts')
    for (const id of [uploading, queued, reading, recorded]) {
      expect(await heardOf(id)).toEqual({ heard: null, heardAt: null })
    }
  })

  it('keeps the first word: one the bot told of stays «bot», and a repeat moves no moment', async () => {
    const me = await owner()
    const told = await receipt(me.id, 'parsed', {
      heard: 'bot',
      heardAt: new Date('2026-10-04T08:16:00Z'),
    })
    const seen = await receipt(me.id, 'parsed')
    await get(me, '/receipts')
    const first = await heardOf(seen)
    await get(me, '/receipts')
    await get(me, `/receipts/${seen}`)
    expect(await heardOf(told)).toEqual({ heard: 'bot', heardAt: new Date('2026-10-04T08:16:00Z') })
    expect(await heardOf(seen)).toEqual(first)
  })

  it('must not mark someone else’s receipt, or a removed one', async () => {
    const me = await owner()
    const other = await owner()
    const theirs = await receipt(other.id, 'parsed')
    const removed = await receipt(me.id, 'parsed', { deletedAt: new Date() })
    await get(me, '/receipts')
    expect((await get(me, `/receipts/${theirs}`)).statusCode).toBe(404)
    expect(await heardOf(theirs)).toEqual({ heard: null, heardAt: null })
    expect(await heardOf(removed)).toEqual({ heard: null, heardAt: null })
  })
})

function claim(authorization: string | null = `Bearer ${botSecret}`) {
  return app.inject({
    method: 'POST',
    url: '/internal/receipts/claim',
    headers: authorization ? { authorization } : {},
  })
}

async function claimed() {
  const response = await claim()
  expect(response.statusCode).toBe(200)
  return dueReceiptNoticesSchema.parse(response.json()).notices
}

async function telegramOf(actorId: string): Promise<number> {
  const [row] = await db
    .select({ telegramUserId: actors.telegramUserId })
    .from(actors)
    .where(eq(actors.id, actorId))
  return row?.telegramUserId ?? 0
}

describe('POST /internal/receipts/claim', () => {
  it('hands over a receipt read 30 s ago that no phone was handed, once, and marks it «bot»', async () => {
    const me = await owner()
    const id = await receipt(me.id, 'parsed', { secondsAgo: 31, lines: 7, printedOn: '2026-10-03' })
    const [notice, ...more] = await claimed()
    expect(more).toEqual([])
    expect(typeof notice?.silent).toBe('boolean')
    expect({ ...notice, silent: false }).toEqual({
      telegramUserId: await telegramOf(me.id),
      receiptId: id,
      outcome: 'parsed',
      language: 'ru',
      place: null,
      day: '2026-10-03',
      lineCount: 7,
      silent: false,
    })
    expect(await heardOf(id)).toMatchObject({ heard: 'bot' })
    expect((await heardOf(id))?.heardAt).toBeInstanceOf(Date)
    expect(await claimed()).toEqual([])
    // the phone handed it later does not take the bot's word back
    await get(me, '/receipts')
    expect(await heardOf(id)).toMatchObject({ heard: 'bot' })
  })

  it('waits out the 30 s: a receipt read 29 s ago is not handed yet', async () => {
    const me = await owner()
    const early = await receipt(me.id, 'parsed', { secondsAgo: 29 })
    expect(await claimed()).toEqual([])
    expect(await heardOf(early)).toEqual({ heard: null, heardAt: null })
  })

  it('must not hand over what the phone was handed first', async () => {
    const me = await owner()
    const seen = await receipt(me.id, 'parsed', { secondsAgo: 5 })
    await get(me, '/receipts')
    await db
      .update(receipts)
      .set({ readAt: sql`clock_timestamp() - interval '1 minute'` })
      .where(eq(receipts.id, seen))
    expect(await claimed()).toEqual([])
    expect(await heardOf(seen)).toMatchObject({ heard: 'app' })
  })

  it('says a receipt not read, by the day of its shot in the person’s zone without a date printed', async () => {
    const me = await owner()
    // 21:30 UTC is already the next day in Yerevan
    const id = await receipt(me.id, 'failed', { capturedAt: new Date('2026-10-03T21:30:00Z') })
    expect(await claimed()).toEqual([
      expect.objectContaining({
        receiptId: id,
        outcome: 'failed',
        day: '2026-10-04',
        lineCount: 0,
      }),
    ])
  })

  it('speaks the receipt’s language, not anything else of the person', async () => {
    const me = await owner()
    await receipt(me.id, 'parsed', { language: 'en' })
    expect(await claimed()).toEqual([expect.objectContaining({ language: 'en' })])
  })

  it('names the place the review would: the seller’s, by its tax number, in the person’s city', async () => {
    const me = await owner()
    const place = await insertPlace(db, { name: 'Ереван Сити', city: 'Гюмри' })
    const trip = await insertTrip(db, { actorId: me.id, placeId: place })
    await receipt(me.id, 'recorded', { tin: '01234567', tripId: trip, secondsAgo: 86_400 })
    const id = await receipt(me.id, 'parsed', { tin: '01234567' })
    expect(await claimed()).toEqual([
      expect.objectContaining({ receiptId: id, place: 'Ереван Сити' }),
    ])
  })

  it('must not hand over a receipt removed, recorded, too old, or of someone who blocked the bot', async () => {
    const me = await owner()
    const blocked = await owner()
    await db.update(actors).set({ remindersOff: 'blocked' }).where(eq(actors.id, blocked.id))
    const removed = await receipt(me.id, 'parsed', { deletedAt: new Date() })
    const recorded = await receipt(me.id, 'recorded')
    const old = await receipt(me.id, 'parsed', { secondsAgo: 6 * 3600 + 5 })
    const theirs = await receipt(blocked.id, 'parsed')
    expect(await claimed()).toEqual([])
    for (const id of [removed, recorded, old, theirs]) {
      expect(await heardOf(id)).toEqual({ heard: null, heardAt: null })
    }
  })

  it('hands over a receipt of someone who only turned the rating reminders off', async () => {
    const me = await owner()
    await db.update(actors).set({ remindersOff: 'chosen' }).where(eq(actors.id, me.id))
    const id = await receipt(me.id, 'parsed')
    expect(await claimed()).toEqual([expect.objectContaining({ receiptId: id })])
  })

  it('gives each receipt to one of two claims at once, never to both', async () => {
    const me = await owner()
    for (let i = 0; i < 6; i += 1) await receipt(me.id, 'parsed', { secondsAgo: 60 + i })
    const both = await Promise.all([claimed(), claimed()])
    const ids = both.flat().map(({ receiptId }) => receiptId)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
  })

  it('answers only the bot', async () => {
    for (const authorization of [null, 'Bearer wrong']) {
      expect((await claim(authorization)).statusCode).toBe(401)
    }
  })
})

describe('«Сообщать, что чек разобран» (В-2)', () => {
  function choose(me: Owner, payload: unknown) {
    return app.inject({
      method: 'PUT',
      url: '/actors/me/receipt-notices',
      headers: { cookie: me.cookie },
      payload: payload as Record<string, unknown>,
    })
  }

  it('is on for everyone to begin with, and the person’s own address answers it', async () => {
    const me = await owner()
    const response = await get(me, '/actors/me/receipt-notices')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ off: false })
  })

  it('turned off, hands nothing over and marks nothing; turned on again, hands it over', async () => {
    const me = await owner()
    const id = await receipt(me.id, 'parsed')
    expect((await choose(me, { on: false })).json()).toEqual({ off: true })
    expect(await claimed()).toEqual([])
    expect(await heardOf(id)).toEqual({ heard: null, heardAt: null })
    expect((await choose(me, { on: true })).json()).toEqual({ off: false })
    expect(await claimed()).toEqual([expect.objectContaining({ receiptId: id })])
  })

  it('is the person’s own: one turned off leaves another’s on', async () => {
    const me = await owner()
    const other = await owner()
    await choose(me, { on: false })
    expect((await get(other, '/actors/me/receipt-notices')).json()).toEqual({ off: false })
  })

  it('must not touch the rating reminders, nor they it', async () => {
    const me = await owner()
    await choose(me, { on: false })
    const [row] = await db
      .select({ remindersOff: actors.remindersOff })
      .from(actors)
      .where(eq(actors.id, me.id))
    expect(row?.remindersOff).toBeNull()
  })

  it('refuses a body that is not a choice, and anyone not signed in', async () => {
    const me = await owner()
    expect((await choose(me, { on: 'yes' })).statusCode).toBe(400)
    expect((await choose(me, { on: true, off: true })).statusCode).toBe(400)
    const anonymous = await app.inject({ method: 'GET', url: '/actors/me/receipt-notices' })
    expect(anonymous.statusCode).toBe(401)
  })
})
