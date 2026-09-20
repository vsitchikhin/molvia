import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { connectDrizzle } from './db'
import {
  anHourFromNow,
  clearAll,
  insertActor,
  insertItem,
  insertLoginRequest,
  insertPlace,
  insertSession,
  insertTrip,
  telegramId,
} from './fixtures'
import {
  actors,
  events,
  expenses,
  itemBarcodes,
  items,
  loginRequests,
  places,
  searchPicks,
  sessions,
  trips,
  verdicts,
} from '@/db/schema'

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

// Every verdict carries the kind of the item it points at, held true by a composite
// foreign key; the fixtures below say it out loud so the corner stays visible.
const itemKind = 'product' as const

describe('one verdict per «actor + item + place»', () => {
  it('refuses a second verdict on the same product, where place is empty', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, itemKind, score: 5 })

    // The whole reason the constraint is NULLS NOT DISTINCT: a plain UNIQUE counts two
    // nulls as different values and lets this row in.
    await refuses(
      () => db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, itemKind, score: 2 }),
      UNIQUE,
    )
  })

  it('lets two people rate the same product', async () => {
    const itemId = await insertItem(db)
    const one = await insertActor(db)
    const other = await insertActor(db)

    await db.insert(verdicts).values({ id: randomUUID(), actorId: one, itemId, itemKind, score: 5 })
    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId: other, itemId, itemKind, score: 2 })

    await expect(db.select().from(verdicts)).resolves.toHaveLength(2)
  })

  it('lets one person rate the same dish in two places', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db, { kind: 'dish', name: 'Карбонара' })
    const here = await insertPlace(db, { kind: 'venue', name: 'Пиццерия' })
    const there = await insertPlace(db, { kind: 'venue', name: 'Кафе' })

    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId, itemId, itemKind: 'dish', placeId: here, score: 5 })
    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId, itemId, itemKind: 'dish', placeId: there, score: 2 })

    await expect(db.select().from(verdicts)).resolves.toHaveLength(2)
  })

  it('refuses a score outside 1..5 and accepts both ends', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const other = await insertItem(db, { name: 'Кефир' })

    for (const score of [0, 6]) {
      await refuses(
        () => db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, itemKind, score }),
        CHECK,
      )
    }

    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, itemKind, score: 1 })
    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId, itemId: other, itemKind, score: 5 })
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
          itemKind,
          score: 4,
          ratedAt,
          updatedAt: new Date(ratedAt.getTime() - 1000),
        }),
      CHECK,
    )

    await db.insert(verdicts).values({
      id: randomUUID(),
      actorId,
      itemId,
      itemKind,
      score: 4,
      ratedAt,
      updatedAt: ratedAt,
    })
    await expect(db.select().from(verdicts)).resolves.toHaveLength(1)
  })

  it('refuses a withdrawal older than the rating it withdraws', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const ratedAt = new Date('2026-09-01T10:00:00.000Z')
    const row = { actorId, itemId, itemKind, score: 4, ratedAt, updatedAt: ratedAt }

    await refuses(
      () =>
        db
          .insert(verdicts)
          .values({ ...row, id: randomUUID(), deletedAt: new Date(ratedAt.getTime() - 1000) }),
      CHECK,
    )

    await db.insert(verdicts).values({ ...row, id: randomUUID(), deletedAt: ratedAt })
    await expect(db.select().from(verdicts)).resolves.toHaveLength(1)
  })

  it('keeps no text on a withdrawn verdict, on any write path', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const id = randomUUID()
    await db
      .insert(verdicts)
      .values({ id, actorId, itemId, itemKind, score: 2, review: 'Пахнет крахмалом' })

    // Withdrawing and forgetting the text is exactly the slip the constraint is there for.
    await refuses(
      () =>
        db
          .update(verdicts)
          .set({ deletedAt: sql`clock_timestamp()` })
          .where(eq(verdicts.id, id)),
      CHECK,
    )

    await db
      .update(verdicts)
      .set({ deletedAt: sql`clock_timestamp()`, review: null })
      .where(eq(verdicts.id, id))
    const [row] = await db.select().from(verdicts)
    expect(row?.review).toBeNull()
    expect(row?.score).toBe(2)
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

  it('refuses a rate of zero or less', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)

    for (const rateScaled of [0n, -4_820_000n]) {
      await refuses(() => insertTrip(db, { actorId, placeId, ...rate, rateScaled }), CHECK)
    }

    // The floor is zero, not the domain's plausibility band: dividing by zero throws and a
    // negative rate flips the sign of last month, both as arithmetic rather than an error.
    await insertTrip(db, { actorId, placeId, ...rate, rateScaled: 1n })
    await expect(db.select().from(trips)).resolves.toHaveLength(1)
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

  it('refuses a search key of nothing but space — the row would be unreachable', async () => {
    // The invisible ones are the point: plain `btrim` strips only the ASCII space, so a key
    // of one no-break space would pass and the item would never be found again.
    for (const searchKey of ['', '   ', '\u00A0', '\u200B\u200B', '\uFEFF']) {
      await refuses(() => insertItem(db, { searchKey }), CHECK)
    }

    await insertItem(db, { searchKey: '   k   ' })
    await expect(db.select().from(items)).resolves.toHaveLength(1)
  })

  it('takes the barcodes of a deleted item with it', async () => {
    const itemId = await insertItem(db)
    await db.insert(itemBarcodes).values({ code: '4850001234567', itemId })

    await db.delete(items).where(eq(items.id, itemId))

    await expect(db.select().from(itemBarcodes)).resolves.toHaveLength(0)
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

describe('a verdict knows what kind of thing it rates', () => {
  it('refuses a product rated «in a place» — that is how one person votes twice', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const placeId = await insertPlace(db)
    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, itemKind, score: 5 })

    // The uniqueness cannot see this pair: the rows differ in place_id. Without the check
    // the average of the item counts one person's opinion twice.
    await refuses(
      () =>
        db
          .insert(verdicts)
          .values({ id: randomUUID(), actorId, itemId, itemKind, placeId, score: 1 }),
      CHECK,
    )
  })

  it('refuses a dish rated nowhere', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db, { kind: 'dish', name: 'Карбонара' })

    await refuses(
      () =>
        db
          .insert(verdicts)
          .values({ id: randomUUID(), actorId, itemId, itemKind: 'dish', score: 5 }),
      CHECK,
    )
  })

  it('refuses a kind that disagrees with the item itself', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const placeId = await insertPlace(db, { kind: 'venue', name: 'Кафе' })

    // The kind is a copy, and the composite foreign key is what keeps a copy honest.
    await refuses(
      () =>
        db
          .insert(verdicts)
          .values({ id: randomUUID(), actorId, itemId, itemKind: 'dish', placeId, score: 5 }),
      FOREIGN_KEY,
    )
  })

  it('refuses to reclassify an item that has already been rated, either way round', async () => {
    const actorId = await insertActor(db)
    const dishId = await insertItem(db, { kind: 'dish', name: 'Карбонара' })
    const productId = await insertItem(db, { name: 'Молоко' })
    const placeId = await insertPlace(db, { kind: 'venue', name: 'Пиццерия' })
    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId, itemId: dishId, itemKind: 'dish', placeId, score: 5 })
    await db
      .insert(verdicts)
      .values({ id: randomUUID(), actorId, itemId: productId, itemKind, score: 4 })

    // The kind of a rated item is immutable, and in both directions: a dish rated in a café
    // cannot become a product whose verdict belongs nowhere, and a product rated nowhere
    // cannot become a dish that has to belong somewhere. That is why the key is NO ACTION
    // and not a cascade — a cascade here could never arrive.
    await refuses(
      () => db.update(items).set({ kind: 'product' }).where(eq(items.id, dishId)),
      FOREIGN_KEY,
    )
    await refuses(
      () => db.update(items).set({ kind: 'dish' }).where(eq(items.id, productId)),
      FOREIGN_KEY,
    )
  })

  it('carries the kind along while nothing has been rated yet', async () => {
    const itemId = await insertItem(db, { kind: 'dish', name: 'Карбонара' })
    const actorId = await insertActor(db)

    await db.update(items).set({ kind: 'product' }).where(eq(items.id, itemId))
    await db.insert(verdicts).values({ id: randomUUID(), actorId, itemId, itemKind, score: 4 })

    await expect(db.select().from(verdicts)).resolves.toHaveLength(1)
  })

  it('moves updated_at when a verdict is re-rated', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const id = randomUUID()
    const ratedAt = new Date('2026-09-01T10:00:00.000Z')
    await db
      .insert(verdicts)
      .values({ id, actorId, itemId, itemKind, score: 2, ratedAt, updatedAt: ratedAt })

    await db.update(verdicts).set({ score: 5 }).where(eq(verdicts.id, id))

    const [row] = await db.select().from(verdicts)
    // Without this the column never moves, and «a re-rating is visible» is a tautology.
    expect(row?.updatedAt.getTime()).toBeGreaterThan(ratedAt.getTime())
  })

  it('moves updated_at from raw SQL too — the trigger is in the database', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const id = randomUUID()
    const ratedAt = new Date('2026-09-01T10:00:00.000Z')
    await db
      .insert(verdicts)
      .values({ id, actorId, itemId, itemKind, score: 2, ratedAt, updatedAt: ratedAt })

    // The point of putting it in the database: SQL lives in `src/db` and is the main
    // instrument here, so a mechanism the query builder owns would miss every second path.
    await db.execute(sql`update verdicts set score = 5 where id = ${id}`)

    const [row] = await db.select().from(verdicts)
    expect(row?.updatedAt.getTime()).toBeGreaterThan(ratedAt.getTime())
  })

  it('lets a verdict be written and re-rated inside one transaction', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const id = randomUUID()

    // The trap this pins: `now()` is the timestamp of the transaction's *start*, so a
    // `rated_at` stamped by the application after BEGIN is later than it, and
    // `verdicts_updated_after_rated` refuses the update — always, not sometimes. The
    // timestamp is read from the database inside the transaction to model exactly that,
    // without depending on how the two clocks happen to round.
    await db.transaction(async (tx) => {
      const stamped = await tx.execute<{ ts: string }>(sql`select clock_timestamp() as ts`)
      const ratedAt = new Date(stamped[0]?.ts ?? Date.now())
      await tx
        .insert(verdicts)
        .values({ id, actorId, itemId, itemKind, score: 2, ratedAt, updatedAt: ratedAt })
      await tx.update(verdicts).set({ score: 5 }).where(eq(verdicts.id, id))
    })

    const [row] = await db.select().from(verdicts)
    expect(row?.score).toBe(5)
    expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(row?.ratedAt.getTime() ?? 0)
  })

  it('refuses a rating dated in the future — no CHECK can say that, a trigger can', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)

    // Left alone, such a row has no good end: with the trace pinned to the rating it lets a
    // client hold `updated_at` a century ahead, and without pinning it locks the row, since
    // every later update would land before `rated_at`. The server stamps this value itself,
    // microseconds before the insert, so a date from the future is a broken row.
    await refuses(
      () =>
        db.insert(verdicts).values({
          id: randomUUID(),
          actorId,
          itemId,
          itemKind,
          score: 4,
          ratedAt: tomorrow,
          updatedAt: tomorrow,
        }),
      CHECK,
    )
  })

  it('leaves updated_at alone when the update changes nothing', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const id = randomUUID()
    await db.insert(verdicts).values({ id, actorId, itemId, itemKind, score: 2 })
    const [before] = await db.select().from(verdicts)

    // A repeated request, a review edited to the same text, a repair migration walking every
    // row: the column says the row changed, not that something passed over it.
    await db.execute(sql`update verdicts set score = score where id = ${id}`)

    const [after] = await db.select().from(verdicts)
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
  })

  it("moves an actor's updated_at when their settings change", async () => {
    const actorId = await insertActor(db)
    const [before] = await db.select().from(actors)

    await db.execute(sql`update actors set city = 'Ереван' where id = ${actorId}`)

    const [after] = await db.select().from(actors)
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0)
  })
})

describe('a place is its name, not its spelling', () => {
  it('refuses the same shop written in another case', async () => {
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' })

    await refuses(() => insertPlace(db, { kind: 'store', name: 'sas', city: 'Ереван' }), UNIQUE)
  })

  it('refuses the same shop written in another Unicode normalisation', async () => {
    // «Ёлки» with U+0401 against the same word with U+0415 U+0308: identical on screen,
    // different bytes, and two price histories for one shop if they both get in.
    await insertPlace(db, { kind: 'store', name: '\u0401\u043b\u043a\u0438' })

    await refuses(
      () => insertPlace(db, { kind: 'store', name: '\u0415\u0308\u043b\u043a\u0438' }),
      UNIQUE,
    )
  })

  it('refuses the same shop written in fullwidth letters', async () => {
    // NFKC rather than NFC: «ＳＡＳ» is the same shop with the same letters in another width.
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' })

    await refuses(() => insertPlace(db, { kind: 'store', name: 'ＳＡＳ', city: 'Ереван' }), UNIQUE)
  })

  it('refuses the same shop padded with invisible characters', async () => {
    // The same list of blanks the search key uses: one definition of «invisible» for the
    // whole schema, or a zero-width space makes a second shop where a plain space would not.
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' })

    for (const name of ['\u200BSAS', 'SAS\uFEFF', '\u00A0SAS\u00A0']) {
      await refuses(() => insertPlace(db, { kind: 'store', name, city: 'Ереван' }), UNIQUE)
    }
  })

  it('refuses the same shop written with padding around it', async () => {
    // The domain trims, so this only happens on the paths that bypass it — a seed, an
    // import, a hand-written UPDATE — which is exactly what the identity index is for.
    await insertPlace(db, { kind: 'store', name: 'SAS', city: 'Ереван' })

    await refuses(() => insertPlace(db, { kind: 'store', name: ' SAS ', city: 'Ереван' }), UNIQUE)
  })

  it('refuses a country written in lower case or in one letter', async () => {
    for (const country of ['am', 'A']) {
      await refuses(() => insertPlace(db, { country }), CHECK)
    }
  })
})

describe('the actor', () => {
  it('refuses a currency the project does not support', async () => {
    await refuses(
      () =>
        db.execute(sql`
        insert into ${actors} (id, telegram_user_id, country, city, spend_currency, income_currency)
        values (${randomUUID()}, ${telegramId()}, 'AM', 'Гюмри', 'GBP', 'RUB')
      `),
      CHECK,
    )
  })

  it('refuses a second owner on one Telegram account, and an id outside what JSON carries', async () => {
    // The whole point of the column (MOL-52): «one Telegram account, one owner» is a claim
    // about *other rows*, which only the database can make. The bounds are the edge cases —
    // 2^53 − 1 is the largest id Telegram promised, 2^53 the first number a reply could not
    // carry back unchanged.
    const shared = telegramId()
    await insertActor(db, { telegramUserId: shared })

    await refuses(() => insertActor(db, { telegramUserId: shared }), UNIQUE)
    await refuses(() => insertActor(db, { telegramUserId: 0 }), CHECK)
    await refuses(() => insertActor(db, { telegramUserId: -1 }), CHECK)
    await refuses(() => insertActor(db, { telegramUserId: 9_007_199_254_740_992 }), CHECK)
    await expect(insertActor(db, { telegramUserId: 9_007_199_254_740_991 })).resolves.toBeTruthy()
  })

  it('refuses a country that is not two capitals', async () => {
    for (const country of ['am', 'A']) {
      await refuses(() => insertActor(db, { country }), CHECK)
    }
  })
})

describe('the gate log refuses what the gates cannot count', () => {
  it('refuses a type nobody declared', async () => {
    const actorId = await insertActor(db)

    for (const type of ['сессия_началась', '']) {
      await refuses(
        () =>
          db.execute(sql`
        insert into ${events} (actor_id, type) values (${actorId}, ${type})
      `),
        CHECK,
      )
    }
  })

  it('refuses a catalogue view with no axis to split on', async () => {
    const actorId = await insertActor(db)

    // Exactly what `contracts/events.ts` calls impossible in the domain, and what
    // `DEFAULT '{}'` handed back to the database.
    await refuses(
      () =>
        db.execute(sql`
      insert into ${events} (actor_id, type) values (${actorId}, 'catalogue_viewed')
    `),
      CHECK,
    )

    await refuses(
      () =>
        db.execute(sql`
      insert into ${events} (actor_id, type, payload)
      values (${actorId}, 'catalogue_viewed', '{"subject":"recipes"}'::jsonb)
    `),
      CHECK,
    )

    // The domain says `strictObject` here, and an append-only log has nothing to clean an
    // extra key out with.
    await refuses(
      () =>
        db.execute(sql`
      insert into ${events} (actor_id, type, payload)
      values (${actorId}, 'catalogue_viewed', '{"subject":"venue","whose":"someone"}'::jsonb)
    `),
      CHECK,
    )

    await db.execute(sql`
      insert into ${events} (actor_id, type, payload)
      values (${actorId}, 'catalogue_viewed', '{"subject":"venue"}'::jsonb)
    `)
    await expect(db.select().from(events)).resolves.toHaveLength(1)
  })

  it('refuses a payload that is not an object, and a session that carries one', async () => {
    const actorId = await insertActor(db)

    for (const payload of ['null', '[1,2,3]', '"product"']) {
      await refuses(
        () =>
          db.execute(sql`
        insert into ${events} (actor_id, type, payload)
        values (${actorId}, 'session_started', ${payload}::jsonb)
      `),
        CHECK,
      )
    }

    await refuses(
      () =>
        db.execute(sql`
      insert into ${events} (actor_id, type, payload)
      values (${actorId}, 'session_started', '{"subject":"product"}'::jsonb)
    `),
      CHECK,
    )
  })
})

describe('the remembered pick', () => {
  const queryKey = 'moloko'

  it('refuses a second row for the same «actor + query + item»', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await db.insert(searchPicks).values({ actorId, queryKey, itemId })

    await refuses(() => db.insert(searchPicks).values({ actorId, queryKey, itemId }), UNIQUE)
  })

  it('keeps the pick personal: two people, one query, one item, two rows', async () => {
    const itemId = await insertItem(db)
    const one = await insertActor(db)
    const other = await insertActor(db)

    await db.insert(searchPicks).values({ actorId: one, queryKey, itemId })
    await db.insert(searchPicks).values({ actorId: other, queryKey, itemId })

    // The counter is part of a key that starts with the actor. A shared sum would be
    // popularity in the results — indistinguishable from the promotion the product forbids.
    await expect(db.select().from(searchPicks)).resolves.toHaveLength(2)
  })

  it('refuses a count of zero', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await refuses(
      () => db.insert(searchPicks).values({ actorId, queryKey, itemId, picks: 0 }),
      CHECK,
    )
  })

  it('refuses to delete an actor who has picks', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await db.insert(searchPicks).values({ actorId, queryKey, itemId })

    await refuses(() => db.execute(sql`delete from actors where id = ${actorId}`), FOREIGN_KEY)
  })

  it('refuses a query too wide for its own index, and says why', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    // The column now says what it takes, so a long Latin key is refused by the type itself.
    await refuses(
      () => db.insert(searchPicks).values({ actorId, queryKey: 'k'.repeat(700), itemId }),
      TOO_LONG,
    )

    // An alphabet `toSearchKey` keeps as it is costs four octets per character, so 200 of
    // them fit the type and overflow the btree row: without the check Postgres answers
    // 54000, an error about index internals rather than about the query.
    await refuses(
      () => db.insert(searchPicks).values({ actorId, queryKey: '😀'.repeat(200), itemId }),
      CHECK,
    )

    await db.insert(searchPicks).values({ actorId, queryKey: 'k'.repeat(600), itemId })
    await expect(db.select().from(searchPicks)).resolves.toHaveLength(1)
  })
})

describe('the session, which is a key rather than data', () => {
  it('refuses a token hash that is not one: wrong length, upper case, not hex', async () => {
    const actorId = await insertActor(db)

    for (const tokenHash of ['0'.repeat(63), 'A'.repeat(64), 'z'.repeat(64), '']) {
      await refuses(() => insertSession(db, { actorId, tokenHash }), CHECK)
    }
  })

  it('refuses two sessions on one token, so a stolen one cannot be planted beside its own', async () => {
    const actorId = await insertActor(db)
    const otherId = await insertActor(db)
    const tokenHash = 'a'.repeat(64)
    await insertSession(db, { actorId, tokenHash })

    await refuses(() => insertSession(db, { actorId: otherId, tokenHash }), UNIQUE)
  })

  it('refuses a session that expires before it began', async () => {
    const actorId = await insertActor(db)

    await refuses(
      () => insertSession(db, { actorId, expiresAt: new Date(Date.now() - 1000) }),
      CHECK,
    )
  })

  it('does not outlive its owner by a millisecond', async () => {
    // Cascade, unlike a trip or a verdict (MOL-6, Р-6): those are data and a person's history,
    // this is the key to them. It is also the line MOL-58's deletion script would otherwise
    // have to remember.
    const actorId = await insertActor(db)
    const otherId = await insertActor(db)
    await insertSession(db, { actorId })
    await insertSession(db, { actorId: otherId })

    await db.delete(actors).where(eq(actors.id, actorId))

    const left = await db.select().from(sessions)
    expect(left).toHaveLength(1)
    expect(left[0]?.actorId).toBe(otherId)
  })
})

describe('the login request, which lives minutes', () => {
  it('refuses a code outside the alphabet Telegram accepts', async () => {
    // `start` takes `[A-Za-z0-9_-]` and at most 64 of them. A code the link cannot carry is a
    // login that cannot happen, and it should fail where it is written, not in a chat.
    for (const code of ['', 'код', 'a+b', 'a/b', 'a=b', 'a b', 'a\nb']) {
      await refuses(() => insertLoginRequest(db, { code }), CHECK)
    }

    // One character past the limit is refused by the type rather than by the CHECK — the two
    // answer with different codes, and pretending otherwise would pin the wrong rule.
    await refuses(() => insertLoginRequest(db, { code: 'a'.repeat(65) }), TOO_LONG)

    // The boundary itself: 64 is Telegram's own limit, and the shortest code is one character.
    await expect(insertLoginRequest(db, { code: 'a'.repeat(64) })).resolves.toBeTruthy()
    await expect(insertLoginRequest(db, { code: 'a' })).resolves.toBeTruthy()
  })

  it('refuses two requests on one code', async () => {
    await insertLoginRequest(db, { code: 'the-same-code' })

    await refuses(() => insertLoginRequest(db, { code: 'the-same-code' }), UNIQUE)
  })

  it('refuses a secret hash that is not a sha256 in hex', async () => {
    await refuses(() => insertLoginRequest(db, { secretHash: 'not-a-digest' }), CHECK)
  })

  it('holds the same two bounds on a Telegram id as the owner does, and still takes none', async () => {
    // A confirmed request becomes an owner, so a number that could not survive the journey
    // must not reach that point either. Null until the person presses the button, and there
    // is deliberately no foreign key: on a first login the owner does not exist yet.
    await expect(insertLoginRequest(db, { telegramUserId: null })).resolves.toBeTruthy()
    await expect(insertLoginRequest(db, { telegramUserId: 777_000_123 })).resolves.toBeTruthy()

    await refuses(() => insertLoginRequest(db, { telegramUserId: 0 }), CHECK)
    await refuses(() => insertLoginRequest(db, { telegramUserId: -1 }), CHECK)
    await refuses(() => insertLoginRequest(db, { telegramUserId: 9_007_199_254_740_992 }), CHECK)
  })

  it('takes a Telegram id no owner has, which is what a first login is', async () => {
    const [request] = await db
      .insert(loginRequests)
      .values({
        id: randomUUID(),
        code: 'first-login',
        secretHash: 'b'.repeat(64),
        telegramUserId: 424_242_424,
        expiresAt: anHourFromNow(),
      })
      .returning()

    expect(request?.telegramUserId).toBe(424_242_424)
    await expect(db.select().from(actors)).resolves.toHaveLength(0)
  })
})

async function tripWithItem(): Promise<{ actorId: string; tripId: string; itemId: string }> {
  const actorId = await insertActor(db)
  const placeId = await insertPlace(db)
  const itemId = await insertItem(db)
  const tripId = await insertTrip(db, { actorId, placeId })
  return { actorId, tripId, itemId }
}
