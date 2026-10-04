import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { receiptLines, receipts } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

// «Чек разобран» (MOL-129): the bot says a receipt was read only to someone the phone did not hand
// it to read — the list of «Покупки» or the review — within 30 s.

const { db, close } = connectDrizzle()
let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db, receiptReader: null })
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
    expect(await heardOf(parsed)).toMatchObject({ heard: 'app', heardAt: expect.any(Date) })
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
