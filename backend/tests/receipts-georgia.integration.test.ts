/**
 * Georgia read by the model alone (MOL-408): a receipt the model is away for waits a day, the person's receipts of
 * the country asked of it less and less often together, holding no round (owner's В-8 «а», В-9 «а», Р3-А1); and the
 * camera is offered only while the model reads for the person now — the share and the month's cap too (adversarial
 * А3). The model is a fake answering as Haiku copied Nikora's receipt on the bench.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MODEL_CONSENT_EDITION,
  RECEIPTS_BY_MODEL_HEADER,
  RECEIPT_MODEL_INPUT_MAX,
  RECEIPT_MODEL_SHARE_MICRO_USD,
  spendMonthOf,
  worstCallMicroUsd,
} from '@molvia/model'
import type { ModelReceipt } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createItemRepository } from '@/db/items-repository'
import { createModelSpendRepository } from '@/db/model-spend-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
import { actors, modelSpend, receiptParts, receipts } from '@/db/schema'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import { ModelUnavailable } from '@/receipts/model-reader'
import type { ModelReading, ReceiptModel } from '@/receipts/model-reader'
import type { ReceiptReader } from '@/receipts/reader'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import {
  RECEIPT_MODEL_ALONE_WAIT_MS,
  RECEIPT_MODEL_WAIT_MS,
  readQueuedReceipts,
} from '@/usecases/read-receipts'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'
import { onlyRow } from './rows'

const { db, close } = connectDrizzle()
const repository = createReceiptRepository(db)
const spend = createModelSpendRepository(db, true)
const CAP = 200_000_000

/** Nikora's receipt as Haiku copied it on the bench (ge-02), shortened: «სულ» meets its one line. */
const NIKORA: ModelReceipt = {
  shop: 'სს "ნიკორა ტრეიდი"',
  address: null,
  id_rows: ['სალარო № 1713', 'ქვითარი 1687592'],
  date: null,
  time: null,
  lines: [
    {
      printed: 'სენდვიჩი საქონლის ხორცით და ნივრით 1ც',
      code: null,
      article: null,
      quantity: '1',
      unit: null,
      unit_price: null,
      discount: null,
      sum: '8.59',
    },
  ],
  totals: [
    { label: 'BOG_Cards', amount: '8.59' },
    { label: 'სულ:', amount: '8.59' },
  ],
}

function fakeModel(
  answer: (parts: readonly Buffer[]) => Promise<ModelReading>,
): ReceiptModel & { asked: number } {
  const model = {
    asked: 0,
    version: 'claude-haiku-5-5@v5',
    inputTokensMax: () => 10_000,
    read: (parts: readonly Buffer[]) => {
      model.asked += 1
      return answer(parts)
    },
    brandsVersion: 'claude-haiku-5-5@brands-v1',
    brandsInputTokensMax: () => 1_000,
    spellBrands: () => Promise.reject(new Error('no brand is asked')),
  }
  return model
}
const NIKORA_READ: ModelReading = {
  kind: 'read',
  answer: NIKORA,
  costMicroUsd: 2_180,
  tokens: { input: 5_909, output: 3_177 },
}
const reads = () => fakeModel(() => Promise.resolve(NIKORA_READ))
/** The model up, but timing out on one photo every time — a receipt it fails on by itself, told by its photo whole. */
const failsOn = (photo: Buffer | undefined) =>
  fakeModel((parts) =>
    photo !== undefined && parts[0]?.equals(photo) === true
      ? Promise.reject(new ModelUnavailable('timeout', null))
      : Promise.resolve(NIKORA_READ),
  )
const away = () => fakeModel(() => Promise.reject(new ModelUnavailable('status 529', 0)))

/** Tesseract that reads no line of anything: the Armenian receipt behind the Georgian one reaches it. */
const tesseract: ReceiptReader & { asked: number } = {
  asked: 0,
  read() {
    tesseract.asked += 1
    return Promise.resolve({ text: '', rows: [], version: 'tesseract 5.5.0 · test' })
  },
  strips: () => Promise.resolve([]),
}

let app: FastifyInstance
let photos = 0

beforeAll(async () => {
  app = buildServer({
    db,
    receiptReader: null,
    receiptModel: reads(),
    receiptModelCapMicroUsd: CAP,
  })
  await app.ready()
})
beforeEach(async () => {
  await clearAll(db)
  tesseract.asked = 0
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

function jpeg(tail: number): Buffer {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x09, 0x60, 0x03, 0x20]
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
  return Buffer.from([
    ...[0xff, 0xd8],
    ...sof,
    ...Array.from({ length: 10 }, () => 0),
    ...sos,
    tail,
    0x55,
    ...[0xff, 0xd9],
  ])
}

interface Person {
  readonly id: string
  readonly cookie: string
}

/** Someone the model is granted to, edition 5 accepted, settled in `country`. */
async function granted(country: 'GE' | 'AM' = 'GE'): Promise<Person> {
  const id = await insertActor(db, {
    country,
    city: country === 'GE' ? 'Тбилиси' : 'Гюмри',
    spendCurrency: country === 'GE' ? 'GEL' : 'AMD',
    receiptsModelUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    consentVersion: MODEL_CONSENT_EDITION,
    consentedAt: new Date(),
  })
  return { id, cookie: await signIn(db, id) }
}

async function queued(me: Person, country: 'GE' | 'AM' = 'GE'): Promise<string> {
  const id = randomUUID()
  const sent = await app.inject({
    method: 'POST',
    url: '/receipts',
    headers: { cookie: me.cookie },
    payload: { id, parts: 1, country, language: 'ru', capturedAt: '2026-11-15T09:01:00.000Z' },
  })
  expect(sent.statusCode).toBe(201)
  const part = await app.inject({
    method: 'PUT',
    url: `/receipts/${id}/parts/1`,
    headers: { cookie: me.cookie, 'content-type': 'image/jpeg' },
    payload: jpeg(++photos % 256),
  })
  expect(part.statusCode).toBe(200)
  return id
}

async function readAll(model: ReceiptModel, now: () => Date): Promise<void> {
  await readQueuedReceipts({
    receipts: repository,
    reader: tesseract,
    report: () => undefined,
    bind: (claimed, lines, read) =>
      bindReceiptLines(
        { items: createItemRepository(db), embedder: NO_EMBEDDER },
        claimed.actorId,
        claimed.country,
        claimed.language,
        lines,
        [],
        { byModel: read.byModel },
      ),
    model: { reader: model, spend, capMicroUsd: CAP, shareMicroUsd: CAP },
    now,
  })
}

const photoOf = async (id: string) =>
  onlyRow(
    await db
      .select({ photo: receiptParts.photo })
      .from(receiptParts)
      .where(eq(receiptParts.receiptId, id)),
  )?.photo

const receiptOf = async (id: string) =>
  onlyRow(await db.select().from(receipts).where(eq(receipts.id, id)))

/** The rest of a person's receipts over, as the minutes would end it (the rest reads the database's clock). */
async function restOver(me: Person): Promise<void> {
  await db
    .update(receipts)
    .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
    .where(and(eq(receipts.actorId, me.id), isNotNull(receipts.nextAttemptAt)))
}

/** The person's last try a minute and a second back, their rest left as it is: the minute a receipt never tried waits. */
async function triedAMinuteAgo(me: Person): Promise<void> {
  await db
    .update(receipts)
    .set({ readingAt: new Date(Date.now() - 61_000) })
    .where(and(eq(receipts.actorId, me.id), isNotNull(receipts.readingAt)))
}

/** This receipt's own rest over, the person's others left resting. */
async function restOverOf(id: string): Promise<void> {
  await db
    .update(receipts)
    .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
    .where(eq(receipts.id, id))
}

/** The receipt arrived `agoMs` before now. */
async function arrived(id: string, agoMs: number): Promise<void> {
  await db
    .update(receipts)
    .set({ queuedAt: new Date(Date.now() - agoMs) })
    .where(eq(receipts.id, id))
}

/** How long from now the person's receipts rest, in minutes, as the row says. */
async function restsMinutes(id: string): Promise<number> {
  const at = (await receiptOf(id))?.nextAttemptAt?.getTime() ?? 0
  return (at - Date.now()) / 60_000
}

describe('a Georgian receipt while the model is away (MOL-408, owner’s В-8 «а», В-9 «а»)', () => {
  it('waits past the ten minutes, the Armenian receipt behind it goes to Tesseract, and the model back reads it', async () => {
    const tbilisi = await granted('GE')
    const gyumri = await granted('AM')
    const georgian = await queued(tbilisi)
    const armenian = await queued(gyumri, 'AM')
    const queuedAt = (await receiptOf(georgian))?.queuedAt?.getTime() ?? 0
    const later = (ms: number) => () => new Date(queuedAt + ms)

    // past the ten minutes: Armenia's goes to Tesseract, Georgia's keeps its place and rests — never the end
    await readAll(away(), later(RECEIPT_MODEL_WAIT_MS + 60_000))
    expect(await receiptOf(georgian)).toMatchObject({ status: 'queued', attempts: 0 })
    expect((await receiptOf(armenian))?.status).toBe('failed')
    expect(tesseract.asked).toBeGreaterThan(0)

    // the model back within the day, past the rest, reads it
    await restOver(tbilisi)
    const back = reads()
    await readAll(back, later(6 * 60 * 60 * 1000))
    expect(back.asked).toBe(1)
    expect(await receiptOf(georgian)).toMatchObject({ status: 'parsed', nextAttemptAt: null })
  }, 30_000)

  it('fails it unreadable only past a day of the model away, and never asks Tesseract', async () => {
    const me = await granted('GE')
    const id = await queued(me)
    const queuedAt = (await receiptOf(id))?.queuedAt?.getTime() ?? 0

    await readAll(away(), () => new Date(queuedAt + RECEIPT_MODEL_ALONE_WAIT_MS - 60_000))
    expect((await receiptOf(id))?.status).toBe('queued')
    // the arrival kept: the day is counted from it to the minute
    await restOver(me)
    await readAll(away(), () => new Date(queuedAt + RECEIPT_MODEL_ALONE_WAIT_MS))
    expect(await receiptOf(id)).toMatchObject({ status: 'failed', failure: 'unreadable' })
    expect(tesseract.asked).toBe(0)
  }, 30_000)

  it('rests as long again as it has waited, a minute at least and an hour at most (Р2-А1)', async () => {
    const me = await granted('GE')
    const id = await queued(me)
    const model = away()
    const now = () => new Date()

    await readAll(model, now)
    expect(model.asked).toBe(1)
    expect(await restsMinutes(id)).toBeGreaterThan(0.5)
    // must not: the next minute's round asks nothing of a receipt that just rested
    await readAll(model, now)
    expect(model.asked).toBe(1)
    // waited ten minutes: rests ten more
    await arrived(id, 10 * 60_000)
    await restOver(me)
    await readAll(model, now)
    expect(model.asked).toBe(2)
    expect(await restsMinutes(id)).toBeGreaterThan(9)
    expect(await restsMinutes(id)).toBeLessThan(11)
    // waited ten hours: rests an hour, never more
    await arrived(id, 10 * 60 * 60_000)
    await restOver(me)
    await readAll(model, now)
    expect(model.asked).toBe(3)
    expect(await restsMinutes(id)).toBeGreaterThan(59)
    expect(await restsMinutes(id)).toBeLessThan(61)
  }, 30_000)

  it('rests the person’s receipts of the country together: a batch pays one try, not one a receipt (Р3-А1)', async () => {
    const me = await granted('GE')
    const oldest = await queued(me)
    const batch = [oldest, await queued(me), await queued(me)]
    const other = await granted('GE')
    const theirs = await queued(other)
    // the oldest waited half an hour: the rest is counted from it, whichever receipt was tried
    await arrived(oldest, 30 * 60_000)
    const model = away()
    const now = () => new Date()

    await readAll(model, now)
    // one try for the person's three, and one for another person's own: each pays for their own queue
    expect(model.asked).toBe(2)
    const rested = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.actorId, me.id), isNotNull(receipts.nextAttemptAt)))
    expect(rested).toHaveLength(1)
    expect(await restsMinutes(onlyRow(rested)?.id ?? '')).toBeGreaterThan(29)
    // must not: none of the three is asked while one rests and the try was within the minute
    await readAll(model, now)
    expect(model.asked).toBe(2)
    // a minute on, a receipt never tried passes the rest — one, never two in a minute (В-10 «а»)
    await triedAMinuteAgo(me)
    await readAll(model, now)
    expect(model.asked).toBe(3)

    // the model back, past the rest: the whole batch is read in one round
    await restOver(me)
    await restOver(other)
    const back = reads()
    await readAll(back, now)
    expect(back.asked).toBe(4)
    for (const id of [...batch, theirs]) expect((await receiptOf(id))?.status).toBe('parsed')
  }, 30_000)

  it('gives the try after the rest to the receipt not tried: one the model fails on by itself holds no other (Р4-А1)', async () => {
    const me = await granted('GE')
    const slow = await queued(me)
    const slowPhoto = await photoOf(slow)
    const next = await queued(me)
    const model = failsOn(slowPhoto)
    const now = () => new Date()

    // the oldest first: it times out, and the person's receipts rest
    await readAll(model, now)
    expect(model.asked).toBe(1)
    expect((await receiptOf(next))?.status).toBe('queued')

    // the rest over: the receipt never tried goes first and is read, the slow one after it rests again
    await restOver(me)
    await readAll(model, now)
    expect(model.asked).toBe(3)
    expect((await receiptOf(next))?.status).toBe('parsed')
    expect((await receiptOf(slow))?.status).toBe('queued')
  }, 30_000)

  it('reads a receipt sent while one the model fails on by itself rests its hour: never tried, it passes (В-10 «а», Р5-А1)', async () => {
    const me = await granted('GE')
    const slow = await queued(me)
    const slowPhoto = await photoOf(slow)
    await arrived(slow, 2 * 60 * 60_000)
    const model = failsOn(slowPhoto)
    const now = () => new Date()
    await readAll(model, now)
    expect(model.asked).toBe(1)
    expect(await restsMinutes(slow)).toBeGreaterThan(59)

    const sent = await queued(me)
    await triedAMinuteAgo(me)
    await readAll(model, now)
    // the new one read at its first try; the slow one keeps its hour, not asked again
    expect(model.asked).toBe(2)
    expect((await receiptOf(sent))?.status).toBe('parsed')
    expect((await receiptOf(slow))?.status).toBe('queued')
    expect(await restsMinutes(slow)).toBeGreaterThan(58)
  }, 30_000)

  it('rests a receipt that failed once by its own age, the model up: the person’s slow one holds it no longer (В-11 «а», Р6-А1)', async () => {
    const me = await granted('GE')
    const neighbour = await granted('GE')
    const slow = await queued(me)
    const slowPhoto = await photoOf(slow)
    await arrived(slow, 2 * 60 * 60_000)
    const now = () => new Date()
    await readAll(failsOn(slowPhoto), now)
    expect(await restsMinutes(slow)).toBeGreaterThan(59)

    // the model up: the neighbour's receipt is read; the person's new one times out once, the slow one every time
    const theirs = await queued(neighbour)
    const sent = await queued(me)
    const sentPhoto = await photoOf(sent)
    let hiccup = true
    const model = fakeModel((parts) => {
      const slowOne = slowPhoto !== undefined && parts[0]?.equals(slowPhoto) === true
      const once = hiccup && sentPhoto !== undefined && parts[0]?.equals(sentPhoto) === true
      if (once) hiccup = false
      return slowOne || once
        ? Promise.reject(new ModelUnavailable('timeout', null))
        : Promise.resolve(NIKORA_READ)
    })
    await readAll(model, now)
    expect((await receiptOf(theirs))?.status).toBe('parsed')
    expect((await receiptOf(sent))?.status).toBe('queued')
    expect(await restsMinutes(sent)).toBeLessThan(2)

    // its own minute over, it is asked again and read, while the slow one keeps its hour
    await restOverOf(sent)
    await readAll(model, now)
    expect(model.asked).toBe(3)
    expect((await receiptOf(sent))?.status).toBe('parsed')
    expect(await restsMinutes(slow)).toBeGreaterThan(58)
  }, 30_000)

  it('must not rest an Armenian receipt between tries: Tesseract takes it past its ten minutes as before', async () => {
    const me = await granted('AM')
    const id = await queued(me, 'AM')
    const model = away()
    await readAll(model, () => new Date())
    await readAll(model, () => new Date())
    expect(model.asked).toBe(2)
    expect(await receiptOf(id)).toMatchObject({ status: 'queued', nextAttemptAt: null })
  }, 30_000)
})

describe('whether the model reads for the person now (MOL-408, adversarial А3, Р2-А1)', () => {
  async function said(me: Person, server: FastifyInstance = app): Promise<boolean | undefined> {
    const answer = await server.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { cookie: me.cookie, [RECEIPTS_BY_MODEL_HEADER]: '1' },
    })
    return answer.json<{ receiptsByModel?: boolean }>().receiptsByModel
  }
  // the month the server reads by is its own clock's: a row of this month and of the next holds at its turn too
  const thisMonth = spendMonthOf(new Date())
  const today = new Date()
  const nextMonth = spendMonthOf(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)),
  )
  // the largest request's worst: no call the queue reserves costs more
  const worst = worstCallMicroUsd(RECEIPT_MODEL_INPUT_MAX)

  it('says yes to a grant with its share and the month’s cap left', async () => {
    expect(await said(await granted())).toBe(true)
  }, 10_000)

  it('says no of a grant run out or none, and of an older edition', async () => {
    for (const [until, edition] of [
      [new Date(Date.now() - 24 * 60 * 60 * 1000), MODEL_CONSENT_EDITION],
      [null, MODEL_CONSENT_EDITION],
      [new Date(Date.now() + 24 * 60 * 60 * 1000), MODEL_CONSENT_EDITION - 1],
    ] as const) {
      const me = await granted()
      await db
        .update(actors)
        .set({ receiptsModelUntil: until, consentVersion: edition })
        .where(eq(actors.id, me.id))
      expect(await said(me), String(until)).toBe(false)
    }
  }, 10_000)

  it('must not say it to a phone that does not ask: an earlier build reads the answer strictly', async () => {
    const me = await granted()
    const answer = await app.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { cookie: me.cookie },
    })
    expect(Object.keys(answer.json<Record<string, unknown>>())).not.toContain('receiptsByModel')
  }, 10_000)

  it('says yes while one more call fits the person’s share, and no once it does not', async () => {
    const me = await granted()
    // the month that counts: the next one is «at least this one» for either clock (`model_month >= month`)
    const spent = (micro: number) =>
      db
        .update(actors)
        .set({ modelMonth: nextMonth, modelSpentMicroUsd: micro })
        .where(eq(actors.id, me.id))
    await spent(RECEIPT_MODEL_SHARE_MICRO_USD - worst)
    expect(await said(me)).toBe(true)
    // must not: a share a call short of its worst, though not spent whole (Р2-А1)
    await spent(RECEIPT_MODEL_SHARE_MICRO_USD - worst + 1)
    expect(await said(me)).toBe(false)
    // a share spent in a month gone counts nothing now
    await db
      .update(actors)
      .set({ modelMonth: '2026-01-01', modelSpentMicroUsd: RECEIPT_MODEL_SHARE_MICRO_USD })
      .where(eq(actors.id, me.id))
    expect(await said(me)).toBe(true)
  }, 10_000)

  it('must not say yes once the month’s cap has no room for a call', async () => {
    const me = await granted()
    await db.insert(modelSpend).values([
      { month: thisMonth, spentMicroUsd: CAP - worst + 1 },
      { month: nextMonth, spentMicroUsd: CAP - worst + 1 },
    ])
    expect(await said(me)).toBe(false)
  }, 10_000)

  it('must not say yes where the server has no model', async () => {
    const keyless = buildServer({ db, receiptReader: null })
    await keyless.ready()
    try {
      expect(await said(await granted(), keyless)).toBe(false)
    } finally {
      await keyless.close()
    }
  }, 10_000)
})
