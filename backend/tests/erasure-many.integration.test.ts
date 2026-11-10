import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createErasureRepository } from '@/db/erasure-repository'
import { connectDrizzle } from './db'
import { clearAll, insertActor, telegramId } from './fixtures'

// A file of its own: 33 000 items are a catalogue's worth, and clearing them after the other tests of
// erasure took past a hook's 10 s on that connection, while on a fresh one it takes about 1.5 s. Its
// hooks carry a limit of their own for the same reason (MOL-243).

const { db, close } = connectDrizzle()
const erasure = createErasureRepository(db)

beforeAll(() => clearAll(db), 60_000)
afterAll(async () => {
  await clearAll(db)
  await close()
}, 60_000)

describe('стирание того, у кого товаров больше, чем параметров у оператора (MOL-374)', () => {
  // Adversarial Р4-А15: a list of ids spelt a parameter an id passed the 65 534 of a statement, and a
  // person with 32 767 items to go could not be erased by anything.
  it('стирает того, у кого больше 32 767 товаров', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    await db.execute(sql`
      insert into items (id, kind, name, search_key, default_unit, created_by)
      select gen_random_uuid(), 'product', 'Спам ' || g, 'spam ' || g, 'piece', ${anna}::uuid
      from generate_series(1, 33000) g`)

    const report = await erasure.erase(tg, { dryRun: false })
    expect(report).toMatchObject({ found: true, itemsLeaving: 33000 })
    expect(report.leavingItems).toHaveLength(33000)

    // The sweep of the whole list — `make forget --yes`'s, a door's own being cut (Р5-А16) — goes a
    // batch's worth at a time, so the list never reaches a statement (review 5, №20): some 6 s on a Mac.
    expect(await erasure.sweepReleased(report.leavingItems)).toBe(33000)
    const [left] = await db.execute<{ n: number }>(sql`select count(*)::int as n from items`)
    expect(left?.n).toBe(0)
  }, 180_000)
})
