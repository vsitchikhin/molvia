/**
 * A Georgian pharmacy's rounding through the queue and the database (MOL-421, owner's А1 «а», adversarial А1): lines of
 * one piece printed with three decimals, the total under «ლარი» alone, every figure copied right by Haiku. Its lines
 * meet the total as printed and round apart from it by a tetri: the receipt is whole, the rounding its own figure, and
 * nothing goes to Sonnet, to «Прочитали не всё» or to the developer. The models are fakes in the shape of ge-04 of the
 * bench (`research/MOL-408/bench/ge/ge-04.json`).
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MODEL_CONSENT_EDITION, spendMonthOf } from '@molvia/model'
import type { ModelReceipt } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createItemRepository } from '@/db/items-repository'
import { createModelSpendRepository } from '@/db/model-spend-repository'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
import { createStoreMemoryRepository } from '@/db/store-memory-repository'
import { ownerNotices, receiptLines, receipts } from '@/db/schema'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import type { ModelReading, ReceiptModel } from '@/receipts/model-reader'
import type { ReceiptReader } from '@/receipts/reader'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import { modelRest, readQueuedReceipts } from '@/usecases/read-receipts'
import {
  PHONE_NOTICES_PER_HOUR,
  PHONE_NOTICES_PER_SENDER,
  phoneNoticeBudget,
} from '@/usecases/record-failure'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'
import { onlyRow } from './rows'

const { db, close } = connectDrizzle()
const repository = createReceiptRepository(db)
const spend = createModelSpendRepository(db, true)
const memory = createStoreMemoryRepository(db)
const CAP = 200_000_000

type Line = ModelReceipt['lines'][number]
const piece = (printed: string, price: string): Line => ({
  printed,
  code: null,
  article: null,
  quantity: '1.000',
  unit: null,
  unit_price: price,
  discount: null,
  sum: price,
})
const pharmacy = (lines: Line[], total: string): ModelReceipt => ({
  shop: 'Xვს 592',
  address: null,
  id_rows: [],
  date: null,
  time: null,
  lines,
  totals: [{ label: 'ლარი', amount: total }],
})
/** Every figure copied right: 22.364 + 4.334 = 26.698 — 22,36 + 4,33 against 26,70. */
const UP = pharmacy(
  [piece('(-) ხსნარი 100მლ', '22.364'), piece('(EU) სიროფი 100მლ', '4.334')],
  '26.698',
)
/** 1.005 + 1.005 = 2.010 — 1,01 + 1,01 against 2,01. */
const DOWN = pharmacy(
  [piece('(-) ხსნარი 100მლ', '1.005'), piece('(EU) სიროფი 100მლ', '1.005')],
  '2.010',
)
/** ge-04 as Haiku copied it. */
const GE04 = pharmacy(
  [piece('(-) ხსნარი 100მლ', '1.500'), piece('(EU) სიროფი 100მლ', '22.368')],
  '23.868',
)

function fakeModel(
  answer: ModelReceipt,
  cost: number,
  name: ReceiptModel['model'],
): ReceiptModel & { asked: number } {
  const model = {
    asked: 0,
    version: `${name}@v5`,
    inputTokensMax: () => 10_000,
    read: () => {
      model.asked += 1
      return Promise.resolve<ModelReading>({
        kind: 'read',
        answer,
        costMicroUsd: cost,
        tokens: { input: 5_909, output: 3_177 },
      })
    },
    model: name,
    brandsVersion: 'claude-haiku-5-5@brands-v1',
    brandsInputTokensMax: () => 1_000,
    spellBrands: () => Promise.reject(new Error('no brand is asked')),
  }
  return model
}

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

async function granted(): Promise<{ id: string; cookie: string }> {
  const id = await insertActor(db, {
    country: 'GE',
    city: 'Тбилиси',
    spendCurrency: 'GEL',
    receiptsModelUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    consentVersion: MODEL_CONSENT_EDITION,
    consentedAt: new Date(),
  })
  return { id, cookie: await signIn(db, id) }
}

async function queued(me: { cookie: string }): Promise<string> {
  const id = randomUUID()
  const sent = await app.inject({
    method: 'POST',
    url: '/receipts',
    headers: { cookie: me.cookie },
    payload: {
      id,
      parts: 1,
      country: 'GE',
      language: 'ru',
      capturedAt: '2026-11-15T09:01:00.000Z',
    },
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

async function readAll(first: ReceiptModel, second: ReceiptModel): Promise<void> {
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
    model: {
      reader: first,
      second: { reader: second, rest: modelRest() },
      spend,
      capMicroUsd: CAP,
      shareMicroUsd: CAP,
    },
    storeMemory: memory,
    payments: false,
    told: {
      notices: createOwnerNoticeRepository(db),
      budget: phoneNoticeBudget(PHONE_NOTICES_PER_HOUR, PHONE_NOTICES_PER_SENDER, (count) => ({
        kind: 'receipt_partial_muted' as const,
        count,
      })),
    },
  })
}

const receiptOf = async (id: string) =>
  onlyRow(await db.select().from(receipts).where(eq(receipts.id, id)))
const sumsOf = async (id: string) =>
  (
    await db
      .select({ sum: receiptLines.sumMinor })
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
      .orderBy(receiptLines.position)
  ).map((row) => row.sum)
const notices = async () =>
  (
    await db.select({ payload: ownerNotices.payload }).from(ownerNotices).orderBy(ownerNotices.id)
  ).map((row) => row.payload)
const spent = async () => (await spend.month(spendMonthOf(new Date())))?.spentMicroUsd

describe('a pharmacy whose lines round a tetri apart from its total (MOL-421, А1 «а»)', () => {
  it('is whole, its rounding kept, and asks nobody else: no Sonnet, no «Прочитали не всё», no notice', async () => {
    const me = await granted()
    const id = await queued(me)
    const haiku = fakeModel(UP, 2_180, 'claude-haiku-5-5')
    const sonnet = fakeModel(UP, 30_000, 'claude-sonnet-5-5')
    await readAll(haiku, sonnet)
    expect([haiku.asked, sonnet.asked, tesseract.asked]).toEqual([1, 0, 0])
    expect(await receiptOf(id)).toMatchObject({
      status: 'parsed',
      balanced: true,
      totalMinor: 2_670n,
      roundingMinor: 1n,
      readPartly: false,
    })
    expect(await sumsOf(id)).toEqual([2_236n, 433n])
    expect(await spent()).toBe(2_180)
    expect(await notices()).toEqual([])
  })

  it('keeps a rounding below nought: the lines over the total by a tetri', async () => {
    const me = await granted()
    const id = await queued(me)
    await readAll(
      fakeModel(DOWN, 2_180, 'claude-haiku-5-5'),
      fakeModel(DOWN, 30_000, 'claude-sonnet-5-5'),
    )
    expect(await receiptOf(id)).toMatchObject({
      balanced: true,
      totalMinor: 201n,
      roundingMinor: -1n,
    })
    expect(await sumsOf(id)).toEqual([101n, 101n])
  })

  it('must not name a rounding where the lines meet the total to the tetri: ge-04 itself', async () => {
    const me = await granted()
    const id = await queued(me)
    const haiku = fakeModel(GE04, 2_180, 'claude-haiku-5-5')
    const sonnet = fakeModel(GE04, 30_000, 'claude-sonnet-5-5')
    await readAll(haiku, sonnet)
    expect([haiku.asked, sonnet.asked]).toEqual([1, 0])
    expect(await receiptOf(id)).toMatchObject({
      balanced: true,
      totalMinor: 2_387n,
      roundingMinor: null,
      readPartly: false,
    })
    expect(await sumsOf(id)).toEqual([150n, 2_237n])
    expect(await notices()).toEqual([])
  })
})
