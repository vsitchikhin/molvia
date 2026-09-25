import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { ActorSettings } from '@molvia/model'
import { eq } from 'drizzle-orm'
import { actorSettingsSchema, AGGREGATE_MIN_CONTRIBUTIONS, SESSION_COOKIE } from '@molvia/model'
import { createSessionRepository } from '@/db/sessions-repository'
import type { Db } from '@/db/index'
import type { PriceQuery } from '@/db/expenses-repository'
import {
  actors,
  events,
  exchanges,
  expenses,
  itemBarcodes,
  items,
  loginRequests,
  officialRates,
  places,
  searchPicks,
  sessions,
  trips,
  verdicts,
} from '@/db/schema'

/**
 * The minimal rows a foreign key demands, so a test states only what it is actually about.
 * Every fixture returns the id it wrote and accepts a patch for the one column under test.
 */
/**
 * `telegram_user_id` is unique, so every fixture actor needs its own (MOL-52). Counting from
 * a random start rather than from one: several test files share a database within a run, and
 * a counter that always began at 1 would collide across them — as CONFLICT, which reads like
 * the behaviour under test rather than like a fixture stepping on another fixture.
 */
let nextTelegramUserId = randomInt(1, 2 ** 40)

/** One nobody else in this run holds. Exported for the tests that call the repository. */
export function telegramId(): number {
  return (nextTelegramUserId += 1)
}

export async function insertActor(
  db: Db,
  patch: Partial<typeof actors.$inferInsert> = {},
): Promise<string> {
  const id = patch.id ?? randomUUID()
  await db.insert(actors).values({
    id,
    telegramUserId: telegramId(),
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

/**
 * An hour from now, which is longer than any test takes and short enough to be plainly a
 * session rather than a fixture that forgot to say when it ends.
 */
export function anHourFromNow(): Date {
  return new Date(Date.now() + 60 * 60 * 1000)
}

export async function insertSession(
  db: Db,
  patch: Partial<typeof sessions.$inferInsert> & { actorId: string },
): Promise<string> {
  const id = patch.id ?? randomUUID()
  await db.insert(sessions).values({
    id,
    tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
    expiresAt: anHourFromNow(),
    ...patch,
  })
  return id
}

/**
 * A session for an actor a test already built, as the header a request carries it in (MOL-53).
 *
 * **Integration tests do not go through the development seam** (Р-7). They build their owners
 * with `insertActor`, so the seam would have to widen to «hand a session to whoever I name» —
 * and that is precisely the door the epic closes. A row written here instead keeps the seam
 * narrow: only a new person, only outside production.
 *
 * The token is minted the way the API mints one, and the repository hashes it itself — no
 * caller here ever holds a method that could put a raw token in the column (MOL-52, Р-6).
 */
export async function signIn(
  db: Db,
  actorId: string,
  expiresAt = anHourFromNow(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await createSessionRepository(db).create(randomUUID(), actorId, token, null, expiresAt)
  return `${SESSION_COOKIE}=${token}`
}

/**
 * A session cookie nobody holds: the same 32 bytes in the same alphabet, and no row behind
 * them. What a stranger's request looks like — and what an expired or revoked one is
 * indistinguishable from (MOL-53, Р-3).
 */
export function aStrangersCookie(): string {
  return `${SESSION_COOKIE}=${randomBytes(32).toString('base64url')}`
}

export async function insertLoginRequest(
  db: Db,
  patch: Partial<typeof loginRequests.$inferInsert> = {},
): Promise<string> {
  const id = patch.id ?? randomUUID()
  await db.insert(loginRequests).values({
    id,
    code: randomUUID().replaceAll('-', ''),
    secretHash: createHash('sha256').update(randomUUID()).digest('hex'),
    expiresAt: anHourFromNow(),
    ...patch,
  })
  return id
}

/** Deleted child-first: every table here points at the one below it. */
export async function clearAll(db: Db): Promise<void> {
  await db.delete(loginRequests)
  await db.delete(sessions)
  await db.delete(events)
  await db.delete(officialRates)
  await db.delete(exchanges)
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

/** Settings captured by the client before a new trip is sent. */
export async function tripContext(db: Db, owner: string): Promise<ActorSettings> {
  const [row] = await db.select().from(actors).where(eq(actors.id, owner))
  return actorSettingsSchema.parse(
    row && {
      country: row.country,
      city: row.city,
      spendCurrency: row.spendCurrency,
      incomeCurrency: row.incomeCurrency,
    },
  )
}
