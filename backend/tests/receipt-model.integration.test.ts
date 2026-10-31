import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MODEL_CONSENT_EDITION,
  dayIn,
  ownerNoticeSchema,
  receiptDetailCodec,
  spendMonthOf,
} from '@molvia/model'
import type { ModelReceipt } from '@molvia/model'
import am05 from '@molvia/model/testing/receipt-text.am-05.json'
import type { FastifyInstance } from 'fastify'
import { createItemRepository } from '@/db/items-repository'
import { createModelSpendRepository } from '@/db/model-spend-repository'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { createReceiptMissesRepository } from '@/db/receipt-misses-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
import { createStoreMemoryRepository } from '@/db/store-memory-repository'
import {
  actors,
  modelReceiptDays,
  ownerNotices,
  receiptDays,
  receiptLineImages,
  receiptLines,
  receiptMissParts,
  receiptMisses,
  receiptParts,
  receiptReasonDays,
  receipts,
  storeMemory as storeMemoryTable,
} from '@/db/schema'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import { ModelRejected, ModelUnavailable, receiptModel } from '@/receipts/model-reader'
import type { ModelReading, ReceiptModel } from '@/receipts/model-reader'
import type { ReaderReading, ReceiptReader } from '@/receipts/reader'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import { RECEIPT_MODEL_WAIT_MS, readQueuedReceipts } from '@/usecases/read-receipts'
import type { ReadReceiptsDeps, ReadReport } from '@/usecases/read-receipts'
import { receiptMisses as receiptMissesCommand } from '@/receipt-misses'
import {
  PHONE_NOTICES_PER_HOUR,
  PHONE_NOTICES_PER_SENDER,
  phoneNoticeBudget,
} from '@/usecases/record-failure'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

// Which reader reads a receipt (MOL-272): the model for whoever it is granted to and accepted edition 3,
// under the month's cap, Tesseract otherwise and whenever the model is not the one to (В-1 «а»).

const { db, close } = connectDrizzle()
const repository = createReceiptRepository(db)
const memory = createStoreMemoryRepository(db)
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
  id_rows: ['ՀՎՀՀ: 01234567', 'ԳՀ: 55512345', 'ԿՀ: 000123', 'Ֆիսկալ համար 27410811'],
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

async function queued(
  me: Person,
  capturedAt = '2026-10-08T16:00:00.000Z',
  id: string = randomUUID(),
): Promise<string> {
  const sent = await app.inject({
    method: 'POST',
    url: '/receipts',
    headers: { cookie: me.cookie },
    payload: {
      id,
      parts: 1,
      country: 'AM',
      language: 'ru',
      capturedAt,
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
  input: number | null = 10_000,
): ReceiptModel & { asked: number } {
  const model = {
    asked: 0,
    version: 'claude-haiku-5-5@v5',
    inputTokensMax: () => input,
    read: () => {
      model.asked += 1
      return answer()
    },
  }
  return model
}

const TOKENS = { input: 5_909, output: 3_177 }

const read = (cost = 2_180): Promise<ModelReading> =>
  Promise.resolve({ kind: 'read', answer: ANSWER, costMicroUsd: cost, tokens: TOKENS })

async function readAll(
  reader: ReceiptReader,
  model: ReceiptModel | null,
  {
    cap = CAP,
    now,
    told,
    receipts = repository,
  }: {
    cap?: number
    now?: () => Date
    told?: ReadReceiptsDeps['told']
    receipts?: ReadReceiptsDeps['receipts']
  } = {},
): Promise<ReadReport[]> {
  const reports: ReadReport[] = []
  await readQueuedReceipts({
    receipts,
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
    storeMemory: memory,
    ...(now === undefined ? {} : { now }),
    ...(told === undefined ? {} : { told }),
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
      readerVersion: 'claude-haiku-5-5@v5',
      layout: 'card',
      tin: '01234567',
      totalMinor: 102_710n,
      balanced: true,
      city: 'Гюмри',
      // «Վճարված է Առձեռն» — in hand (MOL-312)
      paidBy: 'cash',
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
      tokens: TOKENS,
      unparsed: 0,
    })
  }, 30_000)

  it('reads a discount with its minus and a sum with its comma, and counts what it could not (MOL-294)', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const [milk, bread] = ANSWER.lines
    const spelt: ModelReceipt = {
      ...ANSWER,
      lines: [
        { ...milk!, sum: '740,00', article: null },
        { ...bread!, discount: '-2.90', sum: '287,1' },
        { ...milk!, printed: 'Թեյ «Օրինակ»', quantity: '1', unit_price: '7,4,0', sum: '740' },
      ],
      totals: [
        { label: 'Ընդամենը', amount: '1 767,10' },
        { label: 'Վճարված է Առձեռն', amount: '1 767.10' },
      ],
    }
    const model = fakeModel(() =>
      Promise.resolve({ kind: 'read', answer: spelt, costMicroUsd: 2_180, tokens: TOKENS }),
    )
    const reports = await readAll(benchReader(), model)
    const lines = await db.select().from(receiptLines).where(eq(receiptLines.receiptId, id))
    expect(lines.map((line) => [line.printed, line.sumMinor, line.discountMinor])).toEqual([
      ['Կաթ «Օրինակ» 3.2% 1լ', 74_000n, null],
      ['Հաց «Օրինակ»', 28_710n, 290n],
      ['Թեյ «Օրինակ»', null, null],
    ])
    // the count alone, never the figure (Т-8)
    expect(reports.find((r) => r.kind === 'read')).toMatchObject({ reader: 'model', unparsed: 1 })
    expect(JSON.stringify(reports)).not.toContain('7,4,0')
  }, 30_000)

  it('leaves to Tesseract whoever has no grant, a grant past or ending now, or no edition 5 (MOL-319)', async () => {
    const people = [
      await person(null),
      await person(new Date(Date.now() - 1_000)),
      await person(new Date()),
      await person(LATER, MODEL_CONSENT_EDITION - 1),
      // edition 3 named Anthropic, in the United States alone (MOL-319)
      await person(LATER, 3),
      await person(LATER, null),
    ]
    for (const one of people) await queued(one)
    const reader = benchReader()
    const model = fakeModel(() => read())
    const reports = await readAll(reader, model)
    expect(model.asked).toBe(0)
    // Tesseract's figures are no model's: no count at all
    expect(reports.filter((r) => r.kind === 'read').map((r) => r.unparsed)).toEqual(
      Array(6).fill(null),
    )
    const rows = await db.select({ version: receipts.readerVersion }).from(receipts)
    expect(rows.map((row) => row.version)).toEqual(Array(6).fill('tesseract 5.5.0 · test'))
    expect(await month()).toBeNull()
  }, 30_000)

  it('leaves to Tesseract a granted receipt where the API has no key', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    await readAll(benchReader(), null)
    expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
  }, 30_000)
})

describe('the date a receipt prints, held to the window of its arrival (MOL-305)', () => {
  // 10:06 UTC is 14:06 in Gyumri: sent and taken in on 23 October 2026, as the owner's of IP Mobile
  const SENT = '2026-10-23T10:06:00.000Z'
  /** A receipt the phone stamped `capturedAt` and the server took in at `arrivedAt`, its own clock. */
  const arrived = async (me: Person, arrivedAt: string, capturedAt = arrivedAt) => {
    const id = await queued(me, capturedAt)
    await db
      .update(receipts)
      .set({ createdAt: new Date(arrivedAt) })
      .where(eq(receipts.id, id))
    return id
  }
  const head = async (date: string | null, time: string | null, capturedAt = SENT) => {
    const id = await arrived(await person(LATER), SENT, capturedAt)
    const answer: ModelReceipt = { ...ANSWER, date, time }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer, costMicroUsd: 2_180, tokens: TOKENS }),
      ),
    )
    const row = await receiptOf(id)
    expect(row?.status).toBe('parsed')
    return [row?.printedOn ?? null, row?.printedTime ?? null]
  }

  it('takes the date as asked, or as printed day first by the card', async () => {
    expect(await head('2026-10-23', '14:06')).toEqual(['2026-10-23', '14:06'])
    expect(await head('23-10-26', '14:06')).toEqual(['2026-10-23', '14:06'])
    expect(await head('04.10.2026', '19:57:31')).toEqual(['2026-10-04', '19:57'])
  }, 30_000)

  it('takes no date the model ordered year first three years back, nor its time', async () => {
    // what prompt v5 brought back of «23-10-26»: the purchases go to the day it was sent, never 2023
    expect(await head('2023-10-26', '14:06')).toEqual([null, null])
    // read in the card's order, «26-10-23» is 26 October 2023 all the same
    expect(await head('26-10-23', '14:06')).toEqual([null, null])
  }, 30_000)

  it('takes a date from the same day six months before to the day after, and no further (В-5 «а»)', async () => {
    // a photo picked from the gallery weeks after the purchase keeps its date
    expect(await head('20-09-26', '10:00')).toEqual(['2026-09-20', '10:00'])
    expect(await head('23-04-26', '10:00')).toEqual(['2026-04-23', '10:00'])
    expect(await head('22-04-26', '10:00')).toEqual([null, null])
    expect(await head('24-10-26', '10:00')).toEqual(['2026-10-24', '10:00'])
    // must not: a two-digit year that makes a day past it is no date
    expect(await head('25-10-26', '10:00')).toEqual([null, null])
  }, 30_000)

  it('holds Tesseract’s reading to the same window', async () => {
    // Tesseract reads am-05's moment as 01.10.2026 12:00: taken in within half a year after, its date; a day later, none
    const byOcr = async (at: string) => {
      const id = await arrived(await person(null), at)
      await readAll(benchReader(), null)
      const row = await receiptOf(id)
      return [row?.printedOn ?? null, row?.printedTime ?? null]
    }
    expect(await byOcr('2026-10-08T16:00:00.000Z')).toEqual(['2026-10-01', '12:00'])
    expect(await byOcr('2027-04-01T08:00:00.000Z')).toEqual(['2026-10-01', '12:00'])
    expect(await byOcr('2027-04-02T08:00:00.000Z')).toEqual([null, null])
    // must not: taken in before the day it prints
    expect(await byOcr('2026-09-29T08:00:00.000Z')).toEqual([null, null])
  }, 30_000)

  it('counts the window by the server’s clock, never the phone’s (adversarial А3, Р2-А3)', async () => {
    // a battery that died: 1970, 2000, the firmware's day, two days behind — the receipt's own date stands
    for (const clock of [
      '1970-01-01T00:05:00.000Z',
      '2000-01-01T00:05:00.000Z',
      '2025-01-01T00:05:00.000Z',
      '2026-10-21T10:06:00.000Z',
    ]) {
      expect(await head('23-10-26', '14:06', clock)).toEqual(['2026-10-23', '14:06'])
    }
  }, 60_000)
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

  it('leaves to Tesseract photos past what the API takes, telling no failure (review №3)', async () => {
    const me = await person(LATER)
    await queued(me)
    const model = fakeModel(() => read(), null)
    const reports = await readAll(benchReader(), model)
    expect([model.asked, await month()]).toEqual([0, null])
    expect(reports).toContainEqual({ kind: 'model_passed', reason: 'size' })
    expect(reports.some((r) => r.kind === 'error' || r.kind === 'model_rejected')).toBe(false)
  }, 30_000)
})

describe('an answer not taken is paid and read by Tesseract (Т-3, В-1 «а»)', () => {
  for (const kind of ['refused', 'cut', 'invalid'] as const) {
    it(`reads a receipt the model answered «${kind}» by Tesseract`, async () => {
      const me = await person(LATER)
      const id = await queued(me)
      const reader = benchReader()
      const model = fakeModel(() => Promise.resolve({ kind, costMicroUsd: 3_000, tokens: TOKENS }))
      const reports = await readAll(reader, model)
      expect(reader.asked).toBe(2)
      expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
      expect((await month())?.spentMicroUsd).toBe(3_000)
      expect(reports).toContainEqual({
        kind: 'model_passed',
        reason: kind,
        paid: { costMicroUsd: 3_000, tokens: TOKENS },
      })
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

describe('a failure of the model’s own client (review №4)', () => {
  it('reads the receipt by Tesseract, tells the owner, and keeps the worst counted', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const reader = benchReader()
    const model = fakeModel(() => Promise.reject(new TypeError('a bug of ours')))
    const reports = await readAll(reader, model)
    expect(reader.asked).toBe(2)
    expect((await receiptOf(id))?.readerVersion).toBe('tesseract 5.5.0 · test')
    expect(reports.some((r) => r.kind === 'error')).toBe(true)
    expect((await month())?.spentMicroUsd).toBe(9_000)
  }, 30_000)
})

describe('the model away (Р-9)', () => {
  it('waits for an answer torn under its body, and the owner hears of it — a torn one and a fault of ours look alike (review №8)', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const torn = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"id":"msg_1",'))
              controller.error(new TypeError('terminated'))
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )) as typeof fetch
    const real = receiptModel({ apiKey: 'sk-ant-test', fetch: torn })
    const model = Object.assign(real, { inputTokensMax: () => 10_000 })
    const reports = await readAll(benchReader(), model)
    expect(await receiptOf(id)).toMatchObject({ status: 'queued', attempts: 0 })
    expect(reports).toContainEqual({ kind: 'model_unavailable', reason: 'dropped' })
    expect(reports.some((r) => r.kind === 'model_broken')).toBe(true)
    expect((await month())?.spentMicroUsd).toBe(9_000)
  }, 30_000)

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
  it('keeps what a card sent to the card, and calls such a receipt read whole (MOL-289)', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    // the lines make 1 027,10; 10,27 went to the card; «Ընդամենը:» 1 037,37 left it, 100,00 of the
    // bonus spent and the rest paid by card, rounded to the dram
    const totals = [
      { label: 'Ընդամենը', amount: '1027.12' },
      { label: '/ԱԱՀ-ով հարկվող/ =', amount: '1027.10' },
      { label: 'Ընդամենը:', amount: '1037.37' },
      { label: 'Վճարված է PosTerminal:', amount: '937.00' },
      { label: 'Կանխավճարի մարում:', amount: '100.00' },
      { label: 'Զեղչ գործարքից:', amount: '10.27' },
      { label: 'Ընդամենը ամվա սկզբից:', amount: '139432.00' },
    ]
    const reports = await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({
          kind: 'read',
          answer: { ...ANSWER, totals },
          costMicroUsd: 1_000,
          tokens: TOKENS,
        }),
      ),
    )
    expect(await receiptOf(id)).toMatchObject({
      status: 'parsed',
      totalMinor: 103_737n,
      readTotalMinor: 103_737n,
      cashbackMinor: 1_027n,
      redeemedMinor: 10_000n,
      balanced: true,
      readPartly: false,
      // by the POS terminal; the bonus spent is no payment (MOL-312)
      paidBy: 'card',
    })
    expect(reports.find((r) => r.kind === 'read')).toMatchObject({ partly: false })
  }, 30_000)

  it('keeps a line the font’s swaps put right, the receipt whole by it, never as read (MOL-290)', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    // printed 1 × 530 − 5,3 = 524,7 and copied with a discount of 6,3; the bread prints the card's 1 %
    const curd = {
      printed: 'Կաթնաշոռ «Օրինակ»',
      code: '0406',
      article: '1110003',
      quantity: '1',
      unit: 'pcs' as const,
      unit_price: '530',
      discount: '6.3',
      sum: '524.7',
    }
    const totals = [
      { label: 'Ընդամենը', amount: '1551.80' },
      { label: 'Վճարված է Առձեռն', amount: '1551.80' },
    ]
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({
          kind: 'read',
          answer: { ...ANSWER, lines: [...ANSWER.lines, curd], totals },
          costMicroUsd: 1_000,
          tokens: TOKENS,
        }),
      ),
    )
    expect(await receiptOf(id)).toMatchObject({
      status: 'parsed',
      totalMinor: 155_180n,
      balanced: true,
      readPartly: false,
    })
    const lines = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
      .orderBy(receiptLines.position)
    expect(lines.map((line) => [line.discountMinor, line.sumMinor, line.repaired])).toEqual([
      [null, 74_000n, false],
      [290n, 28_710n, false],
      [530n, 52_470n, true],
    ])
  }, 30_000)

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
          tokens: TOKENS,
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
          tokens: TOKENS,
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

describe('the shop’s memory in the digits (MOL-291)', () => {
  const TIN = '01234567'
  const BUTTER = '1110004'
  // printed 1 × 550 − 5,5 = 544,5, copied 650 / 5,6 / 544,5; the total in one place only, so the font's swaps by the
  // total (MOL-290) put nothing right — the memory alone
  const butter = {
    printed: 'Կարագ «Օրինակ»',
    code: '0405',
    article: BUTTER,
    quantity: '1',
    unit: 'pcs' as const,
    unit_price: '650',
    discount: '5.6',
    sum: '544.5',
  }
  const answer = (over: Partial<ModelReceipt> = {}): ModelReceipt => ({
    ...ANSWER,
    lines: [...ANSWER.lines, butter],
    totals: [{ label: 'Ընդամենը', amount: '1571.60' }],
    ...over,
  })
  const model = (copied = answer()) =>
    fakeModel(() =>
      Promise.resolve({ kind: 'read', answer: copied, costMicroUsd: 1_000, tokens: TOKENS }),
    )
  const say = async (actorId: string, itemId: string, drams = 550) =>
    memory.remember(actorId, TIN, [
      { kind: 'sku', key: BUTTER, itemId, price: { minor: BigInt(drams * 100), currency: 'AMD' } },
    ])
  const butterOf = async (id: string) =>
    (
      await db
        .select()
        .from(receiptLines)
        .where(sql`${receiptLines.receiptId} = ${id} and ${receiptLines.position} = 2`)
    )[0]

  it('puts a line right by the person’s own shelf price, and leaves it empty with none', async () => {
    const item = await insertItem(db, { name: 'Масло сливочное', searchKey: 'maslo slivochnoe' })
    const me = await person(LATER)
    await say(me.id, item)
    const mine = await queued(me)
    const someone = await person(LATER)
    const theirs = await queued(someone)
    const reports = await readAll(benchReader(), model())
    expect(await butterOf(mine)).toMatchObject({
      priceMinor: 55_000n,
      discountMinor: 550n,
      sumMinor: 54_450n,
      repaired: true,
      remembered: true,
    })
    // the reading of a person the memory has no word of, and only one stranger's: as before
    expect(await butterOf(theirs)).toMatchObject({ sumMinor: null, remembered: false })
    expect(reports.flatMap((r) => (r.kind === 'read' ? [r.remembered] : []))).toEqual([
      { confirmed: 0, repaired: 1, doubted: 0 },
      { confirmed: 0, repaired: 0, doubted: 0 },
    ])
  }, 30_000)

  it('takes other people’s price from three of them, with no access (owner’s В-1 «в»)', async () => {
    const item = await insertItem(db, { name: 'Масло сливочное', searchKey: 'maslo slivochnoe' })
    await say(await insertActor(db), item)
    await say(await insertActor(db), item)
    const me = await person(LATER)
    const two = await queued(me)
    await readAll(benchReader(), model())
    expect((await butterOf(two))?.remembered).toBe(false)
    await say(await insertActor(db), item)
    const three = await queued(me)
    await readAll(benchReader(), model())
    expect(await butterOf(three)).toMatchObject({ priceMinor: 55_000n, remembered: true })
  }, 30_000)

  it('asks nothing without the seller’s tax number', async () => {
    const item = await insertItem(db, { name: 'Масло сливочное', searchKey: 'maslo slivochnoe' })
    const me = await person(LATER)
    await say(me.id, item)
    const id = await queued(me)
    await readAll(benchReader(), model(answer({ id_rows: ['ԿՀ: 000123'] })))
    expect((await butterOf(id))?.remembered).toBe(false)
  }, 30_000)

  it('puts nothing right against a total two places print — the butter gone up to 650 (adversarial А1)', async () => {
    const item = await insertItem(db, { name: 'Масло сливочное', searchKey: 'maslo slivochnoe' })
    const me = await person(LATER)
    await say(me.id, item)
    const id = await queued(me)
    // printed 1 × 650 = 650, the price copied «660»; remembered 550; the total 650 in two places
    const gone = { ...butter, unit_price: '660', discount: null, sum: '650' }
    await readAll(
      benchReader(),
      model(
        answer({
          lines: [gone],
          totals: [
            { label: 'Ընդամենը', amount: '650' },
            { label: 'Վճարված է Առձեռն', amount: '650' },
          ],
        }),
      ),
    )
    expect(
      await db.select().from(receiptLines).where(eq(receiptLines.receiptId, id)),
    ).toMatchObject([{ priceMinor: null, sumMinor: null, repaired: false, remembered: false }])
  }, 30_000)

  // MOL-314: the hint «В прошлый раз здесь было 550 — проверьте цифры» argued with the voices that settled it
  it('hints no old price over a line its total proved, and hints it where no total did', async () => {
    const item = await insertItem(db, { name: 'Масло сливочное', searchKey: 'maslo slivochnoe' })
    const me = await person(LATER)
    await say(me.id, item)
    // the butter gone up to 650, copied as printed: 1 × 650 = 650
    const gone = { ...butter, unit_price: '650', discount: null, sum: '650' }
    const reviewed = async (totals: ModelReceipt['totals']) => {
      const id = await queued(me)
      await readAll(benchReader(), model(answer({ lines: [gone], totals })))
      const [stored] = await db.select().from(receipts).where(eq(receipts.id, id))
      const response = await app.inject({
        method: 'GET',
        url: `/receipts/${id}`,
        headers: { cookie: me.cookie, 'x-molvia-today': '2026-10-22' },
      })
      expect(response.statusCode).toBe(200)
      const [line] = receiptDetailCodec.parse(response.json()).lines
      return { balanced: stored?.balanced, price: line?.price, hint: line?.rememberedPrice }
    }
    const amd = (drams: number) => ({ minor: BigInt(drams * 100), currency: 'AMD' })

    expect(
      await reviewed([
        { label: 'Ընդամենը', amount: '650' },
        { label: 'Վճարված է Առձեռն', amount: '650' },
      ]),
    ).toEqual({ balanced: true, price: amd(650), hint: null })
    // in one place, met by the lines as copied, it is the second source (MOL-244) and the memory says nothing (MOL-291)
    expect(await reviewed([{ label: 'Ընդամենը', amount: '650' }])).toEqual({
      balanced: true,
      price: amd(650),
      hint: null,
    })
    // no total: the memory doubts the line, the check empties it, and the hint is what to type it by
    expect(await reviewed([])).toEqual({ balanced: false, price: null, hint: amd(550) })
  }, 30_000)

  // MOL-314, owner's В-4 «а» (adversarial А1): the faded font copied both ways, +100 and −100, under a total two places
  // print — the receipt proven whole, every line as copied, and the total says nothing of which price is right
  it('hints both old prices over two lines copied the opposite ways under a total they meet', async () => {
    const item = await insertItem(db, { name: 'Масло сливочное', searchKey: 'maslo slivochnoe' })
    const cheese = await insertItem(db, { name: 'Сыр', searchKey: 'syr' })
    const me = await person(LATER)
    await say(me.id, item)
    await memory.remember(me.id, TIN, [
      { kind: 'sku', key: '1110005', itemId: cheese, price: { minor: 66_000n, currency: 'AMD' } },
    ])
    const id = await queued(me)
    const lines = [
      { ...butter, unit_price: '650', discount: null, sum: '650' },
      { ...butter, article: '1110005', unit_price: '560', discount: null, sum: '560' },
    ]
    const totals = [
      { label: 'Ընդամենը', amount: '1210' },
      { label: 'Վճարված է Առձեռն', amount: '1210' },
    ]
    await readAll(benchReader(), model(answer({ lines, totals })))
    const [stored] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect(stored?.balanced).toBe(true)
    const response = await app.inject({
      method: 'GET',
      url: `/receipts/${id}`,
      headers: { cookie: me.cookie, 'x-molvia-today': '2026-10-22' },
    })
    expect(response.statusCode).toBe(200)
    const shown = receiptDetailCodec.parse(response.json()).lines
    expect(shown.map((line) => [line.price?.minor, line.rememberedPrice?.minor])).toEqual([
      [65_000n, 55_000n],
      [56_000n, 66_000n],
    ])
  }, 30_000)

  it('shows no price of other people’s that the line’s own sum does not hold, and doubts nothing by it (А2, review №4)', async () => {
    const item = await insertItem(db, { name: 'Масло сливочное', searchKey: 'maslo slivochnoe' })
    const cheese = await insertItem(db, { name: 'Сыр', searchKey: 'syr' })
    for (let i = 0; i < 3; i += 1) {
      const stranger = await insertActor(db)
      await say(stranger, item)
      await memory.remember(stranger, TIN, [
        { kind: 'sku', key: '1110005', itemId: cheese, price: { minor: 55_000n, currency: 'AMD' } },
      ])
    }
    const me = await person(LATER)
    const id = await queued(me)
    // the butter 1 × 650 = 650 copied «660 / 650»; the cheese 2 × 560 = 1 120 as printed; the bread copied wrong
    const lines = [
      { ...butter, unit_price: '660', discount: null, sum: '650' },
      {
        ...butter,
        article: '1110005',
        discount: null,
        quantity: '2',
        unit_price: '560',
        sum: '1120',
      },
      { ...ANSWER.lines[0]!, sum: '760' },
    ]
    await readAll(
      benchReader(),
      model(answer({ lines, totals: [{ label: 'Ընդամենը', amount: '2510' }] })),
    )
    const stored = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
      .orderBy(receiptLines.position)
    expect(stored.map((line) => [line.priceMinor, line.sumMinor, line.remembered])).toEqual([
      [null, null, false],
      [56_000n, 112_000n, false],
      [null, null, false],
    ])
  }, 30_000)

  it('keeps the remembered price in the person’s word once recorded as shown (owner’s В-3 «а»)', async () => {
    const butterItem = await insertItem(db, {
      name: 'Масло сливочное',
      searchKey: 'maslo slivochnoe',
    })
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const bread = await insertItem(db, { name: 'Хлеб', searchKey: 'hleb' })
    const me = await person(LATER)
    await say(me.id, butterItem)
    const id = await queued(me)
    await readAll(benchReader(), model())
    const place = await insertPlace(db)
    const recorded = await app.inject({
      method: 'POST',
      url: `/receipts/${id}/record`,
      headers: { cookie: me.cookie, 'x-molvia-today': '2026-10-22' },
      payload: {
        tripId: randomUUID(),
        place: { id: place },
        purchasedOn: '2026-10-08',
        lines: [
          {
            position: 0,
            skip: false,
            item: { id: milk },
            quantity: { value: '2', unit: 'piece' },
            amount: { amount: '740', currency: 'AMD' },
          },
          {
            position: 1,
            skip: false,
            item: { id: bread },
            quantity: { value: '1', unit: 'piece' },
            amount: { amount: '287.1', currency: 'AMD' },
          },
          {
            position: 2,
            skip: false,
            item: { id: butterItem },
            quantity: { value: '1', unit: 'piece' },
            amount: { amount: '544.5', currency: 'AMD' },
          },
        ],
      },
    })
    expect(recorded.statusCode).toBe(200)
    expect((await butterOf(id))?.asRead).toBe(true)
    const words = await db
      .select()
      .from(storeMemoryTable)
      .where(sql`${storeMemoryTable.actorId} = ${me.id} and ${storeMemoryTable.key} = ${BUTTER}`)
    expect(words.map((word) => word.priceMinor)).toEqual([55_000n])
  }, 30_000)
})

describe('the key against a second record (Т-11, adversarial А5, А6, review №10)', () => {
  const as = (id_rows: string[], over: Partial<ModelReceipt> = {}) =>
    fakeModel(() =>
      Promise.resolve({
        kind: 'read',
        answer: { ...ANSWER, id_rows, ...over },
        costMicroUsd: 2_180,
        tokens: TOKENS,
      }),
    )
  const refused = fakeModel(() =>
    Promise.resolve({ kind: 'refused', costMicroUsd: 1_000, tokens: TOKENS }),
  )
  let places = 0
  const record = async (receiptId: string, actorId: string) => {
    const placeId = await insertPlace(db, { name: `Օրինակ ${String(++places)}` })
    const tripId = await insertTrip(db, { actorId, placeId })
    await repository.markRecorded(receiptId, {
      tripId,
      expenses: [],
      confirmed: [],
      priced: [],
      edits: {
        lines: 1,
        edited: 0,
        skipped: 0,
        item: 0,
        figures: 0,
        totalCorrected: false,
        added: 0,
      },
      source: 'photo',
      codesWritten: 0,
    })
  }
  const twinOf = async (id: string, actorId: string) => {
    const row = await receiptOf(id)
    if (row?.tin == null || row.receiptNo == null) return 'no key'
    return (await repository.recordedTwin(actorId, row.tin, row.receiptNo, id)) === null
      ? 'none'
      : 'found'
  }

  it('is one for one paper read by Tesseract and by the model', async () => {
    const me = await person(LATER)
    const first = await queued(me)
    await readAll(benchReader(), refused)
    expect(await receiptOf(first)).toMatchObject({ tin: '01234567', receiptNo: '12345678' })
    await record(first, me.id)
    const second = await queued(me)
    await readAll(
      benchReader(),
      as(['ՀՎՀՀ:01234567', 'ԳՀ:55512345', 'ԿՀ: 90264', 'Ֆիսկալ համար 12345678']),
    )
    expect(await twinOf(second, me.id)).toBe('found')
  }, 30_000)

  it('is none where the model copied the shop’s tax number under another label, as on the bench: two receipts of the till are both recorded', async () => {
    const me = await person(LATER)
    // am-10 and lit-9296 of v5: the till's registration and the shop's tax number, neither under «ՀՎՀՀ»
    const mixed = ['ԳՀ:55512345', 'ՀԴՄ:01234567', 'ԿՀ: 90264']
    const first = await queued(me)
    await readAll(benchReader(), as([...mixed, 'Ֆիսկալ համար 43542455']))
    expect(await receiptOf(first)).toMatchObject({ tin: null, receiptNo: '43542455' })
    await record(first, me.id)
    const second = await queued(me)
    await readAll(
      benchReader(),
      as([...mixed, 'Ֆիսկալ համար 99784818'], { date: '2026-10-09', time: '10:05' }),
    )
    expect(await twinOf(second, me.id)).toBe('no key')
  }, 30_000)

  it('is none where the model put the till’s registration under «Ֆիսկալ» and lost the fiscal row: the next receipt of the till is recorded', async () => {
    const me = await person(LATER)
    // adversarial А6, round 4: the tax number right, one label moved — the till's number is printed under «ԳՀ» too
    const moved = ['ԳՀ:55512345', 'ԿՀ: 90264', 'ՀՎՀՀ:01234567', 'Ֆիսկալ համար 55512345']
    const first = await queued(me)
    await readAll(benchReader(), as(moved))
    expect(await receiptOf(first)).toMatchObject({ tin: '01234567', receiptNo: null })
    await record(first, me.id)
    const second = await queued(me)
    await readAll(benchReader(), as(moved, { date: '2026-10-09', time: '10:05' }))
    expect(await twinOf(second, me.id)).toBe('no key')
  }, 30_000)
})

describe('the measure of 0.2r by its reader (MOL-272, В-6 «а»)', () => {
  const sums = async (table: typeof receiptDays | typeof modelReceiptDays) => {
    const rows = await db.select().from(table)
    return {
      read: rows.reduce((all, row) => all + row.read, 0),
      recorded: rows.reduce((all, row) => all + row.recorded, 0),
      lines: rows.reduce((all, row) => all + row.lines, 0),
      edited: rows.reduce((all, row) => all + row.linesEdited, 0),
    }
  }

  it('counts a reading and a record of the model in its own table, and Tesseract’s in its own', async () => {
    const granted = await person(LATER)
    const byModel = await queued(granted)
    const other = await person(null)
    await queued(other)
    await readAll(
      benchReader(),
      fakeModel(() => read()),
    )
    expect(await sums(modelReceiptDays)).toEqual({ read: 1, recorded: 0, lines: 0, edited: 0 })
    expect((await sums(receiptDays)).read + (await sums(receiptDays)).recorded).toBe(1)

    const placeId = await insertPlace(db, { name: 'Օրինակ' })
    const tripId = await insertTrip(db, { actorId: granted.id, placeId })
    await repository.markRecorded(byModel, {
      tripId,
      expenses: [],
      confirmed: [],
      priced: [],
      edits: {
        lines: 2,
        edited: 1,
        skipped: 0,
        item: 1,
        figures: 0,
        totalCorrected: false,
        added: 0,
      },
      source: 'photo',
      codesWritten: 0,
    })
    expect(await sums(modelReceiptDays)).toEqual({ read: 1, recorded: 1, lines: 2, edited: 1 })
    expect((await sums(receiptDays)).recorded).toBe(0)
  }, 30_000)

  it('counts a «переснимите» of the model in its own table', async () => {
    const me = await person(LATER)
    await queued(me)
    const nothing = { ...ANSWER, lines: [], totals: [] }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer: nothing, costMicroUsd: 1_000, tokens: TOKENS }),
      ),
    )
    const [row] = await db.select().from(modelReceiptDays)
    expect(row?.reshoot).toBe(1)
    expect(await db.select().from(receiptDays)).toEqual([])
  }, 30_000)
})

describe('a receipt read not whole: its reasons, its review and the developer told (MOL-309)', () => {
  // a third line whose own arithmetic does not hold: 1 × 500 is no 600
  const [milk, bread] = ANSWER.lines
  const NOT_WHOLE: ModelReceipt = {
    ...ANSWER,
    lines: [
      milk!,
      bread!,
      {
        printed: 'Թեյ «Օրինակ»',
        code: '0902',
        article: '1100001',
        quantity: '1',
        unit: 'pcs',
        unit_price: '500',
        discount: null,
        sum: '600',
      },
    ],
    totals: [
      { label: 'Ընդամենը', amount: '1627.10' },
      { label: 'Վճարված է Առձեռն', amount: '1627.10' },
    ],
  }
  const notWhole = () =>
    Promise.resolve<ModelReading>({
      kind: 'read',
      answer: NOT_WHOLE,
      costMicroUsd: 2_180,
      tokens: TOKENS,
    })
  const told = () => ({
    notices: createOwnerNoticeRepository(db),
    budget: phoneNoticeBudget(PHONE_NOTICES_PER_HOUR, PHONE_NOTICES_PER_SENDER, (count) => ({
      kind: 'receipt_partial_muted' as const,
      count,
    })),
  })
  const reasons = async () =>
    (await db.select().from(receiptReasonDays))
      .map((row) => `${row.reader} ${row.country} ${row.scope} ${row.reason} ${String(row.n)}`)
      .sort()
  // The real claim, told the review may not keep what it hands out (MOL-319): unreachable since the model reads
  // only edition 5, past the review's 4, and held for the day the review's edition outgrows the model's.
  const unreviewable: ReadReceiptsDeps['receipts'] = {
    ...repository,
    claimNext: async () => {
      const claimed = await repository.claimNext()
      return claimed === null ? null : { ...claimed, reviewable: false }
    },
  }
  const notices = async () =>
    (await db.select({ payload: ownerNotices.payload }).from(ownerNotices)).map(
      (row) => row.payload,
    )

  it('counts why, keeps the photo and the answer for the review, and tells the developer — no name, no sum', async () => {
    const me = await person(LATER)
    // an id that starts with one of the sums: the receipt is named by it all the same (MOL-316)
    const id = await queued(me, undefined, '600b451a-0000-4000-8000-000000000316')
    await readAll(benchReader(), fakeModel(notWhole), { told: told() })
    expect(await reasons()).toEqual([
      'model AM line unsettled 1',
      'model AM read lines 3',
      'model AM read receipts 1',
      'model AM receipt line_not_as_printed 1',
    ])
    const [kept] = await db.select().from(receiptMisses).where(eq(receiptMisses.receiptId, id))
    expect(kept).toMatchObject({
      readerVersion: 'claude-haiku-5-5@v5',
      reasons: { receipt: 'line_not_as_printed', lines: [null, null, 'unsettled'] },
      reading: NOT_WHOLE,
    })
    expect(await db.select().from(receiptMissParts)).toHaveLength(1)
    const [notice] = await notices()
    // read as the bot reads it: a field the schema does not name would lose the notice (adversarial А1)
    expect(ownerNoticeSchema.safeParse(notice).success).toBe(true)
    expect(notice).toMatchObject({
      kind: 'receipt_partial',
      country: 'AM',
      lines: 3,
      shown: 2,
      reason: 'line_not_as_printed',
    })
    // the id and the day may hold any digits: the name and the sums are looked for in the rest (MOL-316)
    const { receipt, keptUntil, ...rest } = notice as { receipt?: string; keptUntil?: string }
    expect(receipt).toBe(id.slice(0, 8))
    expect(keptUntil).toBe(dayIn(kept!.keepUntil))
    expect(JSON.stringify(rest)).not.toMatch(/Օրինակ|1627|600/)
    // the bot words each: no kind of line it does not have, no «Прочитали не всё» of lines that meet the total
    expect(rest).toHaveProperty('lineReasons', { unsettled: 1 })
    expect(rest).not.toHaveProperty('partly')
  }, 30_000)

  it('names the day of the review in Yerevan, where it is the next day in UTC (MOL-316)', async () => {
    const me = await person(LATER)
    await queued(me)
    // kept until 21:00 in UTC — already the 22nd in Yerevan: a day counted without the zone is a day short
    const evening: ReadReceiptsDeps['receipts'] = {
      ...repository,
      finish: async (id, outcome) => {
        const written = await repository.finish(id, outcome)
        return written?.keptUntil ? { keptUntil: new Date('2026-11-21T21:00:00.000Z') } : written
      },
    }
    await readAll(benchReader(), fakeModel(notWhole), { told: told(), receipts: evening })
    expect(await notices()).toMatchObject([{ kind: 'receipt_partial', keptUntil: '2026-11-22' }])
  }, 30_000)

  it('keeps the review after «Записать» deletes the receipt’s own photo, until its days pass', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    await readAll(benchReader(), fakeModel(notWhole))
    const placeId = await insertPlace(db, { name: 'Օրինակ' })
    const tripId = await insertTrip(db, { actorId: me.id, placeId })
    await repository.markRecorded(id, {
      tripId,
      expenses: [],
      confirmed: [],
      priced: [],
      edits: {
        lines: 3,
        edited: 0,
        skipped: 0,
        item: 0,
        figures: 0,
        totalCorrected: false,
        added: 0,
      },
      source: 'photo',
      codesWritten: 0,
    })
    await repository.purgeStale()
    expect(await db.select().from(receiptParts)).toEqual([])
    expect(await db.select().from(receiptMissParts)).toHaveLength(1)
    await db.update(receiptMisses).set({
      readAt: sql`clock_timestamp() - interval '22 days'`,
      keepUntil: sql`clock_timestamp() - interval '1 day'`,
    })
    await repository.purgeStale()
    expect(await db.select().from(receiptMisses)).toEqual([])
    expect(await db.select().from(receiptMissParts)).toEqual([])
  }, 30_000)

  it('goes with its receipt: the person erased', async () => {
    const me = await person(LATER)
    await queued(me)
    await readAll(benchReader(), fakeModel(notWhole))
    expect(await db.select().from(receiptMisses)).toHaveLength(1)
    await db.execute(sql`delete from ${actors} where id = ${me.id}::uuid`)
    expect(await db.select().from(receiptMisses)).toEqual([])
    expect(await db.select().from(receiptMissParts)).toEqual([])
    // the counts belong to nobody, and stay
    expect(await reasons()).toContain('model AM read receipts 1')
  }, 30_000)

  it('keeps and tells nothing of a receipt read whole, and counts it', async () => {
    const me = await person(LATER)
    await queued(me)
    await readAll(
      benchReader(),
      fakeModel(() => read()),
      { told: told() },
    )
    expect(await reasons()).toEqual(['model AM read lines 2', 'model AM read receipts 1'])
    expect(await db.select().from(receiptMisses)).toEqual([])
    expect(await notices()).toEqual([])
  }, 30_000)

  it('keeps and tells a «переснимите» of the model: nothing read is the most to type', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const nothing = { ...ANSWER, lines: [], totals: [] }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer: nothing, costMicroUsd: 1_000, tokens: TOKENS }),
      ),
      { told: told() },
    )
    expect(await reasons()).toEqual(['model AM read receipts 1', 'model AM receipt failed 1'])
    expect((await receiptOf(id))?.failure).toBe('reshoot')
    expect(await db.select().from(receiptMisses)).toHaveLength(1)
    expect(await notices()).toMatchObject([{ kind: 'receipt_partial', reason: 'failed', lines: 0 }])
  }, 30_000)

  it('counts Tesseract’s reasons, and neither keeps nor tells them (owner, В-4)', async () => {
    const me = await person(null)
    await queued(me)
    await readAll(benchReader(), fakeModel(notWhole), { told: told() })
    const counted = await reasons()
    expect(counted).toContain('ocr AM read receipts 1')
    expect(counted.some((row) => row.startsWith('model'))).toBe(false)
    expect(await db.select().from(receiptMisses)).toEqual([])
    expect(await notices()).toEqual([])
  }, 30_000)

  it('tells three of one person an hour, holds the rest and says how many once the hour is out', async () => {
    const me = await person(LATER)
    for (let i = 0; i < 4; i += 1) await queued(me)
    const channel = told()
    const at = new Date('2026-10-27T10:00:00Z')
    await readAll(benchReader(), fakeModel(notWhole), { told: channel, now: () => at })
    expect((await notices()).map((one) => (one as { kind: string }).kind)).toEqual([
      'receipt_partial',
      'receipt_partial',
      'receipt_partial',
    ])
    // every receipt is kept for the review all the same
    expect(await db.select().from(receiptMisses)).toHaveLength(4)
    const later = new Date(at.getTime() + 60 * 60 * 1000)
    await readAll(benchReader(), fakeModel(notWhole), { told: channel, now: () => later })
    expect((await notices()).at(-1)).toEqual({ kind: 'receipt_partial_muted', count: 1 })
  }, 30_000)

  // MOL-319, self-review №2: the guard of a receipt read in part.
  it('tells of a receipt the review may not keep, and keeps nothing of it (MOL-309, В-3 «б»)', async () => {
    const me = await person(LATER)
    await queued(me)
    await readAll(benchReader(), fakeModel(notWhole), { told: told(), receipts: unreviewable })
    expect(await db.select().from(receiptMisses)).toEqual([])
    const [notice] = await notices()
    expect(notice).toMatchObject({ kind: 'receipt_partial', reason: 'line_not_as_printed' })
    // nothing kept: no day, and no id that would name a receipt nothing here opens (self-review №3)
    expect(notice).not.toHaveProperty('keptUntil')
    expect(notice).not.toHaveProperty('receipt')
  }, 30_000)

  // adversarial Р2-А1: the guard stands in each outcome that keeps a review — a «переснимите» too, not only a
  // receipt read in part. Lines the wire refuses are the third place, which no answer of the model reaches.
  it('keeps nothing of a «переснимите» the review may not keep', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const nothing = { ...ANSWER, lines: [], totals: [] }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer: nothing, costMicroUsd: 1_000, tokens: TOKENS }),
      ),
      { told: told(), receipts: unreviewable },
    )
    expect((await receiptOf(id))?.failure).toBe('reshoot')
    expect(await db.select().from(receiptMisses)).toEqual([])
  }, 30_000)

  // adversarial А3: proven whole, a line «1 × 0 = 0» emptied all the same — no reason of the receipt to give
  it('tells of a receipt proven whole with a line emptied, with no reason of the receipt', async () => {
    const me = await person(LATER)
    await queued(me)
    const free: ModelReceipt = {
      ...ANSWER,
      lines: [
        ...ANSWER.lines,
        {
          printed: 'Տոպրակ',
          code: '3923',
          article: '1100002',
          quantity: '1',
          unit: 'pcs',
          unit_price: '0',
          discount: null,
          sum: '0',
        },
      ],
    }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer: free, costMicroUsd: 2_180, tokens: TOKENS }),
      ),
      { told: told() },
    )
    const [notice] = await notices()
    expect(notice).toMatchObject({ kind: 'receipt_partial', lineReasons: { zero_not_gift: 1 } })
    expect(notice).not.toHaveProperty('reason')
  }, 30_000)

  // self-review №5, №6: «Прочитали не всё» counted beside the reason, a receipt with no items apart from «not whole»
  it('counts a line lost with «read in part», and a receipt with no items apart', async () => {
    const me = await person(LATER)
    await queued(me)
    const lost: ModelReceipt = {
      ...ANSWER,
      totals: [
        { label: 'Ընդամենը', amount: '1317.10' },
        { label: 'Վճարված է Առձեռն', amount: '1317.10' },
      ],
    }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer: lost, costMicroUsd: 2_180, tokens: TOKENS }),
      ),
    )
    expect(await reasons()).toEqual([
      'model AM read lines 2',
      'model AM read partly 1',
      'model AM read receipts 1',
      'model AM receipt lines_lost 1',
    ])
    await db.delete(receiptReasonDays)
    await queued(me)
    const section = {
      ...ANSWER,
      lines: [],
      totals: [
        { label: 'Բաժին 1', amount: '1700.00' },
        { label: 'Ընդամենը', amount: '1700.00' },
      ],
    }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer: section, costMicroUsd: 1_000, tokens: TOKENS }),
      ),
    )
    expect(await reasons()).toEqual([
      'model AM read lines 0',
      'model AM read no_items 1',
      'model AM read receipts 1',
    ])
  }, 30_000)

  // adversarial Б1: a line lost beside a line not as printed is said by «Прочитали не всё», in the notice and the review
  it('tells «Прочитали не всё» where a line lost stands behind a line not as printed', async () => {
    const me = await person(LATER)
    const id = await queued(me)
    const [milk, bread] = ANSWER.lines
    const hidden: ModelReceipt = {
      ...ANSWER,
      lines: [milk!, { ...bread!, quantity: '2', unit_price: '145', discount: null, sum: '300' }],
      totals: [
        { label: 'Ընդամենը', amount: '1680.00' },
        { label: 'Վճարված է Առձեռն', amount: '1680.00' },
      ],
    }
    await readAll(
      benchReader(),
      fakeModel(() =>
        Promise.resolve({ kind: 'read', answer: hidden, costMicroUsd: 2_180, tokens: TOKENS }),
      ),
      { told: told() },
    )
    const [notice] = await notices()
    expect(notice).toMatchObject({ reason: 'line_not_as_printed', partly: true })
    const [kept] = await db.select().from(receiptMisses).where(eq(receiptMisses.receipt, id))
    expect(kept?.reasons).toMatchObject({ receipt: 'line_not_as_printed', partly: true })
  }, 30_000)

  describe('«Переснять» leaves the review (owner’s В-6 «а»)', () => {
    const removed = async (me: Person, id: string, retake: boolean) => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/receipts/${id}`,
        headers: { cookie: me.cookie, ...(retake ? { 'x-molvia-receipt-retake': '1' } : {}) },
      })
      expect(response.statusCode).toBe(204)
      // the ten minutes of «Вернуть» over
      await db
        .update(receipts)
        .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
        .where(eq(receipts.id, id))
      await repository.purgeStale()
    }

    it('keeps the review of a receipt «Переснять» replaced, past the receipt itself', async () => {
      const me = await person(LATER)
      const id = await queued(me)
      await readAll(benchReader(), fakeModel(notWhole))
      await removed(me, id, true)
      expect(await receiptOf(id)).toBeUndefined()
      const [kept] = await db.select().from(receiptMisses)
      expect(kept).toMatchObject({ receipt: id, receiptId: null })
      expect(kept?.retakenAt).not.toBeNull()
      expect(await db.select().from(receiptMissParts)).toHaveLength(1)
      // and goes with the person all the same
      await db.execute(sql`delete from ${actors} where id = ${me.id}::uuid`)
      expect(await db.select().from(receiptMisses)).toEqual([])
    }, 30_000)

    it('lets the review go with a receipt removed by «Удалить чек»', async () => {
      const me = await person(LATER)
      const id = await queued(me)
      await readAll(benchReader(), fakeModel(notWhole))
      await removed(me, id, false)
      expect(await db.select().from(receiptMisses)).toEqual([])
    }, 30_000)

    it('takes the mark back with «Вернуть»: brought back, the review goes with its receipt again', async () => {
      const me = await person(LATER)
      const id = await queued(me)
      await readAll(benchReader(), fakeModel(notWhole))
      await app.inject({
        method: 'DELETE',
        url: `/receipts/${id}`,
        headers: { cookie: me.cookie, 'x-molvia-receipt-retake': '1' },
      })
      const back = await app.inject({
        method: 'POST',
        url: `/receipts/${id}/restore`,
        headers: { cookie: me.cookie },
      })
      expect(back.statusCode).toBe(200)
      const [kept] = await db.select().from(receiptMisses)
      expect(kept).toMatchObject({ receiptId: id, retakenAt: null })
    }, 30_000)
  })

  it('tells nobody where nobody is there to tell, and keeps the review all the same', async () => {
    const me = await person(LATER)
    await queued(me)
    await readAll(benchReader(), fakeModel(notWhole))
    expect(await notices()).toEqual([])
    expect(await db.select().from(receiptMisses)).toHaveLength(1)
  }, 30_000)

  describe('make receipt-reasons, receipt-miss and receipt-miss-forget', () => {
    const misses = createReceiptMissesRepository(db)
    const run = async (argv: string[]) => {
      const lines: string[] = []
      const exit = await receiptMissesCommand(argv, misses, (line) => lines.push(line), new Date())
      return { exit, lines }
    }

    // self-review №9: one rule with `show` — a start naming more than one receipt lets none go
    it('lets nothing go by a start of the id that names more than one receipt', async () => {
      const me = await person(LATER)
      const reasons = { receipt: 'lines_lost', lines: [] }
      const kept = (receipt: string) => ({
        receipt,
        actorId: me.id,
        readAt: new Date(),
        keepUntil: new Date(Date.now() + 60_000),
        readerVersion: 'claude-haiku-5-5@v5',
        reasons,
        reading: {},
      })
      await db
        .insert(receiptMisses)
        .values([
          kept('abcdef12-0000-4000-8000-000000000001'),
          kept('abcdef12-0000-4000-8000-000000000002'),
        ])
      const { exit, lines } = await run(['forget', 'abcdef12', '--yes'])
      expect(exit).toBe(2)
      expect(lines.at(-1)).toMatch(/2 receipts start with abcdef12/)
      expect(await db.select().from(receiptMisses)).toHaveLength(2)
      expect((await run(['forget', 'abcdef12-0000-4000-8000-000000000001', '--yes'])).exit).toBe(0)
      expect(await db.select().from(receiptMisses)).toHaveLength(1)
    }, 30_000)

    it('reads the window’s reasons by reader and country, each share beside its n', async () => {
      const me = await person(LATER)
      await queued(me)
      await readAll(benchReader(), fakeModel(notWhole))
      const today = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const { exit, lines } = await run(['reasons', '--from', today])
      expect(exit).toBe(0)
      expect(lines.join('\n')).toMatch(/model AM[\s\S]*not whole\s+1\s+100\.0 %/)
      expect(lines.join('\n')).toMatch(/unsettled\s+1\s+33\.3 %/)
    }, 30_000)

    // adversarial Б3: a review gone by itself — its days, its person erased — leaves no copy behind
    it('lets go of the copy of a review gone by itself, and never one brought from production', async () => {
      const me = await person(LATER)
      const id = await queued(me)
      await readAll(benchReader(), fakeModel(notWhole))
      const root = await mkdtemp(join(tmpdir(), 'receipt-misses-'))
      const copy = join(root, `receipt-miss-${id.slice(0, 8)}`)
      const brought = join(root, 'prod', 'receipt-miss-0badcafe')
      try {
        expect((await run(['show', id.slice(0, 8), '--root', root])).exit).toBe(0)
        await mkdir(brought, { recursive: true })
        await writeFile(join(brought, 'reading.json'), '{}')
        // its 21 days over: the timer lets it go, and nothing names it to `forget`
        await db.update(receiptMisses).set({
          readAt: sql`clock_timestamp() - interval '22 days'`,
          keepUntil: sql`clock_timestamp() - interval '1 day'`,
        })
        await repository.purgeStale()
        // the dry run names what --yes deletes besides the rows, and deletes nothing (round 4, В1а)
        const dry = await run(['forget', '--read-before', '2026-01-01', '--root', root])
        expect(dry.lines).toContain(`  copy receipt-miss-${id.slice(0, 8)}`)
        expect(dry.lines).toContain('copies: 1 would be deleted.')
        expect(await readFile(join(copy, 'reading.json'), 'utf8')).toBeTruthy()
        const done = await run(['forget', '--read-before', '2026-01-01', '--root', root, '--yes'])
        expect(done.lines).toContain('copies deleted: 1.')
        await expect(readFile(join(copy, 'reading.json'))).rejects.toThrow()
        expect(await readFile(join(brought, 'reading.json'), 'utf8')).toBe('{}')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }, 30_000)

    it('shows one receipt with its photo written out, and lets it go only with --yes — its copy too', async () => {
      const me = await person(LATER)
      const id = await queued(me)
      await readAll(benchReader(), fakeModel(notWhole))
      const root = await mkdtemp(join(tmpdir(), 'receipt-misses-'))
      const copy = join(root, `receipt-miss-${id.slice(0, 8)}`)
      try {
        const shown = await run(['show', id.slice(0, 8), '--root', root])
        expect(shown.exit).toBe(0)
        expect(shown.lines).toContain('  line 3: unsettled')
        expect(JSON.parse(await readFile(join(copy, 'reading.json'), 'utf8'))).toEqual(NOT_WHOLE)
        expect((await readFile(join(copy, 'part-1.jpg'))).subarray(0, 2)).toEqual(
          Buffer.from([0xff, 0xd8]),
        )
        const dry = await run(['forget', id.slice(0, 8), '--root', root])
        expect(dry.lines.at(-1)).toMatch(/dry run: 1/)
        expect(dry.lines).toContain(`  copy receipt-miss-${id.slice(0, 8)}`)
        expect(await db.select().from(receiptMisses)).toHaveLength(1)
        const done = await run(['forget', id.slice(0, 8), '--root', root, '--yes'])
        expect(done.lines.at(-1)).toBe('let go: 1.')
        expect(await db.select().from(receiptMisses)).toEqual([])
        // the copy `show` wrote goes with what it was copied from (adversarial Б2)
        await expect(readFile(join(copy, 'reading.json'))).rejects.toThrow()
        expect((await run(['show', id.slice(0, 8)])).exit).toBe(3)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }, 30_000)
  })
})
