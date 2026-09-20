import { randomUUID } from 'node:crypto'
import { AGGREGATE_MIN_CONTRIBUTIONS } from '@molvia/model'
import type { Db } from '@/db/index'
import type { PriceQuery } from '@/db/expenses-repository'
import {
  actors,
  events,
  expenses,
  itemBarcodes,
  items,
  officialRates,
  places,
  searchPicks,
  trips,
  verdicts,
} from '@/db/schema'

/**
 * The minimal rows a foreign key demands, so a test states only what it is actually about.
 * Every fixture returns the id it wrote and accepts a patch for the one column under test.
 */
export async function insertActor(
  db: Db,
  patch: Partial<typeof actors.$inferInsert> = {},
): Promise<string> {
  const id = patch.id ?? randomUUID()
  await db.insert(actors).values({
    id,
    country: 'AM',
    city: 'Гюмри',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    ...patch,
  })
  return id
}

export async function insertItem(
  db: Db,
  patch: Partial<typeof items.$inferInsert> = {},
): Promise<string> {
  const id = patch.id ?? randomUUID()
  await db.insert(items).values({
    id,
    kind: 'product',
    name: 'Молоко «Ашхар»',
    searchKey: 'moloko ashar',
    defaultUnit: 'l',
    ...patch,
  })
  return id
}

export async function insertPlace(
  db: Db,
  patch: Partial<typeof places.$inferInsert> = {},
): Promise<string> {
  const id = patch.id ?? randomUUID()
  await db.insert(places).values({
    id,
    kind: 'store',
    name: 'SAS',
    country: 'AM',
    city: 'Гюмри',
    ...patch,
  })
  return id
}

export async function insertTrip(
  db: Db,
  patch: Partial<typeof trips.$inferInsert> & { actorId: string; placeId: string },
): Promise<string> {
  const id = patch.id ?? randomUUID()
  await db.insert(trips).values({ id, currency: 'AMD', ...patch })
  return id
}

/** Deleted child-first: every table here points at the one below it. */
export async function clearAll(db: Db): Promise<void> {
  await db.delete(events)
  await db.delete(officialRates)
  await db.delete(searchPicks)
  await db.delete(verdicts)
  await db.delete(expenses)
  await db.delete(trips)
  await db.delete(itemBarcodes)
  await db.delete(items)
  await db.delete(places)
  await db.delete(actors)
}

/**
 * The price query as it looks before anyone has access to other people's data: this person's
 * own purchases, wherever they were made. The city is there only because the shared mode reads
 * it — in the own mode nothing looks at it.
 */
export function ownPrices(actorId: string, itemIds: readonly string[], limit?: number): PriceQuery {
  return {
    actorId,
    itemIds,
    scope: 'own',
    minBuyers: AGGREGATE_MIN_CONTRIBUTIONS,
    country: 'AM',
    city: 'Гюмри',
    ...(limit === undefined ? {} : { limit }),
  }
}
