import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createRepackRepository } from '@/db/repack-repository'
import { expenses, items, receiptLines, receiptParts, receipts } from '@/db/schema'
import { repackReceipts } from '@/repack-receipts'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, signIn } from './fixtures'

// Each test records a receipt through the API and repacks it twice: 1–2 s on a Mac under the lock, given 30 s.

/**
 * The purchases recorded from receipts before MOL-264 put into the package their line prints (owner's В-3 «а»): only
 * a purchase still in the till's pieces, only an item that very record made, and nothing a second time.
 */
const { db, close } = connectDrizzle()
const repacker = createRepackRepository(db)
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

const LINES = [
  { printed: 'Գազավորված ըմպելիք «Կոկա Կոլա» 1.5լ', sku: '1170010', qty: 1, price: 700 },
  { printed: 'Կաթ «Իգիթ» 3.2% 1լ', sku: '1170011', qty: 2, price: 370 },
  { printed: 'Հավկիթ «Ոսկեհավ» #0-1 10հտ', sku: '1170012', qty: 1, price: 850 },
  { printed: 'Սերուցք «Իգիթ» 10%', sku: '1170013', qty: 1, price: 600 },
  { printed: 'Ֆանտա 0.5լ', sku: '1170014', qty: 1, price: 300 },
  { printed: 'Ջուր «Ջերմուկ» 0.5լ', sku: '1170015', qty: 1, price: 250 },
] as const

/** A receipt recorded as a phone before MOL-264 recorded it: every line in the till's pieces. */
async function recordedInPieces(me: string, fanta: string, quantities?: Record<number, unknown>) {
  const id = randomUUID()
  await db.insert(receipts).values({
    id,
    actorId: me,
    status: 'parsed',
    parts: 1,
    country: 'AM',
    language: 'ru',
    currency: 'AMD',
    capturedAt: new Date('2026-09-26T16:00:00Z'),
    queuedAt: new Date('2026-09-26T16:00:01Z'),
    tin: '01282006',
    printedOn: '2026-09-26',
    printedTime: '19:42',
    receiptNo: randomUUID().slice(0, 8),
    totalMinor: BigInt(LINES.reduce((sum, line) => sum + line.qty * line.price, 0) * 100),
    city: 'Гюмри',
    layout: 'card',
  })
  await db.insert(receiptParts).values({
    receiptId: id,
    position: 1,
    photo: Buffer.from([0xff, 0xd8]),
    width: 800,
    height: 2400,
  })
  await db.insert(receiptLines).values(
    LINES.map((line, position) => ({
      receiptId: id,
      position,
      printed: line.printed,
      sku: line.sku,
      qtyMilli: BigInt(line.qty * 1000),
      qtyUnit: 'piece' as const,
      priceMinor: BigInt(line.price * 100),
      sumMinor: BigInt(line.qty * line.price * 100),
      discountMinor: 0n,
      settled: true,
      match: 'new' as const,
    })),
  )
  const names = ['Coca-Cola', 'Молоко «Игит» 3,2%', 'Яйца «Воскеат»', 'Сливки «Игит» 10%']
  const response = await app.inject({
    method: 'POST',
    url: `/receipts/${id}/record`,
    headers: { cookie: await signIn(db, me), 'x-molvia-today': '2026-10-03' },
    payload: {
      tripId: randomUUID(),
      place: { id: await insertPlace(db) },
      purchasedOn: '2026-09-26',
      lines: LINES.map((line, position) => ({
        position,
        skip: false,
        // the Fanta is an item of the catalogue, made by nobody's record
        item: position === 4 ? { id: fanta } : { name: names[position] ?? 'Вода «Джермук»' },
        quantity: quantities?.[position] ?? { value: String(line.qty), unit: 'piece' },
        amount: { amount: String(line.qty * line.price), currency: 'AMD' },
      })),
    },
  })
  expect(response.statusCode).toBe(200)
}

const bought = () =>
  db
    .select({ name: items.name, milli: expenses.qtyMilli, unit: expenses.qtyUnit })
    .from(expenses)
    .innerJoin(items, eq(items.id, expenses.itemId))
    .orderBy(asc(items.name))
const made = () =>
  db
    .select({ name: items.name, unit: items.defaultUnit, typical: items.typicalQtyMilli })
    .from(items)
    .orderBy(asc(items.name))

describe('repack-receipts (MOL-264, В-3 «а»)', () => {
  it('changes nothing on a dry run, and says every purchase and item it would', async () => {
    const me = await insertActor(db)
    const fanta = await insertItem(db, { name: 'Fanta', searchKey: 'fanta', defaultUnit: 'piece' })
    await recordedInPieces(me, fanta)
    const before = { bought: await bought(), made: await made() }
    const out: string[] = []
    expect(await repackReceipts([], repacker, (line) => out.push(line))).toBe(0)
    expect({ bought: await bought(), made: await made() }).toEqual(before)
    expect(out[0]).toBe('  purchases   5')
    expect(out).toContain('    Coca-Cola: piece → l, usually 1,5 l')
    expect(out.at(-1)).toBe('dry run: nothing changed. Run again with --yes to write.')
  }, 30_000)

  it('puts the purchases in pieces into their packages, and the items that record made', async () => {
    const me = await insertActor(db)
    const fanta = await insertItem(db, { name: 'Fanta', searchKey: 'fanta', defaultUnit: 'piece' })
    // the person typed the water's quantity themselves: 2 l, not the till's piece — theirs stays
    await recordedInPieces(me, fanta, { 5: { value: '2', unit: 'l' } })
    expect(await repackReceipts(['--yes'], repacker, () => undefined)).toBe(0)
    expect(await bought()).toEqual([
      { name: 'Coca-Cola', milli: 1_500n, unit: 'l' },
      { name: 'Fanta', milli: 500n, unit: 'l' },
      { name: 'Вода «Джермук»', milli: 2_000n, unit: 'l' },
      { name: 'Молоко «Игит» 3,2%', milli: 2_000n, unit: 'l' },
      { name: 'Сливки «Игит» 10%', milli: 1_000n, unit: 'piece' },
      { name: 'Яйца «Воскеат»', milli: 10_000n, unit: 'piece' },
    ])
    expect(await made()).toEqual([
      { name: 'Coca-Cola', unit: 'l', typical: 1_500n },
      // made by nobody's record: the catalogue's own stays as it is
      { name: 'Fanta', unit: 'piece', typical: null },
      // made in litres by the person's own quantity, its package by the record itself: nothing to put right
      { name: 'Вода «Джермук»', unit: 'l', typical: 500n },
      { name: 'Молоко «Игит» 3,2%', unit: 'l', typical: 1_000n },
      { name: 'Сливки «Игит» 10%', unit: 'piece', typical: null },
      { name: 'Яйца «Воскеат»', unit: 'piece', typical: 10_000n },
    ])
    // a second run finds nothing
    const out: string[] = []
    expect(await repackReceipts(['--yes'], repacker, (line) => out.push(line))).toBe(0)
    expect(out.slice(0, 1)).toEqual(['  purchases   0'])
    expect(out).toContain('  items       0')
  }, 30_000)

  it('refuses any word but --yes', async () => {
    const out: string[] = []
    expect(await repackReceipts(['--yes', 'now'], repacker, (line) => out.push(line))).toBe(2)
    expect(out).toEqual(['usage: repack-receipts [--yes]'])
  })
})
