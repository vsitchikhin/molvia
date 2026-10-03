import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { receiptDetailCodec, receiptsResponseCodec, storeMemoryWords } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, officialRates, receiptLines, receipts, trips as tripsTable } from '@/db/schema'
import { createStoreMemoryRepository, memoryKey } from '@/db/store-memory-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

/**
 * The review of a receipt (MOL-126): the shops' memory laid over what the parse found, the place by
 * the seller's tax number in its city, what a line is recorded at, the rate of the receipt's day and
 * the same receipt recorded before.
 */
const { db, close } = connectDrizzle()
const memory = createStoreMemoryRepository(db)
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
  readonly sku?: string | null
  readonly qty?: number
  readonly price: number
  readonly sum: number
  readonly settled?: boolean
  readonly itemId?: string | null
  readonly match?: 'search' | 'weak' | 'new' | null
}

/** A receipt as the queue leaves it, parsed, with its lines; amounts in drams. */
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
    totalMinor: 563_300n,
    layout: 'card',
    ...over,
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
        settled: line.settled ?? line.price * (line.qty ?? 1) === line.sum,
        itemId: line.itemId ?? null,
        match: line.match === undefined ? 'new' : line.match,
      })),
    )
  }
  return id
}

async function review(actorId: string, id: string) {
  const cookie = await signIn(db, actorId)
  const response = await app.inject({
    method: 'GET',
    url: `/receipts/${id}`,
    headers: { cookie, 'x-molvia-today': '2026-10-03' },
  })
  expect(response.statusCode).toBe(200)
  return receiptDetailCodec.parse(response.json())
}

const milkWord = { kind: 'sku' as const, key: '1163909' }
const amd = (drams: number) => ({ minor: BigInt(drams * 100), currency: 'AMD' as const })

describe('the shops’ memory (Р-2)', () => {
  it('answers a person by their own word, others by the most said, the later on a tie', async () => {
    const [me, wife, third] = [await insertActor(db), await insertActor(db), await insertActor(db)]
    const newcomer = await insertActor(db)
    const full = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const light = await insertItem(db, { name: 'Молоко 2,5%', searchKey: 'moloko 2,5%' })
    const recall = async (actorId: string) =>
      (await memory.recall(actorId, TIN, [milkWord])).get(memoryKey(milkWord))?.itemId

    await memory.remember(me, TIN, [{ ...milkWord, itemId: full, price: amd(370) }])
    expect(await recall(newcomer)).toBe(full)

    await memory.remember(wife, TIN, [{ ...milkWord, itemId: light, price: amd(370) }])
    expect([await recall(me), await recall(wife), await recall(newcomer)]).toEqual([
      full,
      light,
      light,
    ])

    await memory.remember(third, TIN, [{ ...milkWord, itemId: full, price: amd(380) }])
    expect(await recall(newcomer)).toBe(full)
    expect(
      (await memory.recall(newcomer, TIN, [milkWord])).get(memoryKey(milkWord))?.price,
    ).toEqual(amd(380))

    // erased, the word stays without its author and still counts
    await db.delete(actors).where(eq(actors.id, me))
    expect(await recall(newcomer)).toBe(full)
    expect(await recall(wife)).toBe(light)
  })

  it('rewrites a person’s own word, and knows nothing at another seller', async () => {
    const me = await insertActor(db)
    const full = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const light = await insertItem(db, { name: 'Молоко 2,5%', searchKey: 'moloko 2,5%' })
    await memory.remember(me, TIN, [{ ...milkWord, itemId: full, price: null }])
    await memory.remember(me, TIN, [{ ...milkWord, itemId: light, price: amd(390) }])
    expect((await memory.recall(me, TIN, [milkWord])).get(memoryKey(milkWord))).toEqual({
      itemId: light,
      price: amd(390),
    })
    expect((await memory.recall(me, '57424557', [milkWord])).size).toBe(0)
    expect(await memory.recall(me, TIN, [])).toEqual(new Map())
  })
})

describe('the review of a receipt', () => {
  it('lays the memory over the parse: the article first, then the line as printed', async () => {
    const me = await insertActor(db)
    const other = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const kefir = await insertItem(db, { name: 'Кефир', searchKey: 'kefir' })
    const guess = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    const byText = storeMemoryWords({ printed: 'ԿԵՖԻՐ 1%', sku: null })
    await memory.remember(other, TIN, [{ ...milkWord, itemId: milk, price: amd(370) }])
    await memory.remember(other, TIN, [{ ...(byText[0] ?? milkWord), itemId: kefir, price: null }])
    const id = await parsedReceipt(me, [
      {
        printed: 'Կաթ «Իգիթ» 3.2% 1լ',
        sku: '1163909',
        price: 370,
        sum: 370,
        itemId: guess,
        match: 'weak',
      },
      { printed: 'ԿԵՖԻՐ 1%', price: 500, sum: 500 },
      { printed: 'ՊԱՆԻՐ ԼՈՌԻ', price: 1_450, sum: 1_450, itemId: guess, match: 'search' },
      { printed: '???', price: 20, sum: 20 },
    ])

    const detail = await review(me, id)
    expect(detail.lines.map((line) => [line.itemName, line.match])).toEqual([
      ['Молоко 3,2%', 'memory'],
      ['Кефир', 'memory'],
      ['Молоко', 'search'],
      [null, 'new'],
    ])
  })

  it('records an unsettled line at its printed sum when the total confirms it, else by its figures (В-5)', async () => {
    const me = await insertActor(db)
    const lines: Line[] = [
      { printed: 'A', price: 531, sum: 531 },
      { printed: 'B', price: 1_032, sum: 1_032 },
      { printed: 'C', qty: 2, price: 250, sum: 500 },
      { printed: 'D', price: 1_120, sum: 1_120 },
      { printed: 'Шоколад', price: 890, sum: 980 },
      { printed: 'E', price: 1_450, sum: 1_450 },
      { printed: 'F', price: 20, sum: 20 },
    ]
    const confirmed = await review(me, await parsedReceipt(me, lines))
    expect(confirmed.lines[4]?.amount).toEqual(amd(980))
    const unread = await review(me, await parsedReceipt(me, lines, { totalMinor: null }))
    expect(unread.lines[4]?.amount).toEqual(amd(890))
  })

  it('doubts a price one confused digit off the memory’s, and only then names it (В-1)', async () => {
    const me = await insertActor(db)
    const bag = await insertItem(db, { name: 'Пакет-майка', searchKey: 'paket-maika' })
    await memory.remember(me, TIN, [
      { kind: 'sku', key: '1122223', itemId: bag, price: amd(50) },
      { kind: 'sku', key: '1160033', itemId: bag, price: amd(290) },
    ])
    const id = await parsedReceipt(me, [
      { printed: 'Պոլիէթիլենային տոպրակ', sku: '1122223', price: 60, sum: 60 },
      { printed: 'Յոգուրտ', sku: '1160033', price: 310, sum: 310 },
    ])
    const detail = await review(me, id)
    expect(detail.lines.map((line) => line.rememberedPrice)).toEqual([amd(50), null])
  })

  it('names the place by the tax number in the city its address prints, else the person’s', async () => {
    const me = await insertActor(db, { city: 'Гюмри' })
    const gyumri = await insertPlace(db, { name: 'Ереван Сити', city: 'Гюмри', tin: TIN })
    const yerevan = await insertPlace(db, { name: 'Ереван Сити', city: 'Ереван', tin: TIN })
    const here = await parsedReceipt(me, [])
    const there = await parsedReceipt(me, [], { city: 'Ереван' })
    const unknown = await parsedReceipt(me, [], { tin: '57424557' })
    const unread = await parsedReceipt(me, [], { tin: null })

    expect((await review(me, here)).receipt.place).toEqual({
      id: gyumri,
      name: 'Ереван Сити',
      city: 'Гюмри',
      tin: TIN,
    })
    expect((await review(me, there)).receipt.place?.id).toBe(yerevan)
    expect((await review(me, unknown)).receipt.place).toBeNull()
    expect((await review(me, unread)).receipt.place).toBeNull()

    const cookie = await signIn(db, me)
    const list = receiptsResponseCodec.parse(
      (await app.inject({ method: 'GET', url: '/receipts', headers: { cookie } })).json(),
    )
    expect(new Map(list.receipts.map((r) => [r.id, r.place?.id ?? null]))).toEqual(
      new Map([
        [here, gyumri],
        [there, yerevan],
        [unknown, null],
        [unread, null],
      ]),
    )
  })

  it('names the same receipt recorded before while its purchases are there (Т-11)', async () => {
    const me = await insertActor(db)
    const stranger = await insertActor(db)
    const place = await insertPlace(db, { tin: TIN })
    const trip = await insertTrip(db, { actorId: me, placeId: place })
    const first = await parsedReceipt(me, [], {
      status: 'recorded',
      recordedAt: new Date('2026-09-26T17:00:00Z'),
      tripId: trip,
    })
    const again = await parsedReceipt(me, [])
    const theirs = await parsedReceipt(stranger, [])
    const another = await parsedReceipt(me, [], { receiptNo: '21410812' })

    expect((await review(me, again)).duplicateOf).toEqual({
      receiptId: first,
      tripId: trip,
      recordedAt: new Date('2026-09-26T17:00:00.000Z'),
    })
    expect((await review(me, first)).receipt).toMatchObject({ tripId: trip, place: { id: place } })
    expect((await review(stranger, theirs)).duplicateOf).toBeNull()
    expect((await review(me, another)).duplicateOf).toBeNull()

    await db.update(tripsTable).set({ deletedAt: new Date() }).where(eq(tripsTable.id, trip))
    expect((await review(me, again)).duplicateOf).toBeNull()
  })

  it('gives the official rate of the receipt’s day, from the income currency', async () => {
    const me = await insertActor(db, { incomeCurrency: 'RUB' })
    await db.insert(officialRates).values([
      { provider: 'cba', currency: 'RUB', rateDate: '2026-09-25', scaled: 4_241_700n },
      { provider: 'cba', currency: 'RUB', rateDate: '2026-10-02', scaled: 4_620_000n },
    ])
    const detail = await review(me, await parsedReceipt(me, []))
    expect(detail.rate).toMatchObject({ base: 'RUB', quote: 'AMD', source: 'official' })
    // the rate of 25 September — the receipt's day is the 26th — not the newer one of 2 October
    expect(detail.rate?.asOf.getTime()).toBe(new Date('2026-09-25T00:00:00+04:00').getTime())
  })
})
