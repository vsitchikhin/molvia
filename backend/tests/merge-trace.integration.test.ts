/**
 * The trace of a merge (MOL-106) on every path that writes by an item's or a place's id: an id from
 * before the merge — a purchase queued on a phone, a bot's button, a receipt's draft — lands on the
 * survivor, and a name of the trace typed again is the survivor.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createItemRepository } from '@/db/items-repository'
import { createPlaceRepository } from '@/db/places-repository'
import { createSearchPickRepository } from '@/db/search-picks-repository'
import { createStoreMemoryRepository } from '@/db/store-memory-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'
import {
  expenses,
  itemBarcodes,
  items,
  places,
  searchPicks,
  storeMemory,
  verdicts,
} from '@/db/schema'
import { rateItem } from '@/usecases/rate-item'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip } from './fixtures'

const { db, close } = connectDrizzle()
const itemRepo = createItemRepository(db)
const verdictRepo = createVerdictRepository(db)

let owner: string
let survivor: string
let trace: string

beforeEach(async () => {
  await clearAll(db)
  owner = await insertActor(db)
  survivor = await insertItem(db, { name: 'Молоко 3,2%', searchKey: 'moloko 3 2' })
  trace = await insertItem(db, { name: 'Малоко 3,2%', searchKey: 'maloko 3 2' })
  await db.update(items).set({ mergedInto: survivor }).where(eq(items.id, trace))
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('an item by the id of a trace', () => {
  it('is read as the survivor', async () => {
    expect((await itemRepo.byId(trace))?.id).toBe(survivor)
  })

  it('is rated as the survivor, amended and withdrawn by the old id', async () => {
    const { verdict } = await rateItem({ items: itemRepo, verdicts: verdictRepo }, owner, trace, {
      score: 4,
    })
    expect(verdict.itemId).toBe(survivor)
    expect((await verdictRepo.amend(owner, trace, { score: 5 }))?.score).toBe(5)
    expect(await verdictRepo.withdraw(owner, trace)).toBe(true)
    const rows = await db.select().from(verdicts).where(eq(verdicts.actorId, owner))
    expect(rows.map((row) => [row.itemId, row.deletedAt !== null])).toEqual([[survivor, true]])
  })

  it('is bought as the survivor, and a repeat sent by the old id is the same purchase', async () => {
    const placeId = await insertPlace(db)
    const tripId = await insertTrip(db, { actorId: owner, placeId })
    const repo = createExpenseRepository(db)
    const id = randomUUID()
    const first = await repo.add(owner, { id, tripId, itemId: trace })
    expect([first.created, first.expense.itemId]).toEqual([true, survivor])
    const again = await repo.add(owner, { id, tripId, itemId: trace })
    expect([again.created, again.expense.itemId]).toEqual([false, survivor])
    const rows = await db.select().from(expenses)
    expect(rows.map((row) => row.itemId)).toEqual([survivor])
  })

  it('is remembered as the survivor’s pick', async () => {
    await createSearchPickRepository(db).remember(owner, 'малоко', trace)
    const rows = await db.select().from(searchPicks)
    expect(rows.map((row) => row.itemId)).toEqual([survivor])
  })

  it('takes a code as the survivor, and lets it go by the old id', async () => {
    const attached = await itemRepo.attachBarcode(trace, '4600000000003', owner)
    expect(attached && 'item' in attached ? attached.item.id : null).toBe(survivor)
    expect(await itemRepo.detachBarcode(trace, '4600000000003')).toBe(true)
    expect(await db.select().from(itemBarcodes)).toEqual([])
  })

  it('is the survivor in the shop’s memory', async () => {
    await createStoreMemoryRepository(db).remember(owner, '01282006', [
      { kind: 'sku', key: '1163909', itemId: trace, price: null },
    ])
    const rows = await db.select().from(storeMemory)
    expect(rows.map((row) => row.itemId)).toEqual([survivor])
  })

  it('is not an item a receipt line is matched to', async () => {
    await db.execute(
      `insert into item_names (item_id, language, name) values ('${trace}', 'hy', 'կաթ')`,
    )
    expect((await itemRepo.nodes('hy')).map((node) => node.itemId)).toEqual([])
  })
})

describe('the name of a trace', () => {
  it('proposed again is the survivor, never a second twin', async () => {
    const proposal = await itemRepo.createUnlessNamed(
      { kind: 'product', name: 'малоко 3,2%', barcodes: [], defaultUnit: 'l' },
      owner,
    )
    expect('item' in proposal ? [proposal.item.id, proposal.created] : null).toEqual([
      survivor,
      false,
    ])
    expect(await db.select({ id: items.id }).from(items)).toHaveLength(2)
  })
})

describe('a place by the id or the name of a trace', () => {
  it('is the survivor', async () => {
    const kept = await insertPlace(db, { name: 'Ереван Сити' })
    const merged = await insertPlace(db, { name: 'Ереван  Сити' })
    await db.update(places).set({ mergedInto: kept }).where(eq(places.id, merged))
    const repo = createPlaceRepository(db)
    expect((await repo.byId(merged))?.id).toBe(kept)
    const typed = await repo.ensure({
      kind: 'store',
      name: 'Ереван  Сити',
      country: 'AM',
      city: 'Гюмри',
    })
    expect(typed.id).toBe(kept)
    const left = await db
      .select()
      .from(places)
      .where(and(eq(places.kind, 'store'), eq(places.city, 'Гюмри')))
    expect(left).toHaveLength(2)
  })
})

describe('the search', () => {
  const names = async (query: string) =>
    (await itemRepo.search(query, 20, owner, null)).items.map((item) => item.id)

  it('finds the survivor by the trace’s name, its second name', async () => {
    expect(await names('малоко 3,2%')).toEqual([survivor])
  })

  it('answers the survivor once when both names are found', async () => {
    expect(await names('молоко')).toEqual([survivor])
  })

  it('gives the twin’s row to the next item, never leaves it empty', async () => {
    const other = await insertItem(db, { name: 'Молоко топлёное', searchKey: 'moloko toplenoe' })
    expect(await names('молоко')).toEqual([survivor, other])
    expect((await itemRepo.search('молоко', 2, owner, null)).items.map((item) => item.id)).toEqual([
      survivor,
      other,
    ])
  })
})
