import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip } from './fixtures'
import { events, expenses, itemBarcodes, items, places, trips, verdicts } from '@/db/schema'

const { db, close } = connectDrizzle()

// The codes Postgres answers with, spelled out: a test that only asserts «it threw» passes
// just as happily when the row was refused for the wrong reason.
const CHECK = '23514'
const UNIQUE = '23505'
const FOREIGN_KEY = '23503'
const TOO_LONG = '22001'

/** drizzle wraps the driver error, so the code Postgres answered with sits in `cause`. */
function postgresCode(error: unknown): string | undefined {
  const carrier = error instanceof Error && error.cause !== undefined ? error.cause : error
  if (typeof carrier !== 'object' || carrier === null || !('code' in carrier)) return undefined
  return String(carrier.code)
}

async function refuses(run: () => Promise<unknown>, code: string): Promise<void> {
  const thrown = await run().then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(thrown, 'the database took a row it had to refuse').toBeDefined()
  expect(postgresCode(thrown)).toBe(code)
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('one verdict per «actor + item + place»', () => {
  it('refuses a second verdict on the same product, where place is empty', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, score: 5 })

    // The whole reason the constraint is NULLS NOT DISTINCT: a plain UNIQUE counts two
    // nulls as different values and lets this row in.
    await refuses(
      () => db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, score: 2 }),
      UNIQUE,
    )
  })

  it('lets two people rate the same product', async () => {
    const itemId = await insertItem(db)
    const one = await insertActor(db)
    const other = await insertActor(db)

    await db.insert(verdicts).values({ id: randomUUID(), actorId: one, itemId, score: 5 })
    await db.insert(verdicts).values({ id: randomUUID(), actorId: other, itemId, score: 2 })

    await expect(db.select().from(verdicts)).resolves.toHaveLength(2)
  })

  it('lets one person rate the same dish in two places', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db, { kind: 'dish', name: 'Карбонара' })
    const here = await insertPlace(db, { kind: 'venue', name: 'Пиццерия' })
    const there = await insertPlace(db, { kind: 'venue', name: 'Кафе' })

    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, placeId: here, score: 5 })
    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId, itemId, placeId: there, score: 2 })

    await expect(db.select().from(verdicts)).resolves.toHaveLength(2)
  })

  it('refuses a score outside 1..5 and accepts both ends', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const other = await insertItem(db, { name: 'Кефир' })

    for (const score of [0, 6]) {
      await refuses(
        () => db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, score }),
        CHECK,
      )
    }

    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, score: 1 })
    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId: other, score: 5 })
    await expect(db.select().from(verdicts)).resolves.toHaveLength(2)
  })

  it('refuses a re-rating older than the rating itself', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const ratedAt = new Date('2026-09-01T10:00:00.000Z')

    await refuses(
      () =>
        db.insert(verdicts).values({
          id: randomUUID(),
          actorId,
          itemId,
          score: 4,
          ratedAt,
          updatedAt: new Date(ratedAt.getTime() - 1000),
        }),
      CHECK,
    )

    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId, itemId, score: 4, ratedAt, updatedAt: ratedAt })
    await expect(db.select().from(verdicts)).resolves.toHaveLength(1)
  })
})

describe('a price is an observation, not a duplicate', () => {
  it('takes a second price for the same «item + place» pair', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const first = await insertTrip(db, { actorId, placeId })
    const second = await insertTrip(db, { actorId, placeId })

    for (const [tripId, minor] of [
      [first, 520n],
      [second, 570n],
    ] as const) {
      await db
        .insert(expenses)
        .values({ id: randomUUID(), tripId, itemId, amountMinor: minor, amountCurrency: 'AMD' })
    }

    await expect(db.select().from(expenses)).resolves.toHaveLength(2)
  })
})

describe('an amount is unreadable without its currency', () => {
  it('refuses half of the pair, either half', async () => {
    const { tripId, itemId } = await tripWithItem()

    await refuses(
      () => db.insert(expenses).values({ id: randomUUID(), tripId, itemId, amountMinor: 500n }),
      CHECK,
    )
    await refuses(
      () => db.insert(expenses).values({ id: randomUUID(), tripId, itemId, amountCurrency: 'AMD' }),
      CHECK,
    )
  })

  it('refuses a negative amount and accepts zero', async () => {
    const { tripId, itemId } = await tripWithItem()

    await refuses(
      () =>
        db
          .insert(expenses)
          .values({ id: randomUUID(), tripId, itemId, amountMinor: -1n, amountCurrency: 'AMD' }),
      CHECK,
    )

    await db
      .insert(expenses)
      .values({ id: randomUUID(), tripId, itemId, amountMinor: 0n, amountCurrency: 'AMD' })
    await expect(db.select().from(expenses)).resolves.toHaveLength(1)
  })

  it('refuses a currency the project does not support', async () => {
    const { tripId, itemId } = await tripWithItem()

    await refuses(
      () =>
        db.execute(sql`
          insert into ${expenses} (id, trip_id, item_id, amount_minor, amount_currency)
          values (${randomUUID()}, ${tripId}, ${itemId}, 500, 'GBP')
        `),
      CHECK,
    )
  })
})

describe('a quantity is a number and a unit together', () => {
  it('refuses fractional pieces and takes whole ones', async () => {
    const { tripId, itemId } = await tripWithItem()

    await refuses(
      () =>
        db
          .insert(expenses)
          .values({ id: randomUUID(), tripId, itemId, qtyMilli: 1500n, qtyUnit: 'piece' }),
      CHECK,
    )

    await db
      .insert(expenses)
      .values({ id: randomUUID(), tripId, itemId, qtyMilli: 2000n, qtyUnit: 'piece' })
    await expect(db.select().from(expenses)).resolves.toHaveLength(1)
  })

  it('takes a fractional kilogram — only pieces are whole', async () => {
    const { tripId, itemId } = await tripWithItem()

    await db
      .insert(expenses)
      .values({ id: randomUUID(), tripId, itemId, qtyMilli: 1500n, qtyUnit: 'kg' })
    await expect(db.select().from(expenses)).resolves.toHaveLength(1)
  })

  it('refuses half of the pair, either half', async () => {
    const { tripId, itemId } = await tripWithItem()

    await refuses(
      () => db.insert(expenses).values({ id: randomUUID(), tripId, itemId, qtyMilli: 1000n }),
      CHECK,
    )
    await refuses(
      () => db.insert(expenses).values({ id: randomUUID(), tripId, itemId, qtyUnit: 'kg' }),
      CHECK,
    )
  })

  it('refuses zero and negative quantities', async () => {
    const { tripId, itemId } = await tripWithItem()

    for (const milli of [0n, -1000n]) {
      await refuses(
        () =>
          db
            .insert(expenses)
            .values({ id: randomUUID(), tripId, itemId, qtyMilli: milli, qtyUnit: 'kg' }),
        CHECK,
      )
    }
  })
})

describe('the rate snapshot of a trip', () => {
  const rate = {
    rateBase: 'RUB',
    rateQuote: 'AMD',
    rateScaled: 4_820_000n,
    rateSource: 'personal',
    rateAsOf: new Date('2026-09-01T00:00:00.000Z'),
  } as const

  it('takes a trip with no rate at all', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    await insertTrip(db, { actorId, placeId })

    await expect(db.select().from(trips)).resolves.toHaveLength(1)
  })

  it('refuses four columns out of five', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)

    await refuses(() => insertTrip(db, { actorId, placeId, ...rate, rateAsOf: null }), CHECK)
  })

  it('refuses a rate quoted in a currency the trip does not spend', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)

    await refuses(
      () => insertTrip(db, { actorId, placeId, currency: 'AMD', ...rate, rateQuote: 'USD' }),
      CHECK,
    )
  })

  it('refuses a rate between a currency and itself', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)

    await refuses(
      () => insertTrip(db, { actorId, placeId, currency: 'AMD', ...rate, rateBase: 'AMD' }),
      CHECK,
    )
  })

  it('takes the whole snapshot', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    await insertTrip(db, { actorId, placeId, currency: 'AMD', ...rate })

    const [row] = await db.select().from(trips)
    expect(row?.rateScaled).toBe(4_820_000n)
  })

  it('refuses a trip finished before it started and takes one finished at the same instant', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const startedAt = new Date('2026-09-01T10:00:00.000Z')

    await refuses(
      () =>
        insertTrip(db, {
          actorId,
          placeId,
          startedAt,
          finishedAt: new Date(startedAt.getTime() - 1000),
        }),
      CHECK,
    )

    await insertTrip(db, { actorId, placeId, startedAt, finishedAt: startedAt })
    await expect(db.select().from(trips)).resolves.toHaveLength(1)
  })
})

describe('the catalogue', () => {
  it('keeps an item with no barcodes at all — loose goods have none', async () => {
    const itemId = await insertItem(db, { name: 'Сыр «Чанах» на развес', searchKey: 'sir chanah' })

    const [row] = await db.select().from(items)
    expect(row?.id).toBe(itemId)
    await expect(db.select().from(itemBarcodes)).resolves.toHaveLength(0)
  })

  it('refuses one barcode on two items', async () => {
    const first = await insertItem(db)
    const second = await insertItem(db, { name: 'Молоко «Марианна»' })
    await db.insert(itemBarcodes).values({ code: '4850001234567', itemId: first })

    await refuses(
      () => db.insert(itemBarcodes).values({ code: '4850001234567', itemId: second }),
      UNIQUE,
    )
  })

  it('refuses a barcode of a length no GTIN has', async () => {
    const itemId = await insertItem(db)

    await refuses(() => db.insert(itemBarcodes).values({ code: '123456789', itemId }), CHECK)
  })

  it('takes a name of exactly 200 characters and refuses 201', async () => {
    // The numbers are the domain's (MOL-4 §6.1). Postgres counts code points and zod counts
    // UTF-16 units, so the database is never stricter than the schema — never the reverse.
    await insertItem(db, { name: 'a'.repeat(200) })
    await refuses(() => insertItem(db, { name: 'a'.repeat(201) }), TOO_LONG)
  })

  it('takes a search key of 800 characters — transliteration grows a name', async () => {
    await insertItem(db, { name: 'a'.repeat(200), searchKey: 'k'.repeat(800) })
    await refuses(() => insertItem(db, { searchKey: 'k'.repeat(801) }), TOO_LONG)
  })

  it('refuses a kind and a unit the domain does not know', async () => {
    await refuses(
      () =>
        db.execute(sql`
        insert into ${items} (id, kind, name, search_key, default_unit)
        values (${randomUUID()}, 'service', 'Стрижка', 'strijka', 'piece')
      `),
      CHECK,
    )
    await refuses(
      () =>
        db.execute(sql`
        insert into ${items} (id, kind, name, search_key, default_unit)
        values (${randomUUID()}, 'product', 'Молоко', 'moloko', 'litre')
      `),
      CHECK,
    )
  })
})

describe('places', () => {
  it('lets a shop and a café share a name in one city', async () => {
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' })
    await insertPlace(db, { kind: 'venue', name: 'SAS', city: 'Ереван' })

    await expect(db.select().from(places)).resolves.toHaveLength(2)
  })

  it('refuses two shops with one name in one city', async () => {
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' })

    await refuses(() => insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' }), UNIQUE)
  })

  it('takes the same chain in another city', async () => {
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' })
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Гюмри' })

    await expect(db.select().from(places)).resolves.toHaveLength(2)
  })
})

describe('references lead somewhere', () => {
  it('refuses an expense on a trip that does not exist', async () => {
    const itemId = await insertItem(db)

    await refuses(
      () => db.insert(expenses).values({ id: randomUUID(), tripId: randomUUID(), itemId }),
      FOREIGN_KEY,
    )
  })

  it('takes the expenses of a deleted trip with it, and nothing else', async () => {
    const { tripId, itemId } = await tripWithItem()
    await db.insert(expenses).values({ id: randomUUID(), tripId, itemId })

    await db.delete(trips).where(eq(trips.id, tripId))

    await expect(db.select().from(expenses)).resolves.toHaveLength(0)
    await expect(db.select().from(items)).resolves.toHaveLength(1)
  })

  it('refuses to delete an actor who has trips', async () => {
    const { actorId } = await tripWithItem()

    await refuses(() => db.execute(sql`delete from actors where id = ${actorId}`), FOREIGN_KEY)
  })

  it('refuses an event from an actor nobody has seen', async () => {
    await refuses(
      () =>
        db.insert(events).values({ actorId: randomUUID(), type: 'session_started', payload: {} }),
      FOREIGN_KEY,
    )
  })

  it('empties created_by when the person who added the item leaves', async () => {
    const actorId = await insertActor(db)
    await insertItem(db, { createdBy: actorId })

    await db.execute(sql`delete from actors where id = ${actorId}`)

    const [row] = await db.select().from(items)
    expect(row?.createdBy).toBeNull()
  })
})

async function tripWithItem(): Promise<{ actorId: string; tripId: string; itemId: string }> {
  const actorId = await insertActor(db)
  const placeId = await insertPlace(db)
  const itemId = await insertItem(db)
  const tripId = await insertTrip(db, { actorId, placeId })
  return { actorId, tripId, itemId }
}
