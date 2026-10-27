import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  RECEIPT_CASHBACK_HEADER,
  RECEIPT_PAID_BY_HEADER,
  RECEIPT_PACK_HEADER,
  RECEIPT_REPAIRED_HEADER,
  RECEIPT_SPELLED_HEADER,
  receiptDetailCodec,
  receiptsResponseCodec,
  storeMemoryWords,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import {
  actors,
  items,
  officialRates,
  receiptLines,
  receipts,
  trips as tripsTable,
} from '@/db/schema'
import { createStoreMemoryRepository, memoryKey } from '@/db/store-memory-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

// The 3 tests here past half a second on CI carry a timeout of 10 s: the slowest took 926 ms there
// (MOL-266). Ten times that, rounded up to 5 s, so the time reporter names one only on a run slower
// than any yet seen.

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

/** A receipt of the seller recorded at a place: what names the place of its tax number. */
async function recordedAt(actorId: string, placeId: string, at = new Date()): Promise<string> {
  const trip = await insertTrip(db, { actorId, placeId })
  await parsedReceipt(actorId, [], { status: 'recorded', recordedAt: at, tripId: trip })
  return trip
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
      (await memory.recall(actorId, TIN, [milkWord], 'AMD')).get(memoryKey(milkWord))?.itemId

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
    // the lower median of the winning item's prices: 370 and 380
    expect(
      (await memory.recall(newcomer, TIN, [milkWord], 'AMD')).get(memoryKey(milkWord))?.sharedPrice,
    ).toEqual(amd(370))

    // erased, the word stays without its author and still counts
    await db.delete(actors).where(eq(actors.id, me))
    expect(await recall(newcomer)).toBe(full)
    expect(await recall(wife)).toBe(light)
  }, 10_000)

  it('rewrites a person’s own word, and knows nothing at another seller', async () => {
    const me = await insertActor(db)
    const full = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3,2%' })
    const light = await insertItem(db, { name: 'Молоко 2,5%', searchKey: 'moloko 2,5%' })
    await memory.remember(me, TIN, [{ ...milkWord, itemId: full, price: null }])
    await memory.remember(me, TIN, [{ ...milkWord, itemId: light, price: amd(390) }])
    expect((await memory.recall(me, TIN, [milkWord], 'AMD')).get(memoryKey(milkWord))).toEqual({
      itemId: light,
      own: true,
      ownPrice: amd(390),
      priced: 1,
      sharedPrice: amd(390),
    })
    expect((await memory.recall(me, '57424557', [milkWord], 'AMD')).size).toBe(0)
    expect(await memory.recall(me, TIN, [], 'AMD')).toEqual(new Map())
    // a price of another currency is never in one median with the receipt's (review 15)
    expect(
      (await memory.recall(me, TIN, [milkWord], 'RUB')).get(memoryKey(milkWord))?.sharedPrice,
    ).toBeNull()
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

  it('confirms the printed sum by the total less what a card sent to the card, and tells the phone that asks (MOL-289)', async () => {
    const me = await insertActor(db)
    const lines: Line[] = [
      { printed: 'A', price: 531, sum: 531 },
      { printed: 'Шоколад', price: 890, sum: 980 },
    ]
    // 1 511 of lines, 15,11 sent to the card: «Ընդամենը» 1 526,11
    const carded = { totalMinor: 152_611n, cashbackMinor: 1_511n, redeemedMinor: 10_000n }
    const id = await parsedReceipt(me, lines, carded)
    const shown = await review(me, id)
    expect(shown.lines[1]?.amount).toEqual(amd(980))
    // an earlier build, which knows no cashback, is told what the lines come to (review round 1, А4)
    expect([shown.receipt.total, shown.cashback, shown.redeemed]).toEqual([
      { minor: 151_100n, currency: 'AMD' },
      undefined,
      undefined,
    ])
    // the same total with nothing sent to the card: the lines fall short of it, and the figures stand
    const plain = await review(me, await parsedReceipt(me, lines, { totalMinor: 152_611n }))
    expect(plain.lines[1]?.amount).toEqual(amd(890))
    // an installed app of an earlier build reads the detail strictly: only a phone that asks is told
    const response = await app.inject({
      method: 'GET',
      url: `/receipts/${id}`,
      headers: {
        cookie: await signIn(db, me),
        'x-molvia-today': '2026-10-03',
        [RECEIPT_CASHBACK_HEADER]: '1',
      },
    })
    const asked = receiptDetailCodec.parse(response.json())
    expect([asked.cashback, asked.redeemed]).toEqual([amd(15.11), amd(100)])
    expect(asked.receipt.total).toEqual({ minor: 152_611n, currency: 'AMD' })
  })

  it('tells how the receipt was paid only to a phone that asks (MOL-312)', async () => {
    const me = await insertActor(db)
    const lines: Line[] = [{ printed: 'A', price: 531, sum: 531 }]
    const card = await parsedReceipt(me, lines, { paidBy: 'card' })
    // an installed app of an earlier build reads the detail strictly
    expect((await review(me, card)).paidBy).toBeUndefined()
    const asked = async (id: string) =>
      receiptDetailCodec.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/receipts/${id}`,
            headers: {
              cookie: await signIn(db, me),
              'x-molvia-today': '2026-10-03',
              [RECEIPT_PAID_BY_HEADER]: '1',
            },
          })
        ).json(),
      ).paidBy
    expect(await asked(card)).toBe('card')
    // a receipt that does not say, or one read before, says nothing
    expect(await asked(await parsedReceipt(me, lines))).toBeNull()
  })

  it('tells a line the font’s swaps put right only to a phone that asks (MOL-290)', async () => {
    const me = await insertActor(db)
    const id = await parsedReceipt(me, [
      { printed: 'A', price: 531, sum: 531 },
      { printed: 'B', price: 1_032, sum: 1_032 },
    ])
    await db
      .update(receiptLines)
      .set({ repaired: true })
      .where(and(eq(receiptLines.receiptId, id), eq(receiptLines.position, 1)))
    // «Покупки» ask to check it, as a line that does not add up (review round 1, №2)
    const cookie = await signIn(db, me)
    const listed = receiptsResponseCodec.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/receipts',
          headers: { cookie, 'x-molvia-today': '2026-10-03' },
        })
      ).json(),
    )
    expect(listed.receipts.find((one) => one.id === id)?.unsettled).toBe(1)
    // an earlier build cannot say «проверьте»: the line goes to it empty (review round 1, А4)
    const earlier = await review(me, id)
    expect(earlier.lines.map((line) => [line.repaired, line.sum, line.amount])).toEqual([
      [undefined, amd(531), amd(531)],
      [undefined, null, null],
    ])
    const response = await app.inject({
      method: 'GET',
      url: `/receipts/${id}`,
      headers: {
        cookie: await signIn(db, me),
        'x-molvia-today': '2026-10-03',
        [RECEIPT_REPAIRED_HEADER]: '1',
      },
    })
    const asked = receiptDetailCodec.parse(response.json())
    expect(asked.lines.map((line) => [line.repaired, line.sum])).toEqual([
      [undefined, amd(531)],
      [true, amd(1_032)],
    ])
  })

  it('sends a new item the binding marked «проверьте» as such, and a line whose item is gone as new (MOL-293, А6)', async () => {
    const me = await insertActor(db)
    const gone = await insertItem(db, { name: 'Сметана', searchKey: 'smetana' })
    const id = await parsedReceipt(me, [
      { printed: 'Յոգուրտ «Երեմյան Փրոդաքթս» ելակ', price: 300, sum: 300, match: 'weak' },
      { printed: 'Թթվասեր 20%', price: 500, sum: 500, itemId: gone, match: 'search' },
      { printed: 'ՔՍՅԶՔ', price: 100, sum: 100, match: 'new' },
    ])
    await db.delete(items).where(eq(items.id, gone))
    const detail = await review(me, id)
    expect(detail.lines.map((line) => [line.itemId, line.match])).toEqual([
      [null, 'weak'],
      [null, 'new'],
      [null, 'new'],
    ])
  })

  it('tells a new name spelt in letters only to a phone that asks, and only while it is new (MOL-293)', async () => {
    const me = await insertActor(db)
    const coffee = await insertItem(db, { name: 'Кофе «Латино»', searchKey: 'kofe latino' })
    const id = await parsedReceipt(me, [
      { printed: 'Սուրճ «Լատինո» Մեդիում', sku: '1170001', price: 900, sum: 900, match: 'weak' },
      { printed: 'Սուրճ «Լատինո» Ռոբուստա', sku: '1170002', price: 950, sum: 950, match: 'weak' },
    ])
    await db
      .update(receiptLines)
      .set({ translation: 'Кофе «Латино» Медиум', spelled: true })
      .where(and(eq(receiptLines.receiptId, id), eq(receiptLines.position, 0)))
    await db
      .update(receiptLines)
      .set({ translation: 'Кофе «Латино» Робуста', spelled: true })
      .where(and(eq(receiptLines.receiptId, id), eq(receiptLines.position, 1)))
    // the shop's memory has named the second since: its name is no proposal any more
    await memory.remember(me, TIN, [
      { kind: 'sku', key: '1170002', itemId: coffee, price: amd(950) },
    ])
    // an earlier build reads a line strictly: it is told nothing
    const earlier = await review(me, id)
    expect(earlier.lines.map((line) => line.spelled)).toEqual([undefined, undefined])
    const response = await app.inject({
      method: 'GET',
      url: `/receipts/${id}`,
      headers: {
        cookie: await signIn(db, me),
        'x-molvia-today': '2026-10-03',
        [RECEIPT_SPELLED_HEADER]: '1',
      },
    })
    const asked = receiptDetailCodec.parse(response.json())
    expect(asked.lines.map((line) => [line.itemId, line.translation, line.spelled])).toEqual([
      [null, 'Кофе «Латино» Медиум', true],
      [coffee, 'Кофе «Латино» Робуста', undefined],
    ])
  })

  it('tells a line’s package only to a phone that asks, of a line the till sold in pieces (MOL-264)', async () => {
    const me = await insertActor(db)
    const id = await parsedReceipt(me, [
      { printed: 'Գազավորված ըմպելիք «Կոկա Կոլա» 1.5լ', sku: '1170010', price: 700, sum: 700 },
      { printed: 'Կաթ «Իգիթ» 3.2% 1լ', sku: '1170011', qty: 2, price: 370, sum: 740 },
      { printed: 'Հավկիթ «Ոսկեհավ» #0-1 10հտ', sku: '1170012', price: 850, sum: 850 },
      { printed: 'Սերուցք «Իգիթ» 10%', sku: '1170013', price: 600, sum: 600 },
      { printed: 'Ազնվամորու Մուրաբա 1կգ', sku: '1170014', price: 2_000, sum: 868 },
      { printed: 'Պանիր «Լոռի» 500գր', sku: '1170015', price: 900, sum: 900 },
    ])
    // the jam the till weighed — 0,434 kg — and the cheese the check emptied keep no package
    await db
      .update(receiptLines)
      .set({ qtyMilli: 434n, qtyUnit: 'kg' })
      .where(and(eq(receiptLines.receiptId, id), eq(receiptLines.position, 4)))
    await db
      .update(receiptLines)
      .set({ qtyMilli: null, qtyUnit: null, priceMinor: null, sumMinor: null, settled: false })
      .where(and(eq(receiptLines.receiptId, id), eq(receiptLines.position, 5)))
    // an earlier build reads a line strictly: it is told nothing, and its figures are the till's
    const earlier = await review(me, id)
    expect(earlier.lines.map((line) => line.pack)).toEqual(Array(6).fill(undefined))
    const response = await app.inject({
      method: 'GET',
      url: `/receipts/${id}`,
      headers: {
        cookie: await signIn(db, me),
        'x-molvia-today': '2026-10-03',
        [RECEIPT_PACK_HEADER]: '1',
      },
    })
    const asked = receiptDetailCodec.parse(response.json())
    expect(asked.lines.map((line) => line.pack)).toEqual([
      { milli: 1_500n, unit: 'l' },
      { milli: 1_000n, unit: 'l' },
      { milli: 10_000n, unit: 'piece' },
      undefined,
      undefined,
      undefined,
    ])
    // the till's own figures stay as printed
    expect(asked.lines[1]?.quantity).toEqual({ milli: 2_000n, unit: 'piece' })
  }, 10_000)

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

  // В6 of the adversarial review: a shelf price is someone's figure — the person's own always, other
  // people's only with access and from three people
  it('names another person’s remembered price only with access and from three prices, their lower median', async () => {
    const me = await insertActor(db)
    const bag = await insertItem(db, { name: 'Пакет-майка', searchKey: 'paket-maika' })
    const others = [await insertActor(db), await insertActor(db), await insertActor(db)]
    const word = { kind: 'sku' as const, key: '1122223', itemId: bag, price: amd(50) }
    const doubted = async () =>
      (
        await review(
          me,
          await parsedReceipt(me, [
            { printed: 'Պոլիէթիլենային տոպրակ', sku: '1122223', price: 60, sum: 60 },
          ]),
        )
      ).lines[0]
    await memory.remember(others[0] ?? me, TIN, [word])
    expect((await doubted())?.rememberedPrice).toBeNull()
    expect((await doubted())?.match).toBe('memory')

    // three people for the item, two prices: closed even with access (round 2, Р2-В3)
    await memory.remember(others[1] ?? me, TIN, [word])
    await memory.remember(others[2] ?? me, TIN, [{ ...word, price: null }])
    await db
      .update(actors)
      .set({ sharedUntil: new Date(Date.now() + 86_400_000) })
      .where(eq(actors.id, me))
    expect((await doubted())?.rememberedPrice).toBeNull()

    // three prices — 50, 50, 70: their lower median
    await memory.remember(others[2] ?? me, TIN, [{ ...word, price: amd(70) }])
    expect((await doubted())?.rememberedPrice).toEqual(amd(50))
    // without access, closed again
    await db.update(actors).set({ sharedUntil: null }).where(eq(actors.id, me))
    expect((await doubted())?.rememberedPrice).toBeNull()
  }, 10_000)

  it('names the place by the receipts of its seller recorded in the city its address prints, else the person’s', async () => {
    const me = await insertActor(db, { city: 'Гюмри' })
    const gyumri = await insertPlace(db, { name: 'Ереван Сити', city: 'Гюмри' })
    const yerevan = await insertPlace(db, { name: 'Ереван Сити', city: 'Ереван' })
    await recordedAt(await insertActor(db), gyumri)
    await recordedAt(await insertActor(db), yerevan)
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
  }, 10_000)

  // В4 of the adversarial review: one wrong choice of place named it for everyone, for good
  it('takes one’s own last place, else the place most people chose, and forgets a removed trip', async () => {
    const [me, ann, boris, vera] = [
      await insertActor(db),
      await insertActor(db),
      await insertActor(db),
      await insertActor(db),
    ]
    const sas = await insertPlace(db, { name: 'SAS' })
    const city = await insertPlace(db, { name: 'Ереван Сити' })
    const wrong = await recordedAt(ann, sas, new Date('2026-09-20T10:00:00Z'))
    const suggested = async (actorId: string) =>
      (await review(actorId, await parsedReceipt(actorId, []))).receipt.place?.id ?? null

    expect(await suggested(boris)).toBe(sas)
    await recordedAt(boris, city, new Date('2026-09-21T10:00:00Z'))
    // one to one: the later
    expect(await suggested(vera)).toBe(city)
    await recordedAt(vera, city, new Date('2026-09-22T10:00:00Z'))
    await recordedAt(me, sas, new Date('2026-09-23T10:00:00Z'))
    // two to two, but mine is mine
    expect(await suggested(me)).toBe(sas)

    // Ann's wrong trip removed: her word goes with it
    await db.update(tripsTable).set({ deletedAt: new Date() }).where(eq(tripsTable.id, wrong))
    const newcomer = await insertActor(db)
    expect(await suggested(newcomer)).toBe(city)
  })

  it('names the same receipt recorded before while its purchases are there (Т-11)', async () => {
    const me = await insertActor(db)
    const stranger = await insertActor(db)
    const place = await insertPlace(db)
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
