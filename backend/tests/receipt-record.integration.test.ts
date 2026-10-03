import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR, receiptRecordedCodec, tripHistoryCodec, tripViewCodec } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createMoneyRepository } from '@/db/money-repository'
import {
  expenses,
  items,
  places,
  receiptLineImages,
  receiptLines,
  receiptParts,
  receipts,
  storeMemory,
  trips,
} from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, signIn } from './fixtures'

/**
 * «Записать» (MOL-126): a parsed receipt written in one go as a finished trip on its own day, its
 * purchases, new items, the shop's memory, the place's tax number — and what it leaves behind.
 */
const { db, close } = connectDrizzle()
let app: FastifyInstance

const TIN = '01282006'

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

interface Line {
  readonly printed: string
  readonly sku?: string
  readonly qty?: number
  readonly price: number
  readonly sum: number
}

/** A receipt the queue laid out: one part still held, a row cut out of each line. */
async function parsedReceipt(
  actorId: string,
  lines: readonly Line[],
  over: Partial<typeof receipts.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID()
  await db.insert(receipts).values({
    id,
    actorId,
    status: 'parsed',
    parts: 1,
    country: 'AM',
    language: 'ru',
    currency: 'AMD',
    capturedAt: new Date('2026-09-26T16:00:00Z'),
    queuedAt: new Date('2026-09-26T16:00:01Z'),
    tin: TIN,
    printedOn: '2026-09-26',
    printedTime: '19:42',
    receiptNo: '21410811',
    totalMinor: BigInt(lines.reduce((sum, line) => sum + line.sum, 0) * 100),
    city: 'Гюмри',
    layout: 'card',
    ...over,
  })
  await db.insert(receiptParts).values({
    receiptId: id,
    position: 1,
    photo: Buffer.from([0xff, 0xd8]),
    width: 800,
    height: 2400,
  })
  if (lines.length > 0) {
    await db.insert(receiptLines).values(
      lines.map((line, position) => ({
        receiptId: id,
        position,
        printed: line.printed,
        sku: line.sku ?? null,
        qtyMilli: BigInt((line.qty ?? 1) * 1000),
        qtyUnit: 'piece' as const,
        priceMinor: BigInt(line.price * 100),
        sumMinor: BigInt(line.sum * 100),
        discountMinor: 0n,
        settled: line.price * (line.qty ?? 1) === line.sum,
        match: 'new' as const,
      })),
    )
    await db.insert(receiptLineImages).values(
      lines.map((line, position) => ({
        receiptId: id,
        position,
        piece: 0,
        image: Buffer.from([0x89, position]),
        readText: `${line.sku ?? ''} ${String(line.sum)}`,
      })),
    )
  }
  return id
}

const codeOf = (response: { json: () => unknown }) =>
  z.object({ code: z.string() }).parse(response.json()).code

const amount = (drams: number) => ({ amount: String(drams), currency: 'AMD' })
const pieces = (n: number) => ({ value: String(n), unit: 'piece' })

async function record(actorId: string, id: string, body: Record<string, unknown>) {
  const cookie = await signIn(db, actorId)
  return app.inject({
    method: 'POST',
    url: `/receipts/${id}/record`,
    headers: { cookie, 'x-molvia-today': '2026-10-03' },
    payload: body,
  })
}

const LINES: Line[] = [
  { printed: 'Կաթ «Իգիթ» 3.2% 1լ', sku: '1163909', qty: 2, price: 370, sum: 740 },
  { printed: 'ՊԱՆԻՐ ԼՈՌԻ ԱՊԽ.', sku: '1110001', price: 1_450, sum: 1_450 },
  { printed: 'Շոկոլադ «Գրանդ»', sku: '1110002', price: 890, sum: 980 },
  { printed: 'ՊԱՆԻՐ ԼՈՌԻ ԱՊԽ. 2', sku: '1110003', price: 1_450, sum: 1_450 },
  { printed: 'Պոլիէթիլենային տոպրակ', sku: '1122223', price: 20, sum: 20 },
]

describe('«Записать»', () => {
  it('writes a finished trip on the receipt’s day with its purchases, new items and memory', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const chocolate = await insertItem(db, { name: 'Шоколад', searchKey: 'shokolad' })
    const id = await parsedReceipt(me, LINES)
    const tripId = randomUUID()

    const response = await record(me, id, {
      tripId,
      place: { name: 'Ереван Сити', city: 'Гюмри' },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
        {
          position: 1,
          skip: false,
          item: { name: 'Сыр Лори копчёный' },
          quantity: pieces(1),
          amount: amount(1_450),
        },
        {
          position: 2,
          skip: false,
          item: { id: chocolate },
          quantity: pieces(1),
          amount: amount(980),
        },
        {
          position: 3,
          skip: false,
          item: { name: 'сыр лори копчёный' },
          quantity: pieces(1),
          amount: amount(1_450),
        },
        { position: 4, skip: true },
      ],
    })
    expect(response.statusCode).toBe(200)
    const answer = receiptRecordedCodec.parse(response.json())
    expect(answer.tripId).toBe(tripId)
    expect(answer.receipt).toMatchObject({ status: 'recorded', tripId })

    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId))
    expect(trip).toMatchObject({
      actorId: me,
      startedOn: '2026-09-26',
      finishedOn: '2026-09-26',
      finishedOnDeviceAt: new Date('2026-09-26T15:42:00Z'),
      receiptMinor: 464_000n,
      receiptCurrency: 'AMD',
      currency: 'AMD',
    })
    expect(trip?.finishedAt).not.toBeNull()
    const [place] = await db
      .select()
      .from(places)
      .where(eq(places.id, trip?.placeId ?? ''))
    expect(place).toMatchObject({ name: 'Ереван Сити', city: 'Гюмри' })

    const bought = await db
      .select({ itemId: expenses.itemId, amount: expenses.amountMinor, qty: expenses.qtyMilli })
      .from(expenses)
      .where(eq(expenses.tripId, tripId))
      .orderBy(asc(expenses.amountMinor))
    expect(bought).toHaveLength(4)
    const smoked = await db.select().from(items).where(eq(items.name, 'Сыр Лори копчёный'))
    expect(smoked).toHaveLength(1)
    expect(smoked[0]?.createdBy).toBe(me)
    expect(bought.filter((row) => row.itemId === smoked[0]?.id)).toHaveLength(2)

    const lines = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
      .orderBy(asc(receiptLines.position))
    expect(lines.map((line) => line.expenseId !== null)).toEqual([true, true, true, true, false])
    expect(await db.select().from(receiptParts).where(eq(receiptParts.receiptId, id))).toEqual([])
    // the lines recorded as read keep their rows; the chocolate's figures were corrected (890 ≠ 980
    // read), the bag was left out — theirs go
    const images = await db
      .select()
      .from(receiptLineImages)
      .where(eq(receiptLineImages.receiptId, id))
      .orderBy(asc(receiptLineImages.position))
    expect(images.map((image) => image.position)).toEqual([0, 1, 3])
    expect(images.every((image) => image.confirmedText === image.readText)).toBe(true)

    const words = await db
      .select()
      .from(storeMemory)
      .where(eq(storeMemory.kind, 'sku'))
      .orderBy(asc(storeMemory.key))
    expect(words.map((word) => [word.key, word.priceMinor])).toEqual([
      ['1110001', 145_000n],
      ['1110002', null],
      ['1110003', 145_000n],
      ['1163909', 37_000n],
    ])
    expect(words.every((word) => word.actorId === me && word.tin === TIN)).toBe(true)

    // «Деньги» of September and «Оценки»: the trip and its purchases, as any other
    const month = await createMoneyRepository(db).tripLines(me, '2026-09-01', '2026-09-30')
    expect(month.map((line) => [line.tripId, line.amount.minor, line.finishedOn])).toEqual([
      [tripId, 464_000n, '2026-09-26'],
    ])
    const pending = await createExpenseRepository(db).pendingVerdictsFor(me, 10)
    expect(pending.total).toBe(3)
  })

  it('answers a repeat with the same trip as before, another trip with a 409', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const id = await parsedReceipt(me, LINES.slice(0, 1))
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const body = (tripId: string) => ({
      tripId,
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
      ],
    })
    const tripId = randomUUID()
    expect((await record(me, id, body(tripId))).statusCode).toBe(200)
    const again = await record(me, id, body(tripId))
    expect(again.statusCode).toBe(200)
    expect(receiptRecordedCodec.parse(again.json()).tripId).toBe(tripId)
    expect(await db.select().from(trips)).toHaveLength(1)
    expect(await db.select().from(expenses)).toHaveLength(1)

    const other = await record(me, id, body(randomUUID()))
    expect([other.statusCode, codeOf(other)]).toEqual([409, ERROR.CONFLICT])
  })

  it('refuses the same receipt recorded before while its purchases are there (Т-11)', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const place = await insertPlace(db)
    const body = () => ({
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
      ],
    })
    const first = await parsedReceipt(me, LINES.slice(0, 1))
    const firstBody = body()
    expect((await record(me, first, firstBody)).statusCode).toBe(200)

    const second = await parsedReceipt(me, LINES.slice(0, 1))
    const refused = await record(me, second, body())
    expect([refused.statusCode, codeOf(refused)]).toEqual([409, ERROR.RECEIPT_RECORDED_BEFORE])

    // the purchases removed, the receipt may be recorded again
    await db.update(trips).set({ deletedAt: new Date() }).where(eq(trips.id, firstBody.tripId))
    expect((await record(me, second, body())).statusCode).toBe(200)
  })

  it('refuses a receipt not read yet, lines that are not the receipt’s, and a day to come', async () => {
    const me = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const line = { position: 0, skip: false, item: { id: milk }, quantity: null, amount: null }
    const body = (over: Record<string, unknown> = {}) => ({
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [line],
      ...over,
    })

    const queued = await parsedReceipt(me, LINES.slice(0, 1), { status: 'queued' })
    const notReady = await record(me, queued, body())
    expect([notReady.statusCode, codeOf(notReady)]).toEqual([409, ERROR.RECEIPT_NOT_READY])

    const id = await parsedReceipt(me, LINES.slice(0, 2))
    for (const lines of [
      [line],
      [line, { ...line, position: 0 }],
      [line, { ...line, position: 2 }],
    ]) {
      const response = await record(me, id, body({ lines }))
      expect([response.statusCode, codeOf(response)]).toEqual([409, ERROR.CONFLICT])
    }
    const twoLines = [line, { position: 1, skip: true }]
    const future = await record(me, id, body({ lines: twoLines, purchasedOn: '2026-10-30' }))
    expect([future.statusCode, codeOf(future)]).toEqual([400, ERROR.RECEIPT_IN_FUTURE])
    const unknownItem = await record(me, id, {
      ...body({
        lines: [
          { ...line, item: { id: randomUUID() } },
          { position: 1, skip: true },
        ],
      }),
    })
    expect(unknownItem.statusCode).toBe(409)
    expect(await db.select().from(trips)).toEqual([])
  })

  it('counts the trip by the lines, the ones left out too, when the total was not read', async () => {
    const me = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const id = await parsedReceipt(me, LINES.slice(0, 2), { totalMinor: null })
    const tripId = randomUUID()
    const response = await record(me, id, {
      tripId,
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(700) },
        { position: 1, skip: true },
      ],
    })
    expect(response.statusCode).toBe(200)
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId))
    expect(trip?.receiptMinor).toBe(215_000n)
  })

  it('shows the trip as recorded from the receipt: each purchase with its line and discount', async () => {
    const me = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const id = await parsedReceipt(me, LINES.slice(0, 2))
    await db
      .update(receiptLines)
      .set({ discountMinor: 740n })
      .where(and(eq(receiptLines.receiptId, id), eq(receiptLines.position, 0)))
    const tripId = randomUUID()
    expect(
      (
        await record(me, id, {
          tripId,
          place: { id: place },
          purchasedOn: '2026-09-26',
          lines: [
            {
              position: 0,
              skip: false,
              item: { id: milk },
              quantity: pieces(2),
              amount: amount(740),
            },
            { position: 1, skip: true },
          ],
        })
      ).statusCode,
    ).toBe(200)

    const cookie = await signIn(db, me)
    const trip = tripViewCodec.parse(
      (await app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: { cookie } })).json(),
    )
    expect(trip.receiptId).toBe(id)
    expect(trip.expenses.map((row) => [row.printed, row.discount?.minor ?? null])).toEqual([
      ['Կաթ «Իգիթ» 3.2% 1լ', 740n],
    ])
    const history = tripHistoryCodec.parse(
      (await app.inject({ method: 'GET', url: '/trips/history', headers: { cookie } })).json(),
    )
    expect(history.trips.map((row) => [row.id, row.fromReceipt])).toEqual([[tripId, true]])
  })

  it('is the owner’s alone, and takes a place by its id only in the receipt’s geography (В8)', async () => {
    const me = await insertActor(db)
    const stranger = await insertActor(db)
    const place = await insertPlace(db)
    const tbilisi = await insertPlace(db, { name: 'Carrefour', country: 'GE', city: 'Тбилиси' })
    const nowhere = await insertPlace(db, { name: 'SAS', city: 'Ванадзор' })
    const milk = await insertItem(db)
    const id = await parsedReceipt(me, LINES.slice(0, 1))
    const body = (placeId: string) => ({
      tripId: randomUUID(),
      place: { id: placeId },
      purchasedOn: '2026-09-26',
      lines: [{ position: 0, skip: false, item: { id: milk }, quantity: null, amount: null }],
    })
    expect((await record(stranger, id, body(place))).statusCode).toBe(404)
    for (const elsewhere of [tbilisi, nowhere]) {
      const refused = await record(me, id, body(elsewhere))
      expect([refused.statusCode, codeOf(refused)]).toEqual([409, ERROR.CONFLICT])
    }
    expect((await record(me, id, body(place))).statusCode).toBe(200)
  })

  it('takes the total the phone sends, else the printed one only where it is not below the lines (В-5)', async () => {
    const me = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const body = (over: Record<string, unknown> = {}) => ({
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
        {
          position: 1,
          skip: false,
          item: { id: milk },
          quantity: pieces(1),
          amount: amount(1_450),
        },
      ],
      ...over,
    })
    const moneyOf = async (receipt: string, payload: ReturnType<typeof body>) => {
      expect((await record(me, receipt, payload)).statusCode).toBe(200)
      const [trip] = await db.select().from(trips).where(eq(trips.id, payload.tripId))
      return trip?.receiptMinor
    }
    // misread below the lines (В5): 2 190 of lines, 190 printed — the lines
    const low = await parsedReceipt(me, LINES.slice(0, 2), { totalMinor: 19_000n, receiptNo: '1' })
    expect(await moneyOf(low, body())).toBe(219_000n)
    // above the lines — a line OCR lost: the printed one
    const lost = await parsedReceipt(me, LINES.slice(0, 2), {
      totalMinor: 250_000n,
      receiptNo: '2',
    })
    expect(await moneyOf(lost, body())).toBe(250_000n)
    // the person corrected the total on the review
    const fixed = await parsedReceipt(me, LINES.slice(0, 2), {
      totalMinor: 319_000n,
      receiptNo: '3',
    })
    expect(await moneyOf(fixed, body({ total: amount(2_190) }))).toBe(219_000n)
  })

  // review 1, В1, В2, В7: the receipt row holds the trip's date on the accounts, «из чека» and the
  // guard against a second record — it goes with its trip, never before it
  it('keeps a recorded receipt while its trip is there, and lets it be recorded again once the trip is gone', async () => {
    const me = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const id = await parsedReceipt(me, LINES.slice(0, 1))
    const body = () => ({
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [{ position: 0, skip: false, item: { id: milk }, quantity: null, amount: null }],
    })
    const first = body()
    expect((await record(me, id, first)).statusCode).toBe(200)
    const cookie = await signIn(db, me)
    const removed = await app.inject({
      method: 'DELETE',
      url: `/receipts/${id}`,
      headers: { cookie },
    })
    expect([removed.statusCode, codeOf(removed)]).toEqual([409, ERROR.CONFLICT])

    // the trip marked removed may still come back: neither the old trip nor a new one
    await db.update(trips).set({ deletedAt: new Date() }).where(eq(trips.id, first.tripId))
    expect((await record(me, id, first)).statusCode).toBe(409)
    expect((await record(me, id, body())).statusCode).toBe(409)

    // removed for good: the receipt is recorded again, from its lines
    await db.delete(trips).where(eq(trips.id, first.tripId))
    const again = body()
    expect((await record(me, id, again)).statusCode).toBe(200)
    const [row] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect([row?.status, row?.tripId]).toEqual(['recorded', again.tripId])
  })
})
