import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
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
  receiptDays,
  receiptLineImages,
  receiptLines,
  receiptParts,
  receipts,
  storeMemory,
  trips,
} from '@/db/schema'
import { buildServer } from '@/server'
import { connect, connectDrizzle } from './db'
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
  /** The item the queue bound the line to (MOL-126). */
  readonly itemId?: string
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
        itemId: line.itemId ?? null,
        match: line.itemId === undefined ? ('new' as const) : ('search' as const),
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
    // the repeat is the same record: counted once (MOL-222)
    expect(await db.select().from(receiptDays)).toMatchObject([{ recorded: 1, lines: 1 }])
  })

  it('answers «recorded?» only once a record still running has ended (MOL-169, Г1)', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const id = await parsedReceipt(me, LINES.slice(0, 1))
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const cookie = await signIn(db, me)
    const settled = () =>
      app.inject({ method: 'GET', url: `/receipts/${id}/settled`, headers: { cookie } })

    // A «Записать» the phone gave up on, still in its transaction on a connection of its own (the
    // test's one connection would make the read wait for a connection, not the lock): it holds the
    // owner's lock first.
    const elsewhere = connect()
    let locked: () => void = () => undefined
    const holding = new Promise<void>((resolve) => (locked = resolve))
    let finish: () => void = () => undefined
    const running = elsewhere.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('trips'), hashtext(${me}))`
      locked()
      await new Promise<void>((resolve) => (finish = resolve))
    })
    await holding
    let answered = false
    const asked = settled().then((response) => {
      answered = true
      return response
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(answered).toBe(false)
    finish()
    await running
    await elsewhere.end()
    const first = await asked
    expect([first.statusCode, first.json()]).toEqual([200, { tripId: null }])

    const tripId = randomUUID()
    const recorded = await record(me, id, {
      tripId,
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
      ],
    })
    expect(recorded.statusCode).toBe(200)
    expect((await settled()).json()).toEqual({ tripId })

    // Someone else's receipt is not there, as for every read of a receipt.
    const other = await insertActor(db)
    const theirs = await app.inject({
      method: 'GET',
      url: `/receipts/${id}/settled`,
      headers: { cookie: await signIn(db, other) },
    })
    expect([theirs.statusCode, codeOf(theirs)]).toEqual([404, ERROR.NOT_FOUND])
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
    // a total in another currency than the receipt's is the phone's mistake (round 2, Р2-В2)
    const other = await parsedReceipt(me, LINES.slice(0, 2), { receiptNo: '4' })
    const refused = await record(me, other, body({ total: { amount: '10', currency: 'USD' } }))
    expect([refused.statusCode, codeOf(refused)]).toEqual([400, ERROR.CURRENCY_MISMATCH])
    // lines each within the column's bound, past it together: refused, not a 500 (round 3, Р3-В1)
    const huge = await parsedReceipt(me, LINES.slice(0, 2), { receiptNo: '5' })
    const vast = { amount: '50000000000000000', currency: 'AMD' }
    const overflow = await record(
      me,
      huge,
      body({
        lines: [
          { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: vast },
          { position: 1, skip: false, item: { id: milk }, quantity: pieces(1), amount: vast },
        ],
      }),
    )
    expect([overflow.statusCode, codeOf(overflow)]).toEqual([400, ERROR.INVALID_AMOUNT])
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
    // the measure counts the receipt's first record only (MOL-222, review 7)
    expect(await db.select().from(receiptDays)).toMatchObject([{ recorded: 1, lines: 1 }])
  })

  // MOL-222: the measure of 0.2 — what the person put right against what the review showed
  it('counts the lines put right against what the review showed, each line once', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const cheese = await insertItem(db, { name: 'Сыр Лори', searchKey: 'syr lori' })
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const line = (
      position: number,
      item: Record<string, string>,
      qty = 1,
      drams = 100,
    ): Record<string, unknown> => ({
      position,
      skip: false,
      item,
      quantity: pieces(qty),
      amount: amount(drams),
    })
    // the first receipt teaches the shop's memory: article «7000005» is the cheese
    const first = await parsedReceipt(
      me,
      [{ printed: 'ՊԱՆԻՐ', sku: '7000005', price: 100, sum: 100 }],
      { receiptNo: '1' },
    )
    expect(
      (
        await record(me, first, {
          tripId: randomUUID(),
          place: { id: place },
          purchasedOn: '2026-09-26',
          lines: [line(0, { id: cheese })],
        })
      ).statusCode,
    ).toBe(200)
    // shown nothing, the cheese chosen: an item put right
    expect(await db.select().from(receiptDays)).toMatchObject([
      { recorded: 1, lines: 1, linesEdited: 1, linesItem: 1, linesFigures: 0, linesSkipped: 0 },
    ])
    await db.delete(receiptDays)

    const second = await parsedReceipt(
      me,
      [
        { printed: 'Կաթ', sku: '7000000', price: 100, sum: 100, itemId: milk },
        { printed: 'Հաց', sku: '7000001', price: 100, sum: 100 },
        { printed: 'Կաթ 2', sku: '7000002', price: 100, sum: 100, itemId: milk },
        { printed: 'Ձու', sku: '7000003', price: 100, sum: 100 },
        { printed: 'Տոպրակ', sku: '7000004', price: 100, sum: 100 },
        { printed: 'ՊԱՆԻՐ', sku: '7000005', price: 100, sum: 100 },
      ],
      { receiptNo: '2' },
    )
    const response = await record(me, second, {
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        // as shown: the parse's milk
        line(0, { id: milk }),
        // as shown: new, named by the person — the reading gave no name to correct
        line(1, { name: 'Хлеб' }),
        // another item and another sum: one line edited, counted in both kinds
        line(2, { id: cheese }, 1, 90),
        // the quantity put right
        line(3, { name: 'Яйца' }, 2, 100),
        { position: 4, skip: true },
        // the cheese the memory showed, left as it is
        line(5, { id: cheese }),
      ],
    })
    expect(response.statusCode).toBe(200)
    expect(await db.select().from(receiptDays)).toMatchObject([
      { recorded: 1, lines: 6, linesEdited: 3, linesSkipped: 1, linesItem: 1, linesFigures: 2 },
    ])
  })

  it('counts the time from the server taking the receipt to its record, by the bucket', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const ago = async (receiptNo: string, interval: string) => {
      const id = await parsedReceipt(me, LINES.slice(0, 1), { receiptNo })
      await db.execute(
        sql`update receipts set created_at = now() - ${interval}::interval where id = ${id}`,
      )
      const response = await record(me, id, {
        tripId: randomUUID(),
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
        ],
      })
      expect(response.statusCode).toBe(200)
    }
    await ago('1', '4 minutes 50 seconds')
    await ago('2', '5 minutes 10 seconds')
    await ago('3', '59 minutes')
    await ago('4', '23 hours')
    await ago('5', '2 days')
    expect(await db.select().from(receiptDays)).toMatchObject([
      { recorded: 5, within5m: 1, within15m: 1, within1h: 1, within1d: 1, later: 1 },
    ])
  })

  // MOL-222, adversarial А6: the memory learns from another record between the review and «Записать»;
  // only the phone knows what it showed, and it says which lines it put right
  it('counts what the phone says it put right, whatever the memory learnt meanwhile', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const cheese = await insertItem(db, { name: 'Сыр Лори', searchKey: 'syr lori' })
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const bound: Line = { printed: 'ՊԱՆԻՐ', sku: '7000005', price: 100, sum: 100, itemId: milk }
    const a = await parsedReceipt(me, [bound], { receiptNo: '1' })
    const b = await parsedReceipt(me, [bound], { receiptNo: '2' })
    const c = await parsedReceipt(me, [bound], { receiptNo: '3' })
    const body = (itemId: string, edited: number[]) => ({
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        {
          position: 0,
          skip: false,
          item: { id: itemId },
          quantity: pieces(1),
          amount: amount(100),
        },
      ],
      edited: { item: edited, figures: [] },
    })
    // A: the article put right — milk to cheese — and the memory learns it
    expect((await record(me, a, body(cheese, [0]))).statusCode).toBe(200)
    expect(await db.select().from(receiptDays)).toMatchObject([{ linesEdited: 1, linesItem: 1 }])
    await db.delete(receiptDays)
    // B: recorded as its review showed it before A — milk, nothing put right
    expect((await record(me, b, body(milk, []))).statusCode).toBe(200)
    expect(await db.select().from(receiptDays)).toMatchObject([{ linesEdited: 0, linesItem: 0 }])
    await db.delete(receiptDays)
    // C: put right the same way as A, though the memory would now show cheese
    expect((await record(me, c, body(cheese, [0]))).statusCode).toBe(200)
    expect(await db.select().from(receiptDays)).toMatchObject([{ linesEdited: 1, linesItem: 1 }])
  })

  // MOL-222, review 2 and adversarial А7: a total put right confirms the printed sums of the lines that
  // do not add up (В-5) — one edit of the receipt, never of the lines nobody opened
  it('counts a total put right as the receipt’s own edit, none of its lines', async () => {
    const me = await insertActor(db)
    const chocolate = await insertItem(db, { name: 'Шоколад', searchKey: 'shokolad' })
    const milk = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const lines: Line[] = [
      { printed: 'Շոկոլադ', sku: '1110002', price: 890, sum: 980, itemId: chocolate },
      { printed: 'Կաթ', sku: '1163909', price: 500, sum: 500, itemId: milk },
    ]
    // OCR read 1 408 for the printed 1 480: the review shows the chocolate at 890
    const phoneBody = (edited: boolean) => ({
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      total: amount(1_480),
      // what the phone sends once the total confirms the printed 980 (`amountsOf`, review 4)
      lines: [
        {
          position: 0,
          skip: false,
          item: { id: chocolate },
          quantity: pieces(1),
          amount: amount(980),
        },
        { position: 1, skip: false, item: { id: milk }, quantity: pieces(1), amount: amount(500) },
      ],
      ...(edited ? { edited: { item: [], figures: [] } } : {}),
    })
    for (const [receiptNo, edited] of [
      ['1', true],
      ['2', false],
    ] as const) {
      const id = await parsedReceipt(me, lines, { receiptNo, totalMinor: 140_800n })
      expect((await record(me, id, phoneBody(edited))).statusCode).toBe(200)
      // the phone's word, and an earlier build's comparison under the phone's total, alike
      expect(await db.select().from(receiptDays), receiptNo).toMatchObject([
        { recorded: 1, lines: 2, linesEdited: 0, linesFigures: 0, totalsCorrected: 1 },
      ])
      await db.delete(receiptDays)
    }
  })

  it('takes the phone’s positions only of lines recorded: a skipped or unknown one is no item edit', async () => {
    const me = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    const place = await insertPlace(db, { name: 'Ереван Сити' })
    const id = await parsedReceipt(me, LINES.slice(0, 2))
    const response = await record(me, id, {
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
        { position: 1, skip: true },
      ],
      edited: { item: [0, 1, 7], figures: [0] },
    })
    expect(response.statusCode).toBe(200)
    expect(await db.select().from(receiptDays)).toMatchObject([
      { lines: 2, linesEdited: 2, linesSkipped: 1, linesItem: 1, linesFigures: 1 },
    ])
  })
})
