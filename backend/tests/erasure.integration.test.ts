import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ACTOR_REFERENCES, createErasureRepository } from '@/db/erasure-repository'
import {
  actors,
  events,
  expenses,
  items,
  loginRequests,
  places,
  searchPicks,
  verdicts,
} from '@/db/schema'
import { connectDrizzle } from './db'
import {
  clearAll,
  insertActor,
  insertItem,
  insertLoginRequest,
  insertPlace,
  insertSession,
  insertTrip,
  telegramId,
} from './fixtures'

const { db, close } = connectDrizzle()
const erasure = createErasureRepository(db)

afterAll(close)
beforeEach(() => clearAll(db))

/** Everything a person leaves behind in 0.1, each table touched at least once. */
async function aLife(
  actorId: string,
  telegramUserId: number,
  shared: { itemId: string; placeId: string },
) {
  const ownItem = await insertItem(db, {
    name: 'Рынок-сыр',
    searchKey: 'rinok sir',
    createdBy: actorId,
  })
  const tripId = await insertTrip(db, { actorId, placeId: shared.placeId })
  await db.insert(expenses).values([
    { id: randomUUID(), tripId, itemId: shared.itemId },
    { id: randomUUID(), tripId, itemId: ownItem },
  ])
  await db.insert(verdicts).values([
    {
      id: randomUUID(),
      actorId,
      itemId: shared.itemId,
      itemKind: 'product',
      score: 5,
      review: 'Вкусно',
    },
    // Withdrawn: the gate keeps it, erasure must not.
    {
      id: randomUUID(),
      actorId,
      itemId: ownItem,
      itemKind: 'product',
      score: 1,
      ratedAt: new Date(Date.now() - 60_000),
      deletedAt: new Date(),
    },
  ])
  await db.insert(searchPicks).values({ actorId, queryKey: 'moloko', itemId: shared.itemId })
  await db
    .insert(events)
    .values({ actorId, type: 'advice_viewed', payload: { subject: 'product' } })
  await insertSession(db, { actorId })
  await insertLoginRequest(db, { telegramUserId }) // confirmed, not yet collected
  await insertLoginRequest(db, { telegramUserId, consumedAt: new Date() })
  return { ownItem }
}

/** Every row of every table, as text — a new table cannot hide from this. */
async function rowsMentioning(needle: string, digits = false): Promise<string[]> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`)
  const found: string[] = []
  for (const { table_name } of tables) {
    // A Telegram id is a number: match it whole, not inside some other number.
    const pattern = digits ? `(^|[^0-9])${needle}([^0-9]|$)` : needle
    const rows = await db.execute(
      sql`select 1 from ${sql.identifier(table_name)} t where t::text ~ ${pattern}`,
    )
    if (rows.length > 0) found.push(table_name)
  }
  return found
}

async function snapshot(actorId: string) {
  return {
    actor: await db.select().from(actors).where(eq(actors.id, actorId)),
    verdicts: await db.select().from(verdicts).where(eq(verdicts.actorId, actorId)),
    picks: await db.select().from(searchPicks).where(eq(searchPicks.actorId, actorId)),
    events: await db.select().from(events).where(eq(events.actorId, actorId)),
    expenses: await db.execute(sql`
      select e.* from expenses e join trips t on t.id = e.trip_id where t.actor_id = ${actorId}`),
    sessions: await db.execute(sql`select * from sessions where actor_id = ${actorId}`),
  }
}

describe('стирание владельца по Telegram-id (MOL-58)', () => {
  it('после стирания о человеке не остаётся ни строки — ни в одной таблице базы', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    await aLife(anna, tg, shared)

    const report = await erasure.erase(tg, { dryRun: false })

    expect(report).toEqual({
      found: true,
      erased: {
        sessions: 1,
        search_picks: 1,
        verdicts: 2,
        events: 1,
        expenses: 2,
        trips: 1,
        login_requests: 2,
        actors: 1,
      },
      itemsReleased: 1,
    })
    expect(await rowsMentioning(anna)).toEqual([])
    expect(await rowsMentioning(String(tg), true)).toEqual([])
  })

  it('товар, который человек завёл, остаётся в справочнике без автора', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const { ownItem } = await aLife(anna, tg, {
      itemId: await insertItem(db),
      placeId: await insertPlace(db),
    })

    await erasure.erase(tg, { dryRun: false })

    const [item] = await db.select().from(items).where(eq(items.id, ownItem))
    expect(item?.createdBy).toBeNull()
    expect(item?.name).toBe('Рынок-сыр')
  })

  it('места остаются все — и то, где бывал только он (решение Q4)', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const onlyHers = await insertPlace(db, { name: 'Рынок у дома' })
    await aLife(anna, tg, { itemId: await insertItem(db), placeId: onlyHers })

    await erasure.erase(tg, { dryRun: false })

    expect(await db.select().from(places).where(eq(places.id, onlyHers))).toHaveLength(1)
  })

  it('не трогает другого человека, даже в том же магазине и с тем же товаром', async () => {
    const tg = telegramId()
    const boris = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const witness = await insertActor(db, { telegramUserId: boris })
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    const { ownItem } = await aLife(anna, tg, shared)
    // Boris bought and rated what Anna added to the catalogue.
    await aLife(witness, boris, { ...shared, itemId: ownItem })
    const before = await snapshot(witness)

    await erasure.erase(tg, { dryRun: false })

    expect(await snapshot(witness)).toEqual(before)
    // The same scan that proves Anna gone must be able to see somebody who is not.
    expect(await rowsMentioning(witness)).not.toEqual([])
    expect(
      await db.select().from(loginRequests).where(eq(loginRequests.telegramUserId, boris)),
    ).toHaveLength(2)
  })

  it('сухой прогон считает ровно то же и не меняет ни строки', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    await aLife(anna, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })
    const before = await snapshot(anna)

    const dry = await erasure.erase(tg, { dryRun: true })

    expect(await snapshot(anna)).toEqual(before)
    expect(await erasure.erase(tg, { dryRun: false })).toEqual(dry)
  })

  it('неизвестный владелец: стирает только его запросы входа', async () => {
    const tg = telegramId()
    await insertLoginRequest(db, { telegramUserId: tg })
    const bystander = await insertLoginRequest(db, { telegramUserId: telegramId() })

    const report = await erasure.erase(tg, { dryRun: false })

    expect(report.found).toBe(false)
    expect(report.erased.login_requests).toBe(1)
    expect(report.erased.actors).toBe(0)
    expect(
      await db.select().from(loginRequests).where(eq(loginRequests.id, bystander)),
    ).toHaveLength(1)
  })

  it('повтор после стирания — «нет владельца», не ошибка', async () => {
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })
    await erasure.erase(tg, { dryRun: false })

    const again = await erasure.erase(tg, { dryRun: false })

    expect(again.found).toBe(false)
    expect(Object.values(again.erased).every((n) => n === 0)).toBe(true)
  })

  it.each([0, -1, 1.5, 2 ** 53])('id %s не доходит до базы', async (id) => {
    await expect(erasure.erase(id, { dryRun: true })).rejects.toThrow()
  })
})

describe('страж схемы', () => {
  it('каждый внешний ключ на actors известен стиранию', async () => {
    const references = await db.execute<{ reference: string }>(sql`
      select kcu.table_name || '.' || kcu.column_name as reference
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name and kcu.constraint_schema = rc.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = rc.unique_constraint_name
       and ccu.constraint_schema = rc.unique_constraint_schema
      where ccu.table_name = 'actors' and kcu.constraint_schema = 'public'
      order by 1`)

    expect(references.map((row) => row.reference)).toEqual([...ACTOR_REFERENCES].sort())
  })
})
