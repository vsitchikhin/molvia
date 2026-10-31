import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { RECEIPT_MODEL, toSearchKey } from '@molvia/model'
import { createItemRepository } from '@/db/items-repository'
import { createRenameRepository } from '@/db/rename-repository'
import { itemEmbeddings, items, receiptLines, receiptParts, receipts } from '@/db/schema'
import { renameReceiptItems } from '@/rename-receipt-items'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, signIn } from './fixtures'

// Each test records a receipt through the API and renames twice: 1–2 s on a Mac under the lock, given 30 s.

/**
 * The items recorded from receipts before MOL-261 named as a line names them now (owner's В-3 «а»): only an item that
 * very record made under the line's proposal, a name another item holds left alone, nothing a second time.
 */
const { db, close } = connectDrizzle()
const catalogue = createItemRepository(db)
const deps = {
  renamer: createRenameRepository(db),
  nodes: (language: 'hy') => catalogue.nodes(language),
}
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

/** Each line as printed, what the review proposed before MOL-261, and the name the record gave its item. */
const LINES = [
  {
    printed: 'Գազավորված ըմպելիք «Կոկա Կոլա» 1.5լ',
    proposed: 'Напиток газированный «Кока Кола» 1,5 л',
    named: 'Напиток газированный «Кока Кола» 1,5 л',
  },
  {
    printed: 'Աղ մանր «Ֆավորիտ» 1կգ',
    proposed: 'Соль мелкий «Фаворит» 1 кг',
    named: 'Соль мелкий «Фаворит» 1 кг',
  },
  // the person typed a name of their own over the proposal: theirs stays
  { printed: 'Սերուցք «Իգիթ» 10%', proposed: 'Сливки «Игит» ультра 10%', named: 'Сливки Игит' },
  // the name the line proposes now is another item's already
  {
    printed: 'Խտացրած կաթ «Ալեքսեևսկոյե» 360գր',
    proposed: 'Молоко сгущённый «Алексеевскойе» 360 г',
    named: 'Молоко сгущённый «Алексеевскойе» 360 г',
  },
  // an item of the catalogue, made by nobody's record
  { printed: 'Ֆանտա 0.5լ', proposed: 'Фанта 0,5 л', named: null },
] as const

interface Line {
  readonly printed: string
  readonly proposed: string
  readonly named: string | null
}

async function recorded(
  me: string,
  fanta: string,
  lines: readonly Line[] = LINES,
  readerVersion: string | null = null,
): Promise<void> {
  const id = randomUUID()
  await db.insert(receipts).values({
    id,
    actorId: me,
    readerVersion,
    status: 'parsed',
    parts: 1,
    country: 'AM',
    language: 'ru',
    currency: 'AMD',
    capturedAt: new Date('2026-10-20T16:00:00Z'),
    queuedAt: new Date('2026-10-20T16:00:01Z'),
    tin: '01282006',
    printedOn: '2026-10-20',
    printedTime: '19:42',
    receiptNo: randomUUID().slice(0, 8),
    totalMinor: BigInt(lines.length * 50_000),
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
    lines.map((line, position) => ({
      receiptId: id,
      position,
      printed: line.printed,
      sku: `11700${String(position)}`,
      qtyMilli: 1000n,
      qtyUnit: 'piece' as const,
      priceMinor: 50_000n,
      sumMinor: 50_000n,
      discountMinor: 0n,
      settled: true,
      match: 'weak' as const,
      translation: line.proposed,
    })),
  )
  const response = await app.inject({
    method: 'POST',
    url: `/receipts/${id}/record`,
    headers: { cookie: await signIn(db, me), 'x-molvia-today': '2026-10-26' },
    payload: {
      tripId: randomUUID(),
      // a place of each record: two records of one shop would be one place
      place: { id: await insertPlace(db, { name: `SAS ${id.slice(0, 4)}` }) },
      purchasedOn: '2026-10-20',
      lines: lines.map((line, position) => ({
        position,
        skip: false,
        item: line.named === null ? { id: fanta } : { name: line.named },
        quantity: { value: '1', unit: 'piece' },
        amount: { amount: '500', currency: 'AMD' },
      })),
    },
  })
  expect(response.statusCode).toBe(200)
}

const names = async () =>
  (await db.select({ name: items.name }).from(items).orderBy(asc(items.name))).map(
    (row) => row.name,
  )

async function prepared(): Promise<void> {
  const me = await insertActor(db)
  const fanta = await insertItem(db, { name: 'Фанта', searchKey: toSearchKey('Фанта') })
  const condensed = 'Молоко сгущённое «Алексеевское» 360 г'
  await insertItem(db, { name: condensed, searchKey: toSearchKey(condensed) })
  await recorded(me, fanta)
}

describe('rename-receipt-items (MOL-261, В-3 «а»)', () => {
  it('changes nothing on a dry run, and says every item it would', async () => {
    await prepared()
    const before = await names()
    const out: string[] = []
    expect(await renameReceiptItems([], deps, (line) => out.push(line))).toBe(0)
    expect(await names()).toEqual(before)
    expect(out).toEqual([
      '  renamed     2',
      '    Напиток газированный «Кока Кола» 1,5 л → Напиток газированный Coca-Cola 1,5 л',
      '    Соль мелкий «Фаворит» 1 кг → Соль мелкая «Фаворит» 1 кг',
      '  taken       1',
      '    Молоко сгущённый «Алексеевскойе» 360 г → Молоко сгущённое «Алексеевское» 360 г: another item holds the name',
      'dry run: nothing changed. Run again with --yes to write.',
    ])
  }, 30_000)

  it('renames the items that record made under the proposal, their key with them, and nothing twice', async () => {
    await prepared()
    const [salt] = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.name, 'Соль мелкий «Фаворит» 1 кг'))
    if (salt === undefined) throw new Error('no salt')
    await db
      .insert(itemEmbeddings)
      .values({ itemId: salt.id, model: 'test', embedding: Array<number>(768).fill(0.1) })

    expect(await renameReceiptItems(['--yes'], deps, () => undefined)).toBe(0)
    expect(await names()).toEqual([
      'Молоко сгущённое «Алексеевское» 360 г',
      'Молоко сгущённый «Алексеевскойе» 360 г',
      'Напиток газированный Coca-Cola 1,5 л',
      'Сливки Игит',
      'Соль мелкая «Фаворит» 1 кг',
      'Фанта',
    ])
    const [renamed] = await db
      .select({ key: items.searchKey })
      .from(items)
      .where(eq(items.id, salt.id))
    expect(renamed?.key).toBe(toSearchKey('Соль мелкая «Фаворит» 1 кг'))
    // its vector of the old name goes, for the API's writer to make again
    expect(
      await db.select().from(itemEmbeddings).where(eq(itemEmbeddings.itemId, salt.id)),
    ).toEqual([])

    const out: string[] = []
    expect(await renameReceiptItems(['--yes'], deps, (line) => out.push(line))).toBe(0)
    expect(out.slice(0, 1)).toEqual(['  renamed     0'])
  }, 30_000)

  it('reads a line the model read as the queue does, a word it misread put right (MOL-326)', async () => {
    const me = await insertActor(db)
    const fanta = await insertItem(db, { name: 'Фанта', searchKey: toSearchKey('Фанта') })
    const misread = [
      { printed: 'Ցաքարավազ 1կգ', proposed: 'Цакараваз 1 кг', named: 'Цакараваз 1 кг' },
    ]
    await recorded(me, fanta, misread, `${RECEIPT_MODEL}@v5`)
    // Tesseract misreads otherwise: its line stays as read
    const byTesseract = [
      { printed: 'Ցաքարավազ 2կգ', proposed: 'Цакараваз 2 кг', named: 'Цакараваз 2 кг' },
    ]
    await recorded(me, fanta, byTesseract, 'tesseract-5.5')

    const out: string[] = []
    expect(await renameReceiptItems([], deps, (line) => out.push(line))).toBe(0)
    expect(out.slice(0, 2)).toEqual(['  renamed     1', '    Цакараваз 1 кг → Сахар-песок 1 кг'])
  }, 30_000)

  it('refuses any word but --yes', async () => {
    const out: string[] = []
    expect(await renameReceiptItems(['--yes', 'now'], deps, (line) => out.push(line))).toBe(2)
    expect(out).toEqual(['usage: rename-receipt-items [--yes]'])
  })
})
