/**
 * Georgia read by the model alone (MOL-408): a receipt the model is away for waits a day and holds no round
 * (owner's В-8 «а»), and the camera is offered only while the model reads for the person now — the share and the
 * month's cap too (adversarial А3). The model is a fake answering as Haiku copied Nikora's receipt on the bench.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MODEL_CONSENT_EDITION,
  RECEIPTS_BY_MODEL_HEADER,
  RECEIPT_MODEL_SHARE_MICRO_USD,
  spendMonthOf,
} from '@molvia/model'
import type { ModelReceipt } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createItemRepository } from '@/db/items-repository'
import { createModelSpendRepository } from '@/db/model-spend-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
import { actors, modelSpend, receipts } from '@/db/schema'
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

function fakeModel(answer: () => Promise<ModelReading>): ReceiptModel & { asked: number } {
  const model = {
    asked: 0,
    version: 'claude-haiku-5-5@v5',
    inputTokensMax: () => 10_000,
    read: () => {
      model.asked += 1
      return answer()
    },
    brandsVersion: 'claude-haiku-5-5@brands-v1',
    brandsInputTokensMax: () => 1_000,
    spellBrands: () => Promise.reject(new Error('no brand is asked')),
  }
  return model
}
const reads = () =>
  fakeModel(() =>
    Promise.resolve({
      kind: 'read',
      answer: NIKORA,
      costMicroUsd: 2_180,
      tokens: { input: 5_909, output: 3_177 },
    }),
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
  app = buildServer({ db, receiptReader: null, receiptModel: reads() })
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

const receiptOf = async (id: string) =>
  onlyRow(await db.select().from(receipts).where(eq(receipts.id, id)))

describe('a Georgian receipt while the model is away (MOL-408, owner’s В-8 «а»)', () => {
  it('waits past the ten minutes, the Armenian receipt behind it goes to Tesseract, and the model back reads it', async () => {
    const tbilisi = await granted('GE')
    const gyumri = await granted('AM')
    const georgian = await queued(tbilisi)
    const armenian = await queued(gyumri, 'AM')
    const queuedAt = (await receiptOf(georgian))?.queuedAt?.getTime() ?? 0
    const later = (ms: number) => () => new Date(queuedAt + ms)

    // past the ten minutes: Armenia's goes to Tesseract, Georgia's keeps its place — stepped over, never the end
    await readAll(away(), later(RECEIPT_MODEL_WAIT_MS + 60_000))
    expect(await receiptOf(georgian)).toMatchObject({ status: 'queued', attempts: 0 })
    expect((await receiptOf(armenian))?.status).toBe('failed')
    expect(tesseract.asked).toBeGreaterThan(0)

    // the model back within the day reads it
    const back = reads()
    await readAll(back, later(6 * 60 * 60 * 1000))
    expect(back.asked).toBe(1)
    expect((await receiptOf(georgian))?.status).toBe('parsed')
  }, 30_000)

  it('fails it unreadable only past a day of the model away, and never asks Tesseract', async () => {
    const me = await granted('GE')
    const id = await queued(me)
    const queuedAt = (await receiptOf(id))?.queuedAt?.getTime() ?? 0

    await readAll(away(), () => new Date(queuedAt + RECEIPT_MODEL_ALONE_WAIT_MS - 60_000))
    expect((await receiptOf(id))?.status).toBe('queued')
    await readAll(away(), () => new Date(queuedAt + RECEIPT_MODEL_ALONE_WAIT_MS))
    expect(await receiptOf(id)).toMatchObject({ status: 'failed', failure: 'unreadable' })
    expect(tesseract.asked).toBe(0)
  }, 30_000)
})

describe('whether the model reads for the person now (MOL-408, adversarial А3)', () => {
  async function said(me: Person, server: FastifyInstance = app): Promise<boolean | undefined> {
    const answer = await server.inject({
      method: 'GET',
      url: '/actors/me',
      headers: { cookie: me.cookie, [RECEIPTS_BY_MODEL_HEADER]: '1' },
    })
    return answer.json<{ receiptsByModel?: boolean }>().receiptsByModel
  }
  const month = () => spendMonthOf(new Date())

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

  it('must not say yes once the person’s share of the month is spent', async () => {
    const me = await granted()
    await db
      .update(actors)
      .set({ modelMonth: month(), modelSpentMicroUsd: RECEIPT_MODEL_SHARE_MICRO_USD })
      .where(eq(actors.id, me.id))
    expect(await said(me)).toBe(false)
    // a share spent in a month gone counts nothing now
    await db
      .update(actors)
      .set({ modelMonth: '2026-01-01', modelSpentMicroUsd: RECEIPT_MODEL_SHARE_MICRO_USD })
      .where(eq(actors.id, me.id))
    expect(await said(me)).toBe(true)
  }, 10_000)

  it('must not say yes once the month’s cap is reached', async () => {
    const me = await granted()
    await db.insert(modelSpend).values({ month: month(), spentMicroUsd: CAP })
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
