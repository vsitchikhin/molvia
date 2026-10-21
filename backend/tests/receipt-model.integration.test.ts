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
import {
  actors,
  modelReceiptDays,
  ownerNotices,
  receiptDays,
  receiptLineImages,
  receiptLines,
  receipts,
} from '@/db/schema'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import { ModelRejected, ModelUnavailable, receiptModel } from '@/receipts/model-reader'
import type { ModelReading, ReceiptModel } from '@/receipts/model-reader'
import type { ReaderReading, ReceiptReader } from '@/receipts/reader'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import { RECEIPT_MODEL_WAIT_MS, readQueuedReceipts } from '@/usecases/read-receipts'
import type { ReadReport } from '@/usecases/read-receipts'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertPlace, insertTrip, signIn } from './fixtures'

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
      readerVersion: 'claude-haiku-5-5@v5',
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
      tokens: TOKENS,
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
      edits: { lines: 1, edited: 0, skipped: 0, item: 0, figures: 0, totalCorrected: false },
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
      edits: { lines: 2, edited: 1, skipped: 0, item: 1, figures: 0, totalCorrected: false },
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
