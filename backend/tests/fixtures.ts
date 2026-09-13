import { randomUUID } from 'node:crypto'
import type { Db } from '@/db/index'
import { actors } from '@/db/schema'

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
