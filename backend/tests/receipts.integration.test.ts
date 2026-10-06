import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ERROR,
  receiptDetailCodec,
  receiptSummaryCodec,
  receiptsResponseCodec,
} from '@molvia/model'
import am05 from '@molvia/model/testing/receipt-text.am-05.json'
import type { FastifyInstance } from 'fastify'
import { createItemRepository } from '@/db/items-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import {
  itemHeadings,
  itemNames,
  receiptDays,
  receiptLineImages,
  receiptLines,
  receiptParts,
  receipts,
} from '@/db/schema'
import { PhotoUnreadable, ReaderDropped, ReaderUnavailable } from '@/receipts/reader'
import type { ReaderReading, ReceiptReader } from '@/receipts/reader'
import { bindReceiptLines } from '@/usecases/bind-receipt-lines'
import { readQueuedReceipts } from '@/usecases/read-receipts'
import type { ReadReport } from '@/usecases/read-receipts'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createReceiptRepository(db)
let app: FastifyInstance

beforeAll(async () => {
  // no reader: receipts wait in the queue, and each test reads them itself
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

/** A JPEG's head with its frame of `width` × `height`: all the server reads of a part. */
function jpeg(width = 800, height = 2_400, tail = 0): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array.from({ length: 14 }, () => 0)]
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ]
  return Buffer.from([
    0xff,
    0xd8,
    ...app0,
    ...sof,
    ...Array.from({ length: 9 }, () => 0),
    // the start of the scan and its data: a head alone is no photo (review А9)
    ...[0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00],
    tail,
    0x55,
    0xff,
    0xd9,
  ])
}

const body = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  parts: 1,
  country: 'AM',
  language: 'ru',
  capturedAt: '2026-10-03T08:15:00.000Z',
  ...over,
})

function send(me: Owner, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/receipts', headers: { cookie: me.cookie }, payload })
}

function put(me: Owner, id: string, part: number | string, photo: Buffer, type = 'image/jpeg') {
  return app.inject({
    method: 'PUT',
    url: `/receipts/${id}/parts/${String(part)}`,
    headers: { cookie: me.cookie, 'content-type': type },
    payload: photo,
  })
}

function get(me: Owner, url: string) {
  return app.inject({ method: 'GET', url, headers: { cookie: me.cookie } })
}

/** A different photo for every receipt a test sends. */
let photos = 0

/** The owner's receipt, sent whole: one part, in the queue. */
/** The rows of `receipt_days` (MOL-222), in order of the day. */
const days = () => db.select().from(receiptDays).orderBy(receiptDays.day)

async function queued(me: Owner, over: Record<string, unknown> = {}): Promise<string> {
  const receipt = body(over)
  expect((await send(me, receipt)).statusCode).toBe(201)
  for (let part = 1; part <= receipt.parts; part++) {
    expect((await put(me, receipt.id, part, jpeg(800, 2_400, ++photos % 256))).statusCode).toBe(200)
  }
  return receipt.id
}

/**
 * The reader as the bench read am-05 (MOL-114): each page mode gives its own text, every row with a
 * box of its own so the lines can be cut out.
 */
function benchReader(over: Partial<ReceiptReader> = {}): ReceiptReader & { asked: number } {
  const texts: Record<number, string> = { 4: am05.readings[0] ?? '', 6: am05.readings[1] ?? '' }
  const reader = {
    asked: 0,
    read(_photo: Buffer, languages: string, pageMode: number): Promise<ReaderReading> {
      reader.asked += 1
      expect(languages).toBe('hye+rus+eng')
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
    ...over,
  }
  return reader
}

async function readAll(reader: ReceiptReader): Promise<ReadReport[]> {
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
  })
  return reports
}

describe('«Отправить чек»', () => {
  it('takes a new receipt, and the same one sent again is the same answer', async () => {
    const me = await owner()
    const receipt = body({ parts: 2 })
    const first = await send(me, receipt)
    expect(first.statusCode).toBe(201)
    const summary = receiptSummaryCodec.parse(first.json())
    expect([summary.status, summary.parts, summary.received, summary.header]).toEqual([
      'uploading',
      2,
      0,
      null,
    ])
    expect(first.headers['cache-control']).toBe('no-store')
    const again = await send(me, receipt)
    expect([again.statusCode, again.json()]).toEqual([200, first.json()])
  })

  it('refuses another receipt under the same id, of the owner or of someone else', async () => {
    const me = await owner()
    const other = await owner()
    const receipt = body()
    await send(me, receipt)
    expect((await send(me, { ...receipt, parts: 2 })).json()).toEqual({ code: ERROR.CONFLICT })
    expect((await send(other, receipt)).statusCode).toBe(409)
  })

  it('refuses the same id with any field of the body changed — the country too, once there are two', async () => {
    const me = await owner()
    const receipt = body()
    await send(me, receipt)
    await db.update(receipts).set({ language: 'en' }).where(eq(receipts.id, receipt.id))
    expect((await send(me, receipt)).statusCode).toBe(409)
  })

  it('refuses an id in capitals and a country not read yet', async () => {
    const me = await owner()
    expect((await send(me, body({ id: randomUUID().toUpperCase() }))).statusCode).toBe(400)
    expect((await send(me, body({ country: 'GE' }))).statusCode).toBe(400)
  })
})

describe('a part of the photo', () => {
  it('puts the receipt in the queue with its last part, not before', async () => {
    const me = await owner()
    const receipt = body({ parts: 2 })
    await send(me, receipt)
    const one = receiptSummaryCodec.parse((await put(me, receipt.id, 1, jpeg())).json())
    expect([one.status, one.received]).toEqual(['uploading', 1])
    const two = receiptSummaryCodec.parse((await put(me, receipt.id, 2, jpeg(700, 3_200))).json())
    expect([two.status, two.received]).toEqual(['queued', 2])
  })

  it('takes the same part again as the same write, and refuses another photo in its place', async () => {
    const me = await owner()
    const receipt = body({ parts: 2 })
    await send(me, receipt)
    await put(me, receipt.id, 1, jpeg(800, 2_400, 1))
    expect((await put(me, receipt.id, 1, jpeg(800, 2_400, 1))).statusCode).toBe(200)
    expect((await put(me, receipt.id, 1, jpeg(800, 2_400, 2))).json()).toEqual({
      code: ERROR.CONFLICT,
    })
  })

  it('answers «не принят» for what is not a photo of a receipt', async () => {
    const me = await owner()
    const receipt = body()
    await send(me, receipt)
    const text = await put(me, receipt.id, 1, Buffer.from('not a photo'))
    expect([text.statusCode, text.json()]).toEqual([415, { code: ERROR.RECEIPT_NOT_PHOTO }])
    const tiny = await put(me, receipt.id, 1, jpeg(120, 2_000))
    expect(tiny.json()).toEqual({ code: ERROR.RECEIPT_NOT_PHOTO })
    const huge = await put(me, receipt.id, 1, jpeg(800, 6_001))
    expect([huge.statusCode, huge.json()]).toEqual([413, { code: ERROR.RECEIPT_TOO_LARGE }])
    // a head with no picture after it: the frame is there, the scan is not (review А9)
    const head = jpeg().subarray(0, 2 + 18 + 19)
    const empty = await put(me, receipt.id, 1, Buffer.concat([head, Buffer.from([0xff, 0xd9])]))
    expect(empty.json()).toEqual({ code: ERROR.RECEIPT_NOT_PHOTO })
    // the boundary itself is taken
    expect((await put(me, receipt.id, 1, jpeg(200, 6_000))).statusCode).toBe(200)
  })

  it('takes a phone’s whole frame — 3 024 × 4 032 of a 12-megapixel camera (review А8)', async () => {
    const me = await owner()
    const receipt = body()
    await send(me, receipt)
    expect((await put(me, receipt.id, 1, jpeg(3_024, 4_032))).statusCode).toBe(200)
  })

  it('takes nothing but JPEG as the body', async () => {
    const me = await owner()
    const receipt = body()
    await send(me, receipt)
    expect((await put(me, receipt.id, 1, jpeg(), 'image/png')).statusCode).toBe(415)
  })

  it('answers 404 for a part past the receipt, a part that is no number, someone else’s receipt', async () => {
    const me = await owner()
    const other = await owner()
    const receipt = body()
    await send(me, receipt)
    expect((await put(me, receipt.id, 2, jpeg())).statusCode).toBe(404)
    expect((await put(me, receipt.id, 0, jpeg())).statusCode).toBe(404)
    expect((await put(me, receipt.id, 'x', jpeg())).statusCode).toBe(404)
    expect((await put(other, receipt.id, 1, jpeg())).statusCode).toBe(404)
    expect((await put(me, 'not-a-uuid', 1, jpeg())).statusCode).toBe(404)
  })

  it('refuses a part over the size sent in chunks with no length, by its own code (review А16)', async () => {
    const me = await owner()
    const receipt = body()
    await send(me, receipt)
    const big = Buffer.concat([jpeg(), Buffer.alloc(9 * 1024 * 1024)])
    const answer = await app.inject({
      method: 'PUT',
      url: `/receipts/${receipt.id}/parts/1`,
      headers: { cookie: me.cookie, 'content-type': 'image/jpeg' },
      payload: Readable.from([big.subarray(0, 4 * 1024 * 1024), big.subarray(4 * 1024 * 1024)]),
    })
    expect([answer.statusCode, answer.json()]).toEqual([413, { code: ERROR.RECEIPT_TOO_LARGE }])
  })

  it('takes a part of exactly the size a part may have', async () => {
    const me = await owner()
    const receipt = body()
    await send(me, receipt)
    const exact = jpeg()
    const photo = Buffer.concat([
      exact.subarray(0, exact.length - 2),
      Buffer.alloc(8 * 1024 * 1024 - exact.length, 0x11),
      exact.subarray(-2),
    ])
    expect(photo.length).toBe(8 * 1024 * 1024)
    expect((await put(me, receipt.id, 1, photo)).statusCode).toBe(200)
  })

  it('refuses a part over the size a part may have before reading it whole', async () => {
    const me = await owner()
    const receipt = body()
    await send(me, receipt)
    const big = Buffer.concat([jpeg(), Buffer.alloc(8 * 1024 * 1024)])
    const answer = await put(me, receipt.id, 1, big)
    // its own code, said by the length before the body is read (review А7)
    expect([answer.statusCode, answer.json()]).toEqual([413, { code: ERROR.RECEIPT_TOO_LARGE }])
  })
})

describe('the queue', () => {
  it('lays am-05 out into its 13 lines, balanced with the total, and cuts the item lines out', async () => {
    const me = await owner()
    const id = await queued(me)
    const reader = benchReader()
    const reports = await readAll(reader)
    expect(reader.asked).toBe(2)
    expect(reports).toEqual([
      expect.objectContaining({ kind: 'read', status: 'parsed', lines: 13, parts: 1 }),
    ])

    const detail = receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json())
    expect(detail.receipt).toMatchObject({
      status: 'parsed',
      failure: null,
      balanced: true,
      lineCount: 13,
      header: {
        tin: '01234567',
        date: '2026-10-01',
        time: '12:00',
        receiptNo: '12345678',
        shop: null,
      },
      total: { minor: 867_641n, currency: 'AMD' },
    })
    expect(detail.lines).toHaveLength(13)
    expect(detail.lines[2]).toMatchObject({
      hs: '0401',
      sku: '1163909',
      quantity: { milli: 2_000n, unit: 'piece' },
      price: { minor: 37_000n, currency: 'AMD' },
      sum: { minor: 74_000n, currency: 'AMD' },
      settled: true,
    })

    const images = await db
      .select()
      .from(receiptLineImages)
      .where(eq(receiptLineImages.receiptId, id))
    // the figures of each of 13 lines and the names of the 12 between two items — the first's name
    // has the head above it (review Р19) — and nothing of the head or the total
    expect(images).toHaveLength(25)
    expect(images.every((image) => image.confirmedAt === null)).toBe(true)
    expect(images.some((image) => /ՀՎՀՀ|Ընդամենը|Ֆիսկալ/.test(image.readText))).toBe(false)
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect([row?.readerVersion, row?.attempts, row?.layout]).toEqual([
      'tesseract 5.5.0 · test',
      1,
      'card',
    ])
  })

  // MOL-126: what the lines are is found once, in the queue — by the catalogue's Armenian names and
  // the heading, then by the search with the gloss; a line nobody knows is a new item named by it
  it('binds the lines to items while reading', async () => {
    const me = await owner()
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const plain = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    await db.insert(itemNames).values([
      { itemId: milk, language: 'hy', name: 'կաթ 3.2%' },
      { itemId: plain, language: 'hy', name: 'կաթ' },
    ])
    await db.insert(itemHeadings).values([
      { itemId: milk, hs: '0401' },
      { itemId: plain, hs: '0401' },
    ])
    const id = await queued(me)
    await readAll(benchReader())

    const lines = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
      .orderBy(receiptLines.position)
    expect(lines[2]).toMatchObject({ itemId: milk, match: 'search', translation: 'молоко' })
    expect(lines.filter((line) => line.match === 'new').length).toBeGreaterThan(0)
    expect(lines.every((line) => line.match !== null)).toBe(true)
  })

  it('asks for a new shot only when not one item line was found (MOL-222, В-1)', async () => {
    const me = await owner()
    const id = await queued(me)
    const blank = { text: 'ԵՐԵՎԱՆ-ՍԻԹԻ\nՇնորհակալություն', rows: [], version: 'v' }
    const [report] = await readAll(benchReader({ read: () => Promise.resolve(blank) }))
    const summary = receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json()).receipt
    expect([summary.status, summary.failure, summary.lineCount]).toEqual(['failed', 'reshoot', 0])
    expect(await db.select().from(receiptLineImages)).toEqual([])
    expect(report).toMatchObject({ kind: 'read', lines: 0, settled: 0, partly: false })
    expect(await days()).toMatchObject([{ reshoot: 1, read: 0, readPartly: 0, unreadable: 0 }])
  })

  // MOL-227: a sole trader's section with no items is read whole — a sum to record, not a new shot
  it('reads a receipt with no items, its head and its total, and counts it apart', async () => {
    const me = await owner()
    const id = await queued(me)
    const text = [
      'ԽԱՆՈՒԹ ԱՁ',
      'ԳՅՈՒՄՐԻ Աբովյան 10',
      'ՀՎՀՀ: 12345678 Գ/Հ: 87654321',
      'ԿՀ: 00000049',
      '04-10-26 16:30:59 ԳԱՆՁԱՊԱՀ: 3',
      'Բաժին 1 - Բաժին 1',
      '/ Շրջանառության հարկ/ 1700.00',
      'Ընդամենը՝ 1700.00',
      'Առձեռն 1700.00',
      'ՖԻՍԿԱԼ ՀԱՄԱՐ 11223344',
    ].join('\n')
    const section: ReaderReading = {
      text,
      rows: text.split('\n').map((row, i) => ({ text: row, box: [0, i * 40, 600, 30] })),
      version: 'v',
    }
    const [report] = await readAll(benchReader({ read: () => Promise.resolve(section) }))
    const detail = receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json())
    expect([detail.receipt.status, detail.receipt.failure, detail.lines]).toEqual([
      'parsed',
      null,
      [],
    ])
    expect(detail.receipt.header).toMatchObject({
      tin: '12345678',
      date: '2026-10-04',
      time: '16:30',
      receiptNo: '11223344',
    })
    expect(detail.receipt.total).toEqual({ minor: 170_000n, currency: 'AMD' })
    expect(await db.select().from(receiptLineImages)).toEqual([])
    expect(report).toMatchObject({ kind: 'read', status: 'parsed', lines: 0, partly: false })
    expect(await days()).toMatchObject([
      { noItems: 1, read: 0, readPartly: 0, reshoot: 0, unreadable: 0 },
    ])
  })

  // MOL-222, В-1: «читать надо все кассы» — what was «переснимите» (В-4 of MOL-125) goes to the review
  it('reads a receipt read in part, its lines and all, and counts it apart', async () => {
    const me = await owner()
    const id = await queued(me)
    // two lines of a receipt of 10 000: what a crumpled one, or a till Tesseract misreads, gives
    const text = [
      '1. Կաթ',
      '0401/1163909 1Հտ 370/370',
      '2. Հաց',
      '1905/1078044 1Հտ 99,1/0,9 100',
      'Ընդամենը 10000.00',
    ].join('\n')
    const partial: ReaderReading = {
      text,
      rows: text.split('\n').map((row, i) => ({ text: row, box: [0, i * 40, 600, 30] })),
      version: 'v',
    }
    const [report] = await readAll(benchReader({ read: () => Promise.resolve(partial) }))
    const detail = receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json())
    expect([detail.receipt.status, detail.receipt.failure]).toEqual(['parsed', null])
    expect(detail.lines.length).toBeGreaterThan(0)
    expect(report).toMatchObject({ kind: 'read', status: 'parsed', partly: true })
    expect(report?.kind === 'read' && report.lines).toBe(detail.lines.length)
    expect(await days()).toMatchObject([{ readPartly: 1, read: 0, reshoot: 0 }])
  })

  it('counts a receipt read whole as read, by the day in Yerevan, with no id of anyone', async () => {
    const me = await owner()
    await queued(me)
    await queued(me)
    const reports = await readAll(benchReader())
    expect(reports.map((r) => r.kind === 'read' && r.partly)).toEqual([false, false])
    const rows = await days()
    expect(rows).toMatchObject([{ read: 2, readPartly: 0 }])
    const [{ today } = { today: '' }] = await db.execute<{ today: string }>(
      sql`select to_char(((now() at time zone 'UTC') + interval '4 hours')::date, 'YYYY-MM-DD') as today`,
    )
    expect(rows[0]?.day).toBe(today)
    const columns = await db.execute<{ column_name: string; data_type: string }>(sql`
      select column_name, data_type from information_schema.columns where table_name = 'receipt_days'`)
    expect(columns.every((c) => c.data_type === 'integer' || c.column_name === 'day')).toBe(true)
  })

  it('fails a photo the reader cannot read, and reads the next one', async () => {
    const me = await owner()
    const bad = await queued(me)
    const good = await queued(me)
    let first = true
    const reader = benchReader()
    const read = reader.read.bind(reader)
    reader.read = async (photo, languages, mode) => {
      if (first) {
        first = false
        throw new PhotoUnreadable('timeout')
      }
      return read(photo, languages, mode)
    }
    await readAll(reader)
    const list = receiptsResponseCodec.parse((await get(me, '/receipts')).json()).receipts
    expect(list.find((r) => r.id === bad)).toMatchObject({
      status: 'failed',
      failure: 'unreadable',
    })
    expect(list.find((r) => r.id === good)).toMatchObject({ status: 'parsed' })
  })

  it('leaves the receipt in the queue, its attempt uncounted, while the reader is away', async () => {
    const me = await owner()
    const id = await queued(me)
    const reports = await readAll(
      benchReader({
        read: () => Promise.reject(new ReaderUnavailable('unreachable')),
      }),
    )
    expect(reports).toEqual([{ kind: 'reader_unavailable', reason: 'unreachable' }])
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect([row?.status, row?.attempts]).toEqual(['queued', 0])
    await readAll(benchReader())
    expect(receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json()).receipt.status).toBe(
      'parsed',
    )
  })

  it('sends a photo the reader drops to the end of the queue, and fails it after its attempts', async () => {
    const me = await owner()
    const poison = await queued(me)
    const next = await queued(me)
    const reader = benchReader()
    const read = reader.read.bind(reader)
    const poisonPhoto = (
      await db.select().from(receiptParts).where(eq(receiptParts.receiptId, poison))
    )[0]!.photo
    reader.read = (photo, languages, mode) =>
      photo.equals(poisonPhoto)
        ? Promise.reject(new ReaderDropped('dropped'))
        : read(photo, languages, mode)
    const first = await readAll(reader)
    // the neighbour is read in the same round, not held behind the photo that fells the reader
    expect(first.map((r) => r.kind)).toEqual(['reader_dropped', 'read', 'reader_dropped'])
    const rows = await db.select().from(receipts)
    expect(rows.find((r) => r.id === next)?.status).toBe('parsed')
    expect(rows.find((r) => r.id === poison)).toMatchObject({
      status: 'failed',
      failure: 'unreadable',
      attempts: 2,
    })
    // the first drop sent it back to the queue and counted nothing; the second failed it (MOL-222)
    expect(await days()).toMatchObject([{ read: 1, unreadable: 1 }])
  })

  it('reads each person’s oldest receipt in turn: fifty of one do not hold another’s (review А10)', async () => {
    const heavy = await owner()
    const other = await owner()
    for (let n = 0; n < 5; n++) await queued(heavy)
    const theirs = await queued(other)
    const order: string[] = []
    let claimed = await repository.claimNext()
    while (claimed !== null) {
      order.push(claimed.id)
      await repository.finish(claimed.id, {
        kind: 'failed',
        failure: 'unreadable',
        readerVersion: null,
        head: null,
      })
      claimed = await repository.claimNext()
    }
    expect(order).toHaveLength(6)
    expect(order.indexOf(theirs)).toBe(1)
  })

  it('gives a receipt failed before any reading no head at all (review А11)', async () => {
    const me = await owner()
    const id = await queued(me)
    await readAll(benchReader({ read: () => Promise.reject(new PhotoUnreadable('unreadable')) }))
    const summary = receiptDetailCodec.parse((await get(me, `/receipts/${id}`)).json()).receipt
    expect([summary.status, summary.header]).toEqual(['failed', null])
  })

  it('fails what breaks unexpectedly, and says so to the log', async () => {
    const me = await owner()
    const id = await queued(me)
    const reports = await readAll(
      benchReader({
        read: () => Promise.reject(new TypeError('boom')),
      }),
    )
    expect(reports[0]).toMatchObject({ kind: 'error' })
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect([row?.status, row?.failure]).toEqual(['failed', 'unreadable'])
  })

  it('reads the receipt without its lines cut out when cutting fails', async () => {
    const me = await owner()
    const id = await queued(me)
    const reports = await readAll(
      benchReader({
        strips: () => Promise.reject(new PhotoUnreadable('not strips')),
      }),
    )
    expect(reports.map((r) => r.kind)).toEqual(['strips_failed', 'read'])
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect(row?.status).toBe('parsed')
    expect(await db.select().from(receiptLineImages)).toEqual([])
  })

  it('fails a receipt whose photo is gone — restored from a copy without photos (В-2)', async () => {
    const me = await owner()
    const id = await queued(me)
    await db.delete(receiptParts).where(eq(receiptParts.receiptId, id))
    await readAll(benchReader())
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect([row?.status, row?.failure]).toEqual(['failed', 'unreadable'])
  })

  it('begins again a reading cut short, and fails it after its attempts', async () => {
    const me = await owner()
    const once = await queued(me)
    const twice = await queued(me)
    await db.update(receipts).set({ status: 'reading', attempts: 1 }).where(eq(receipts.id, once))
    await db.update(receipts).set({ status: 'reading', attempts: 2 }).where(eq(receipts.id, twice))
    await repository.requeueInterrupted()
    const rows = await db.select().from(receipts)
    expect(rows.find((r) => r.id === once)).toMatchObject({ status: 'queued', failure: null })
    expect(rows.find((r) => r.id === twice)).toMatchObject({
      status: 'failed',
      failure: 'unreadable',
    })
    expect(await days()).toMatchObject([{ unreadable: 1 }])
  })

  it('must not read a receipt removed in the meantime into the list', async () => {
    const me = await owner()
    const id = await queued(me)
    const claimed = await repository.claimNext()
    expect(claimed?.id).toBe(id)
    await app.inject({ method: 'DELETE', url: `/receipts/${id}`, headers: { cookie: me.cookie } })
    expect(await repository.claimNext()).toBeNull()
    expect(receiptsResponseCodec.parse((await get(me, '/receipts')).json()).receipts).toEqual([])
  })

  it('never reads a receipt still uploading', async () => {
    const me = await owner()
    const receipt = body({ parts: 2 })
    await send(me, receipt)
    await put(me, receipt.id, 1, jpeg())
    expect(await repository.claimNext()).toBeNull()
  })
})

describe('«Удалить чек · Вернуть» (П-8)', () => {
  it('removes with a mark, brings back within ten minutes, and the timer makes it final', async () => {
    const me = await owner()
    const id = await queued(me)
    const del = await app.inject({
      method: 'DELETE',
      url: `/receipts/${id}`,
      headers: { cookie: me.cookie },
    })
    expect(del.statusCode).toBe(204)
    expect((await get(me, `/receipts/${id}`)).statusCode).toBe(404)
    const back = await app.inject({
      method: 'POST',
      url: `/receipts/${id}/restore`,
      headers: { cookie: me.cookie },
    })
    expect(receiptSummaryCodec.parse(back.json()).status).toBe('queued')

    await app.inject({ method: 'DELETE', url: `/receipts/${id}`, headers: { cookie: me.cookie } })
    await db
      .update(receipts)
      .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
      .where(eq(receipts.id, id))
    const late = await app.inject({
      method: 'POST',
      url: `/receipts/${id}/restore`,
      headers: { cookie: me.cookie },
    })
    expect(late.statusCode).toBe(404)
    await repository.purgeStale()
    expect(await db.select().from(receipts)).toEqual([])
    expect(await db.select().from(receiptParts)).toEqual([])
  })

  it('answers someone else’s receipt as a missing one', async () => {
    const me = await owner()
    const other = await owner()
    const id = await queued(me)
    const del = await app.inject({
      method: 'DELETE',
      url: `/receipts/${id}`,
      headers: { cookie: other.cookie },
    })
    expect(del.statusCode).toBe(204)
    expect((await get(me, `/receipts/${id}`)).statusCode).toBe(200)
    expect((await get(other, `/receipts/${id}`)).statusCode).toBe(404)
  })
})

describe('what lives how long (В-3)', () => {
  it('removes a receipt not recorded 28 days after it came, keeps a younger one', async () => {
    const me = await owner()
    const old = await queued(me)
    const young = await queued(me)
    await db
      .update(receipts)
      .set({ createdAt: sql`clock_timestamp() - interval '28 days 1 minute'` })
      .where(eq(receipts.id, old))
    await db
      .update(receipts)
      .set({ createdAt: sql`clock_timestamp() - interval '27 days 23 hours'` })
      .where(eq(receipts.id, young))
    await repository.purgeStale()
    expect((await db.select().from(receipts)).map((r) => r.id)).toEqual([young])
  })

  it('keeps a recorded receipt, drops its photo, and its cut-out lines 28 days after they were confirmed', async () => {
    const me = await owner()
    const id = await queued(me)
    await readAll(benchReader())
    await db
      .update(receipts)
      .set({
        status: 'recorded',
        recordedAt: new Date(),
        createdAt: sql`clock_timestamp() - interval '60 days'`,
      })
      .where(eq(receipts.id, id))
    await db
      .update(receiptLineImages)
      .set({ confirmedText: 'x', confirmedAt: sql`clock_timestamp() - interval '29 days'` })
      .where(sql`${receiptLineImages.receiptId} = ${id} and ${receiptLineImages.position} = 0`)
    await db
      .update(receiptLineImages)
      .set({ confirmedText: 'y', confirmedAt: sql`clock_timestamp() - interval '27 days'` })
      .where(sql`${receiptLineImages.receiptId} = ${id} and ${receiptLineImages.position} = 1`)
    await repository.purgeStale()
    expect((await db.select().from(receipts)).map((r) => r.id)).toEqual([id])
    expect(await db.select().from(receiptParts)).toEqual([])
    expect(await db.select().from(receiptLines)).toHaveLength(13)
    const images = await db.select().from(receiptLineImages)
    expect(images.some((image) => image.position === 0)).toBe(false)
    expect(images.some((image) => image.position === 1)).toBe(true)
  })
})

describe('the queue through the server', () => {
  it('reads a receipt once its last part arrives, and logs neither its text nor its tax number', async () => {
    const lines: string[] = []
    const reading = buildServer({
      db,
      receiptReader: benchReader(),
      logStream: { write: (line) => lines.push(line) },
    })
    await reading.ready()
    try {
      const me = await owner()
      const receipt = body()
      await reading.inject({
        method: 'POST',
        url: '/receipts',
        headers: { cookie: me.cookie },
        payload: receipt,
      })
      await reading.inject({
        method: 'PUT',
        url: `/receipts/${receipt.id}/parts/1`,
        headers: { cookie: me.cookie, 'content-type': 'image/jpeg' },
        payload: jpeg(),
      })
      let status = ''
      for (let i = 0; i < 50 && status !== 'parsed'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        const answer = await reading.inject({
          method: 'GET',
          url: `/receipts/${receipt.id}`,
          headers: { cookie: me.cookie },
        })
        status = z.object({ receipt: z.object({ status: z.string() }) }).parse(answer.json())
          .receipt.status
      }
      expect(status).toBe('parsed')
      const log = lines.join('')
      expect(log).toContain('receipt read')
      expect(log).not.toMatch(/01234567|Կաթ|Իգիթ|8676/)
    } finally {
      await reading.close()
    }
  })
})
