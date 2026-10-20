import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MODEL_CONSENT_EDITION, spendMonthOf } from '@molvia/model'
import type { ModelReceipt } from '@molvia/model'
import am05 from '@molvia/model/testing/receipt-text.am-05.json'
import type { FastifyInstance } from 'fastify'
import { createItemRepository } from '@/db/items-repository'
import { createModelSpendRepository } from '@/db/model-spend-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
import { actors, ownerNotices, receiptLineImages, receiptLines, receipts } from '@/db/schema'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import { ModelRejected, ModelUnavailable } from '@/receipts/model-reader'
import type { ModelReading, ReceiptModel } from '@/receipts/model-reader'
import type { ReaderReading, ReceiptReader } from '@/receipts/reader'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import { RECEIPT_MODEL_WAIT_MS, readQueuedReceipts } from '@/usecases/read-receipts'
import type { ReadReport } from '@/usecases/read-receipts'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

// Which reader reads a receipt (MOL-272): the model for whoever it is granted to and accepted edition 3,
// under the month's cap, Tesseract otherwise and whenever the model is not the one to (В-1 «а»).

const { db, close } = connectDrizzle()
const repository = createReceiptRepository(db)
const spend = createModelSpendRepository(db, true)
const CAP = 200_000_000
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

// a made-up head: the repository is public
const ANSWER: ModelReceipt = {
  shop: 'Խանութ «Օրինակ»',
  address: 'Գորկու 1, Գյումրի',
  tin: '01234567',
  receipt_no: '000123',
  date: '2026-10-08',
  time: '19:57',
  lines: [
    {
      printed: 'Կաթ «Օրինակ» 3.2% 1լ',
      code: '0401',
      article: '1163909',
      quantity: '2',
      unit: 'pcs',
      unit_price: '370',
      discount: null,
      sum: '740',
    },
    {
      printed: 'Հաց «Օրինակ»',
      code: '1905',
      article: '1106618',
      quantity: '1',
      unit: 'pcs',
      unit_price: '290',
      discount: '2.9',
      sum: '287.1',
    },
  ],
  totals: [
    { label: 'Ընդամենը', amount: '1027.10' },
    { label: 'Վճարված է Առձեռն', amount: '1027.10' },
  ],
}

function jpeg(width = 800, height = 2_400, tail = 0): Buffer {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff]
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

let photos = 0

interface Person {
  readonly id: string
  readonly cookie: string
}

/** A person granted the model until `until` and having accepted `edition`. */
async function person(until: Date | null, edition: number | null = MODEL_CONSENT_EDITION) {
  const id = await insertActor(db)
  await db
    .update(actors)
    .set({
      receiptsModelUntil: until,
      consentVersion: edition,
      consentedAt: edition === null ? null : new Date(),
    })
    .where(eq(actors.id, id))
  return { id, cookie: await signIn(db, id) } satisfies Person
}

const LATER = new Date(Date.now() + 24 * 60 * 60 * 1000)

async function queued(me: Person): Promise<string> {
  const id = randomUUID()
  const sent = await app.inject({
    method: 'POST',
    url: '/receipts',
    headers: { cookie: me.cookie },
    payload: {
      id,
      parts: 1,
      country: 'AM',
      language: 'ru',
      capturedAt: '2026-10-08T16:00:00.000Z',
    },
  })
  expect(sent.statusCode).toBe(201)
  const part = await app.inject({
    method: 'PUT',
    url: `/receipts/${id}/parts/1`,
    headers: { cookie: me.cookie, 'content-type': 'image/jpeg' },
    payload: jpeg(800, 2_400, ++photos % 256),
  })
  expect(part.statusCode).toBe(200)
  return id
}

/** Tesseract as the bench read am-05: whatever it reads is Tesseract's, by its version. */
function benchReader(): ReceiptReader & { asked: number } {
  const texts: Record<number, string> = { 4: am05.readings[0] ?? '', 6: am05.readings[1] ?? '' }
  const reader = {
    asked: 0,
    read(_photo: Buffer, _languages: string, pageMode: number): Promise<ReaderReading> {
      reader.asked += 1
      const text = texts[pageMode] ?? ''
      return Promise.resolve({
        text,
        rows: text
          .split('\n')
          .map((row, i) => ({ text: row, box: row.trim() ? [0, i * 40, 600, 30] : null })),
        version: 'tesseract 5.5.0 · test',
      })
    },
    strips(_photo: Buffer, boxes: readonly unknown[]): Promise<Buffer[]> {
      return Promise.resolve(boxes.map((_, i) => Buffer.from([0x89, 0x50, 0x4e, 0x47, i])))
    },
  }
  return reader
}

/** The model as a test wants it: an answer, or a throw. */
function fakeModel(
  answer: () => Promise<ModelReading>,
  input = 10_000,
): ReceiptModel & { asked: number } {
  const model = {
    asked: 0,
    version: 'claude-haiku-5-5@v3',
    inputTokensMax: () => input,
    read: () => {
      model.asked += 1
      return answer()
    },
  }
  return model
}

const read = (cost = 2_180): Promise<ModelReading> =>
  Promise.resolve({ kind: 'read', answer: ANSWER, costMicroUsd: cost })

async function readAll(
  reader: ReceiptReader,
  model: ReceiptModel | null,
  { cap = CAP, now }: { cap?: number; now?: () => Date } = {},
): Promise<ReadReport[]> {
  const reports: ReadReport[] = []
  await readQueuedReceipts({
    receipts: repository,
    reader,
    report: (event) => reports.push(event),
    bind: (claimed, lines) =>
      bindReceiptLines(
        { items: createItemRepository(db), embedder: NO_EMBEDDER },
        claimed.actorId,
        claimed.country,
        claimed.language,
        lines,
      ),
    model: model === null ? null : { reader: model, spend, capMicroUsd: cap },
    ...(now === undefined ? {} : { now }),
  })
  return reports
}

const receiptOf = async (id: string) =>
  (await db.select().from(receipts).where(eq(receipts.id, id)))[0]
const month = () => spend.month(spendMonthOf(new Date()))

describe('the model reads whoever it is granted to (MOL-272, В-4)', () => {
  it('reads by the model, through the one check, with no strip cut and its price counted', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const reader = benchReader()
    const model = fakeModel(() => read())
    const reports = await readAll(reader, model)
    expect([model.asked, reader.asked]).toEqual([1, 0])
    const row = await receiptOf(id)
    expect(row).toMatchObject({
      status: 'parsed',
      readerVersion: 'claude-haiku-5-5@v3',
      layout: 'card',
      tin: '01234567',
      totalMinor: 102_710n,
      balanced: true,
      city: 'Гюмри',
    })
    const lines = await db.select().from(receiptLines).where(eq(receiptLines.receiptId, id))
    expect(lines.map((line) => [line.printed, line.sumMinor])).toEqual([
      ['Կաթ «Օրինակ» 3.2% 1լ', 74_000n],
      ['Հաց «Օրինակ»', 28_710n],
    ])
    expect(await db.select().from(receiptLineImages)).toEqual([])
    expect(await month()).toEqual({ spentMicroUsd: 2_180, calls: 1, noticed: 0 })
    expect(reports.find((r) => r.kind === 'read')).toMatchObject({
      reader: 'model',
      costMicroUsd: 2_180,
    })
  }, 30_000)

  it('leaves to Tesseract whoever has no grant, a grant past or ending now, or no edition 3', async () => {
    const people = [
      await person(null),
      await person(new Date(Date.now() - 1_000)),
      await person(new Date()),
      await person(LATER, MODEL_CONSENT_EDITION - 1),
      await person(LATER, null),
    ]
    for (const one of people) await queued(one)
    const reader = benchReader()
    const model = fakeModel(() => read())
    await readAll(reader, model)
    expect(model.asked).toBe(0)
    const rows = await db.select({ version: receipts.readerVersion }).from(receipts)
    expect(rows.map((row) => row.version)).toEqual(Array(5).fill('tesseract 5.5.0 · test'))
    expect(await month()).toBeNull()
  }, 30_000)

  it('leaves to Tesseract a granted receipt where the API has no key', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    await readAll(benchReader(), null)
    expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
  }, 30_000)
})

describe('the month’s cap (Т-4, В-2 «а»)', () => {
  // 10 000 tokens in and the whole output: 1 000 + 8 000 micro-dollars
  const WORST = 9_000

  it('lets the call that fits exactly, and leaves the next one to Tesseract, telling the stop', async () => {
    const me = await person(LATER)
    await queued(me)
    const model = fakeModel(() => read(WORST))
    await readAll(benchReader(), model, { cap: WORST })
    expect(model.asked).toBe(1)
    const id = await queued(me)
    const reports = await readAll(benchReader(), model, { cap: WORST })
    expect(model.asked).toBe(1)
    expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
    expect(reports).toContainEqual({ kind: 'model_passed', reason: 'cap' })
    const told = await db.select({ payload: ownerNotices.payload }).from(ownerNotices)
    expect(told.map((row) => (row.payload as { step: number }).step)).toEqual([90, 100])
  }, 30_000)

  it('leaves to Tesseract a call a micro-dollar past the cap, asking nothing', async () => {
    const me = await person(LATER)
    await queued(me)
    const model = fakeModel(() => read())
    await readAll(benchReader(), model, { cap: WORST - 1 })
    expect(model.asked).toBe(0)
  }, 30_000)

  it('leaves to Tesseract photos past what the price holds, and counts nothing', async () => {
    const me = await person(LATER)
    await queued(me)
    const model = fakeModel(() => read(), 100_001)
    const reports = await readAll(benchReader(), model)
    expect([model.asked, await month()]).toEqual([0, null])
    expect(reports).toContainEqual({ kind: 'model_passed', reason: 'size' })
  }, 30_000)
})

describe('an answer not taken is paid and read by Tesseract (Т-3, В-1 «а»)', () => {
  for (const kind of ['refused', 'cut', 'invalid'] as const) {
    it(`reads a receipt the model answered «${kind}» by Tesseract`, async () => {
      const me = await person(LATER)
      const id = await queued(me)
      const reader = benchReader()
      const model = fakeModel(() => Promise.resolve({ kind, costMicroUsd: 3_000 }))
      const reports = await readAll(reader, model)
      expect(reader.asked).toBe(2)
      expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
      expect((await month())?.spentMicroUsd).toBe(3_000)
      expect(reports).toContainEqual({ kind: 'model_passed', reason: kind })
    }, 30_000)
  }

  it('reads by Tesseract a request the API refused for what it is, paying nothing', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const model = fakeModel(() => Promise.reject(new ModelRejected(400)))
    const reports = await readAll(benchReader(), model)
    expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
    expect((await month())?.spentMicroUsd).toBe(0)
    expect(reports.some((r) => r.kind === 'model_rejected')).toBe(true)
  }, 30_000)
})

describe('the model away (Р-9)', () => {
  it('keeps the receipt queued, its attempt uncounted, while it is within its wait', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const reader = benchReader()
    const model = fakeModel(() => Promise.reject(new ModelUnavailable('status 529', 0)))
    const reports = await readAll(reader, model)
    expect(reader.asked).toBe(0)
    expect(await receiptOf(id)).toMatchObject({ status: 'queued', attempts: 0 })
    expect((await month())?.spentMicroUsd).toBe(0)
    expect(reports).toContainEqual({ kind: 'model_unavailable', reason: 'status 529' })
  }, 30_000)

  it('keeps the worst counted for a time out, whose price is not known', async () => {
    const me = await person(LATER)
    await queued(me)
    const model = fakeModel(() => Promise.reject(new ModelUnavailable('timeout', null)))
    await readAll(benchReader(), model)
    expect((await month())?.spentMicroUsd).toBe(9_000)
  }, 30_000)

  it('leaves it to Tesseract once it waited past the wait, not a millisecond before', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const [row] = await db
      .select({ queuedAt: receipts.queuedAt })
      .from(receipts)
      .where(eq(receipts.id, id))
    const queuedAt = row?.queuedAt?.getTime() ?? 0
    const model = fakeModel(() => Promise.reject(new ModelUnavailable('unreachable', 0)))
    await readAll(benchReader(), model, {
      now: () => new Date(queuedAt + RECEIPT_MODEL_WAIT_MS - 1),
    })
    expect((await receiptOf(id))?.status).toBe('queued')
    const reports = await readAll(benchReader(), model, {
      now: () => new Date(queuedAt + RECEIPT_MODEL_WAIT_MS),
    })
    expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
    expect(reports).toContainEqual({ kind: 'model_passed', reason: 'away' })
  }, 30_000)
})

describe('what the model read', () => {
  it('is «переснимите» where it read nothing, and a sum to record where it read a section', async () => {
    const me = await person(LATER)
    const nothing = await queued(me)
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({
          kind: 'read',
          answer: { ...ANSWER, lines: [], totals: [] },
          costMicroUsd: 1_000,
        }),
      ),
    )
    expect(await receiptOf(nothing)).toMatchObject({ status: 'failed', failure: 'reshoot' })
    const section = await queued(me)
    const totals = [
      { label: 'Բաժին 1', amount: '1700.00' },
      { label: 'Ընդամենը', amount: '1700.00' },
    ]
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({
          kind: 'read',
          answer: { ...ANSWER, lines: [], totals },
          costMicroUsd: 1_000,
        }),
      ),
    )
    expect(await receiptOf(section)).toMatchObject({
      status: 'parsed',
      layout: 'department',
      totalMinor: 170_000n,
    })
  }, 30_000)

  it('goes with its person: erased, the receipt and its lines go, the month’s spending stays', async () => {
    const me = await person(LATER)
    await queued(me)
    await readAll(
      benchReader(),
      fakeModel(() => read()),
    )
    await db.execute(sql`delete from ${actors} where id = ${me.id}::uuid`)
    expect(await db.select().from(receipts)).toEqual([])
    expect((await month())?.spentMicroUsd).toBe(2_180)
  }, 30_000)
})
