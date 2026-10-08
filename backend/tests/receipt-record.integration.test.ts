import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR, receiptRecordedCodec, tripHistoryCodec, tripViewCodec } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createMoneyRepository } from '@/db/money-repository'
import { createReceiptRepository } from '@/db/receipts-repository'
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
import { createTripRepository } from '@/db/trips-repository'
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
  /** The class code printed on the line: a customs heading, or «56.10» of food service (MOL-226). */
  readonly hs?: string
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
        hs: line.hs ?? null,
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
    // the bag was left out: its line is not kept (MOL-240, В-2)
    expect(lines.map((line) => [line.position, line.expenseId !== null])).toEqual([
      [0, true],
      [1, true],
      [2, true],
      [3, true],
    ])
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

  // review 1, В1, В2: the receipt row holds the trip's date on the accounts, «из чека» and the guard
  // against a second record — it goes with its trip, never before it, and never after (MOL-240, А2 of
  // the adversarial review of MOL-97): nobody sees a recorded receipt without its trip
  it('keeps a recorded receipt while its trip is there, and lets it go with the trip removed for good', async () => {
    const me = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db)
    const id = await parsedReceipt(me, LINES.slice(0, 1))
    const body = () => ({
      tripId: randomUUID(),
      place: { id: place },
      purchasedOn: '2026-09-26',
      // as read: its row is kept for the reader's training, and must go with the receipt too
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
      ],
    })
    const first = body()
    expect((await record(me, id, first)).statusCode).toBe(200)
    const cookie = await signIn(db, me)
    const call = (method: 'DELETE' | 'POST', url: string) =>
      app.inject({ method, url, headers: { cookie } })
    const removed = await call('DELETE', `/receipts/${id}`)
    expect([removed.statusCode, codeOf(removed)]).toEqual([409, ERROR.CONFLICT])
    const kept = async () => ({
      receipts: (await db.select().from(receipts).where(eq(receipts.id, id))).length,
      lines: (await db.select().from(receiptLines).where(eq(receiptLines.receiptId, id))).length,
      rows: (await db.select().from(receiptLineImages).where(eq(receiptLineImages.receiptId, id)))
        .length,
    })

    // the trip marked removed may still come back: neither the old trip nor a new one, and
    // «Вернуть» brings the receipt back whole
    expect((await call('DELETE', `/trips/${first.tripId}`)).statusCode).toBe(204)
    expect((await record(me, id, first)).statusCode).toBe(409)
    expect((await record(me, id, body())).statusCode).toBe(409)
    expect((await call('POST', `/trips/${first.tripId}/restore`)).statusCode).toBe(200)
    expect(await kept()).toEqual({ receipts: 1, lines: 1, rows: 1 })

    // removed for good by the minute timers of `server.ts`: the receipt, its lines and rows go too
    expect((await call('DELETE', `/trips/${first.tripId}`)).statusCode).toBe(204)
    await db
      .update(trips)
      .set({ deletedAt: sql`clock_timestamp() - interval '11 minutes'` })
      .where(eq(trips.id, first.tripId))
    await createTripRepository(db).purgeStale()
    await createReceiptRepository(db).purgeStale()
    expect(await kept()).toEqual({ receipts: 0, lines: 0, rows: 0 })

    // the paper is recorded again by a new shot: its twin went with the trip, and it is counted
    const shot = await parsedReceipt(me, LINES.slice(0, 1))
    expect((await record(me, shot, body())).statusCode).toBe(200)
    expect(await db.select().from(receiptDays)).toMatchObject([{ recorded: 2, lines: 2 }])
  })

  // MOL-240, Б2 of the adversarial review of MOL-97: a purchase removed at once took nothing of its
  // receipt, and its line — what and for how much — lay on the server, unseen, until erasure
  it('lets a line go with its purchase, and keeps the rest of the receipt with its trip', async () => {
    const me = await insertActor(db)
    const place = await insertPlace(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const cheese = await insertItem(db, { name: 'Сыр Лори', searchKey: 'syr lori' })
    const id = await parsedReceipt(me, LINES.slice(0, 2))
    const tripId = randomUUID()
    const recorded = await record(me, id, {
      tripId,
      place: { id: place },
      purchasedOn: '2026-09-26',
      lines: [
        { position: 0, skip: false, item: { id: milk }, quantity: pieces(2), amount: amount(740) },
        { position: 1, skip: false, item: { id: cheese }, quantity: null, amount: amount(1_450) },
      ],
    })
    expect(recorded.statusCode).toBe(200)
    const [bought] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.tripId, tripId), eq(expenses.itemId, cheese)))
    const cookie = await signIn(db, me)
    const removed = await app.inject({
      method: 'DELETE',
      url: `/trips/${tripId}/expenses/${bought?.id ?? ''}`,
      headers: { cookie },
    })
    expect(removed.statusCode).toBe(200)

    const lines = await db.select().from(receiptLines).where(eq(receiptLines.receiptId, id))
    expect(lines.map((line) => line.position)).toEqual([0])
    const rows = await db
      .select()
      .from(receiptLineImages)
      .where(eq(receiptLineImages.receiptId, id))
    expect(rows.map((row) => row.position)).toEqual([0])
    // the receipt still dates its trip and names it «из чека»
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id))
    expect(receipt).toMatchObject({ status: 'recorded', tripId, tin: TIN })
    const view = await app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: { cookie } })
    const trip = tripViewCodec.parse(view.json())
    expect([trip.receiptId, trip.expenses.length]).toEqual([id, 1])
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
    // the total read, opened and saved as it was: a check, never «total put right» (review 10, Б2)
    const checked = await parsedReceipt(me, lines, { receiptNo: '3', totalMinor: 148_000n })
    expect((await record(me, checked, phoneBody(true))).statusCode).toBe(200)
    expect(await db.select().from(receiptDays)).toMatchObject([{ recorded: 1, totalsCorrected: 0 }])
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

  it('records a receipt of food service as a shop’s, its dishes in «Оценки» (MOL-226, В-2 «а»)', async () => {
    const me = await insertActor(db)
    const ketchup = await insertItem(db, { name: 'Кетчуп', searchKey: 'ketchup' })
    const kfc: Line[] = [
      { printed: 'Կետչուպ', hs: '56.10', sku: '740000', price: 115, sum: 115 },
      { printed: '16 Թև', hs: '56.10', sku: '771300', price: 3_930, sum: 3_930 },
    ]
    const id = await parsedReceipt(me, kfc, { layout: 'class' })
    const tripId = randomUUID()
    const response = await record(me, id, {
      tripId,
      place: { name: 'KFC', city: 'Гюмри' },
      purchasedOn: '2026-09-26',
      lines: [
        {
          position: 0,
          skip: false,
          item: { id: ketchup },
          quantity: pieces(1),
          amount: amount(115),
        },
        {
          position: 1,
          skip: false,
          item: { name: '16 крыльев' },
          quantity: pieces(1),
          amount: amount(3_930),
        },
      ],
    })
    expect(response.statusCode).toBe(200)
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId))
    const [place] = await db
      .select()
      .from(places)
      .where(eq(places.id, trip?.placeId ?? ''))
    // a venue and its dishes have no screen before 0.3: «Оценки», the reminder and «Что брать» read
    // products only, so a meal is recorded as a shop's purchases and stays there to be rated
    expect(place).toMatchObject({ name: 'KFC', kind: 'store' })
    const kinds = await db
      .select({ name: items.name, kind: items.kind })
      .from(items)
      .orderBy(asc(items.name))
    expect(kinds).toEqual([
      { name: '16 крыльев', kind: 'product' },
      { name: 'Кетчуп', kind: 'product' },
    ])
    const pending = await createExpenseRepository(db).pendingVerdictsFor(me, 10)
    expect(pending.total).toBe(2)
    // the class stays on the receipt's lines, for the venues of 0.3
    const lines = await db
      .select({ hs: receiptLines.hs })
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id))
    expect(lines.map((line) => line.hs)).toEqual(['56.10', '56.10'])
  })

  describe('a receipt with no items: the sum by the receipt (MOL-227)', () => {
    const noItems = { layout: 'department' as const, receiptNo: null, totalMinor: 170_000n }

    it('records a finished trip on the receipt’s day whose money is the total, with no purchase', async () => {
      const me = await insertActor(db)
      const id = await parsedReceipt(me, [], noItems)
      const tripId = randomUUID()
      const response = await record(me, id, {
        tripId,
        place: { name: 'Гая 5', city: 'Гюмри' },
        purchasedOn: '2026-09-26',
        lines: [],
      })
      expect(response.statusCode).toBe(200)
      const [trip] = await db.select().from(trips).where(eq(trips.id, tripId))
      expect(trip).toMatchObject({ startedOn: '2026-09-26', receiptMinor: 170_000n })
      expect(trip?.finishedAt).not.toBeNull()
      expect(await db.select().from(expenses)).toEqual([])
      const [held] = await db.select().from(receipts).where(eq(receipts.id, id))
      expect([held?.status, held?.tripId]).toEqual(['recorded', tripId])
      expect(await db.select().from(receiptDays)).toMatchObject([
        { recorded: 1, lines: 0, linesEdited: 0, totalsCorrected: 0 },
      ])
    })

    it('takes the total the person typed where OCR read none, as the receipt’s own edit', async () => {
      const me = await insertActor(db)
      const id = await parsedReceipt(me, [], { ...noItems, totalMinor: null })
      const tripId = randomUUID()
      const response = await record(me, id, {
        tripId,
        place: { name: 'Гая 5', city: 'Гюмри' },
        purchasedOn: '2026-09-26',
        total: amount(1_800),
        lines: [],
      })
      expect(response.statusCode).toBe(200)
      const [trip] = await db.select().from(trips).where(eq(trips.id, tripId))
      expect(trip?.receiptMinor).toBe(180_000n)
      expect(await db.select().from(receiptDays)).toMatchObject([
        { recorded: 1, totalsCorrected: 1 },
      ])
    })

    it('refuses a trip with no money and no purchase: no total read and none typed (Р-4)', async () => {
      const me = await insertActor(db)
      const id = await parsedReceipt(me, [], { ...noItems, totalMinor: null })
      const response = await record(me, id, {
        tripId: randomUUID(),
        place: { name: 'Гая 5', city: 'Гюмри' },
        purchasedOn: '2026-09-26',
        lines: [],
      })
      expect(response.statusCode).toBe(409)
      expect(codeOf(response)).toBe(ERROR.RECEIPT_TOTAL_REQUIRED)
      expect(await db.select().from(trips)).toEqual([])
      expect(await db.select().from(places)).toEqual([])
      const [held] = await db.select().from(receipts).where(eq(receipts.id, id))
      expect(held?.status).toBe('parsed')
    })

    it('keeps the sum on its trip: taken off, nothing would be left (adversarial А4)', async () => {
      const me = await insertActor(db)
      const id = await parsedReceipt(me, [], noItems)
      const tripId = randomUUID()
      const body = { tripId, place: { name: 'Гая 5', city: 'Гюмри' }, purchasedOn: '2026-09-26' }
      expect((await record(me, id, { ...body, lines: [] })).statusCode).toBe(200)
      const off = await app.inject({
        method: 'PUT',
        url: `/trips/${tripId}/receipt`,
        headers: { cookie: await signIn(db, me) },
        payload: { receipt: null },
      })
      expect(off.statusCode).toBe(409)
      expect(codeOf(off)).toBe(ERROR.RECEIPT_TOTAL_REQUIRED)
      const [trip] = await db.select().from(trips).where(eq(trips.id, tripId))
      expect(trip?.receiptMinor).toBe(170_000n)
    })

    it('records the same receipt twice where its fiscal number was not read — the price, named (Р-8)', async () => {
      const me = await insertActor(db)
      const first = await parsedReceipt(me, [], noItems)
      const second = await parsedReceipt(me, [], noItems)
      for (const id of [first, second]) {
        const response = await record(me, id, {
          tripId: randomUUID(),
          place: { name: 'Гая 5', city: 'Гюмри' },
          purchasedOn: '2026-09-26',
          lines: [],
        })
        expect(response.statusCode).toBe(200)
      }
      expect(await db.select().from(trips)).toHaveLength(2)
    })

    it('refuses it recorded before where its fiscal number was read (Т-11)', async () => {
      const me = await insertActor(db)
      const read = { ...noItems, receiptNo: '11223344' }
      const first = await parsedReceipt(me, [], read)
      const second = await parsedReceipt(me, [], read)
      const body = { place: { name: 'Гая 5', city: 'Гюмри' }, purchasedOn: '2026-09-26', lines: [] }
      expect((await record(me, first, { ...body, tripId: randomUUID() })).statusCode).toBe(200)
      const again = await record(me, second, { ...body, tripId: randomUUID() })
      expect(codeOf(again)).toBe(ERROR.RECEIPT_RECORDED_BEFORE)
    })
  })
})
