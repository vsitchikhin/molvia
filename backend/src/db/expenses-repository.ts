import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from 'drizzle-orm'
import { DomainError, ERROR, UNIT_PRICE_SCALE, expenseSchema } from '@molvia/model'
import type {
  BaseUnit,
  Currency,
  Expense,
  ExpensePatch,
  NewExpense,
  PendingVerdicts,
} from '@molvia/model'
import { moneyFrom, moneyTo, quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit } from './rows'
import { expenses, items, places, trips, verdicts } from './schema'

/** An expense to add, named by the device that adds it (MOL-21, В-2). */
export type ExpenseToAdd = NewExpense & { readonly id: string }

export interface ExpenseRepository {
  /**
   * The only required field is the item; everything else may be filled in later.
   *
   * The identifier comes from the device, so a queue that sends twice after a lost reply writes
   * one purchase, not two: the same identifier in the same trip for the same item is a repeat
   * and returns the row already there with `created: false` — the first write wins, the fields
   * sent again are not applied. Anything else holding that identifier is `CONFLICT`.
   *
   * A finished trip takes expenses like an open one (MOL-21, В-8): the soy sauce found in the
   * bag at home belongs to the trip it was bought on.
   */
  add(actorId: string, input: ExpenseToAdd): Promise<{ expense: Expense; created: boolean }>
  /**
   * Every expense of one trip, and deliberately without a limit — the one exception to the
   * rule that a listing takes one. A trip is a single visit to a single shop, the screen
   * shows its rows in full, and a truncated list would quietly disagree with the total
   * computed from the same rows.
   */
  forTrip(tripId: string, actorId: string): Promise<Expense[]>
  /**
   * The expense is named with its trip, and both are conditions of the statement: a row of the
   * person's other trip, named under this one, is not found rather than changed — and the
   * identifiers are compared by Postgres as uuids, so an upper-case one a device sent is the same
   * row (MOL-21, adversarial В). `null` when no row matched.
   */
  update(id: string, tripId: string, actorId: string, patch: ExpensePatch): Promise<Expense | null>
  /** `false` when no row matched — gone already, someone else's, or of another trip. */
  remove(id: string, tripId: string, actorId: string): Promise<boolean>
  /** Bought but not yet rated — by this person, since a stranger's verdict is not an opinion. */
  unratedFor(actorId: string, limit: number): Promise<Expense[]>
  /**
   * The same purchases as the screen «Оценки» asks about them (MOL-28): one row per item, with
   * the name, the place and the day of the latest purchase, newest first, and how many items
   * wait in all. The day is the trip's, not the row's: a finished trip takes rows — the sauce
   * found in the bag at home — and an offline queue sends a whole trip later, and neither was
   * bought when it reached the server. Products only — a dish is rated where it was served, and until 0.3 the verdict
   * path refuses a place, so a dish here would be a question with no way to answer it.
   */
  pendingVerdictsFor(actorId: string, limit: number): Promise<PendingVerdicts>
  /**
   * Where it was cheaper: one row per place, currency and unit.
   *
   * The limit has a default rather than being required, because the number of rows follows
   * the number of places a person shopped in — a handful in 0.1 — and every caller today
   * wants all of them. It is still an argument: in 0.3 the same aggregate counts other
   * people's data, and then the caller, not the data, decides how much comes back.
   */
  cheapestFor(actorId: string, itemIds: readonly string[], limit?: number): Promise<PlacePrice[]>
}

/**
 * How many priced places one call brings back by default. A person shops in a handful of
 * places, and «Что брать» shows the cheapest plus a short «ещё здесь» — so this is generous
 * rather than tight, and it exists to bound the answer, not to shape the screen.
 */
const PLACES_PER_ITEM = 50

/**
 * Not a domain entity but the result of an aggregate: a place and the lowest unit price
 * observed there. Currency and unit are part of the key rather than of the value — two
 * prices in different currencies have no common ground without a rate, and the rate is a
 * snapshot of one trip.
 */
export interface PlacePrice {
  readonly itemId: string
  readonly placeId: string
  readonly currency: Currency
  readonly unit: BaseUnit
  /** The same scale `unitPrice()` produces, so the domain can compare these directly. */
  readonly scaledMinor: bigint
  readonly observations: number
}

type ExpenseRow = typeof expenses.$inferSelect

function toExpense(row: ExpenseRow): Expense {
  return expenseSchema.parse({
    id: row.id,
    tripId: row.tripId,
    itemId: row.itemId,
    quantity: quantityFrom(row.qtyMilli, row.qtyUnit),
    amount: moneyFrom(row.amountMinor, row.amountCurrency),
    createdAt: row.createdAt,
  })
}

export function createExpenseRepository(db: Conn): ExpenseRepository {
  /**
   * An expense has no `actor_id` of its own — deliberately, since MOL-6 — so it belongs to a
   * person through its trip. The ownership is a condition of the statement rather than a
   * check after loading: a check can be forgotten in one method out of ten, and nothing in
   * the types would say so.
   */
  const ownedByActor = (actorId: string) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(trips)
        .where(and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId))),
    )

  /**
   * The purchase has no living verdict of this person. Shared by both readers of the queue, so
   * «unrated» cannot mean two things. Expects `trips` and `items` joined to the expense.
   */
  const noLiveVerdict = (actorId: string) =>
    notExists(
      db
        .select({ one: sql`1` })
        .from(verdicts)
        .where(
          and(
            eq(verdicts.actorId, actorId),
            eq(verdicts.itemId, expenses.itemId),
            // A product is rated as itself and a dish only where it was served, so the place
            // that closes a purchase depends on the kind. `is not distinct from` rather than
            // `=`, because for a product both sides are null.
            sql`${verdicts.placeId} is not distinct from
                (case when ${items.kind} = 'dish' then ${trips.placeId} end)`,
            // A withdrawn verdict is no opinion, so the purchase waits for one again.
            isNull(verdicts.deletedAt),
          ),
        ),
    )

  return {
    async add(actorId, input) {
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          // The foreign key only asks whether the trip exists, never whose it is, so the
          // owner is checked here. A stranger's trip and a trip that was never there give
          // the same answer on purpose.
          const [trip] = await tx
            .select({ id: trips.id })
            .from(trips)
            .where(and(eq(trips.id, input.tripId), eq(trips.actorId, actorId)))
            .limit(1)
          if (!trip) throw new DomainError(ERROR.NOT_FOUND)

          const quantity = quantityTo(input.quantity)
          const amount = moneyTo(input.amount)
          const [row] = await tx
            .insert(expenses)
            .values({
              id: input.id,
              tripId: input.tripId,
              itemId: input.itemId,
              qtyMilli: quantity.milli,
              qtyUnit: quantity.unit,
              amountMinor: amount.minor,
              amountCurrency: amount.currency,
            })
            .onConflictDoNothing({ target: expenses.id })
            .returning()
          if (row) return { expense: toExpense(row), created: true }

          // Nothing was written, so the identifier is taken. Read back under the owner's trip
          // rather than by the identifier alone: `DO NOTHING` says only that *some* row holds
          // it, and returning that row as ours would hand out a stranger's purchase.
          const [existing] = await tx
            .select()
            .from(expenses)
            .where(
              and(
                eq(expenses.id, input.id),
                eq(expenses.tripId, input.tripId),
                eq(expenses.itemId, input.itemId),
              ),
            )
            .limit(1)
          if (!existing) throw new DomainError(ERROR.CONFLICT)
          return { expense: toExpense(existing), created: false }
        }),
      )
    },

    async forTrip(tripId, actorId) {
      if (idOrNull(tripId) === null || idOrNull(actorId) === null) return []

      const rows = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.tripId, tripId), ownedByActor(actorId)))
        // The screen lists them in the order they were added, and `created_at` is what says
        // so — it defaults to `clock_timestamp()`, which advances between statements even
        // inside one transaction. The earlier note here claimed `id` settles rows written in
        // the same millisecond «which a fast thumb at the shelf produces»; that was wrong
        // twice over. A thumb cannot produce it — `timestamptz` is microsecond — and the case
        // that did, several rows in one transaction, was settled by a random uuid, so the
        // list came back in an order unrelated to entry and stayed that way.
        .orderBy(asc(expenses.createdAt), asc(expenses.id))
      return rows.map(toExpense)
    },

    async update(id, tripId, actorId, patch) {
      if (idOrNull(id) === null || idOrNull(tripId) === null || idOrNull(actorId) === null) {
        return null
      }

      // `undefined` means «not mentioned» and `null` means «cleared», and the two must not
      // collapse: the sheet leaves a price empty as often as it fills one in.
      const set: Partial<typeof expenses.$inferInsert> = {}
      if (patch.quantity !== undefined) {
        const quantity = quantityTo(patch.quantity)
        set.qtyMilli = quantity.milli
        set.qtyUnit = quantity.unit
      }
      if (patch.amount !== undefined) {
        const amount = moneyTo(patch.amount)
        set.amountMinor = amount.minor
        set.amountCurrency = amount.currency
      }

      // A parsed patch is never empty — `expensePatchSchema` refuses one, because it would
      // only bump `updated_at` — so an empty one here means a caller went around the domain.
      // Left as a defect on purpose (Р-11), but said out loud: drizzle answers «No values to
      // set», which names neither the table nor the caller.
      if (Object.keys(set).length === 0) {
        throw new Error('an expense patch with no fields reached the repository')
      }

      const [row] = await db
        .update(expenses)
        .set(set)
        .where(and(eq(expenses.id, id), eq(expenses.tripId, tripId), ownedByActor(actorId)))
        .returning()
      return row ? toExpense(row) : null
    },

    async remove(id, tripId, actorId) {
      if (idOrNull(id) === null || idOrNull(tripId) === null || idOrNull(actorId) === null) {
        return false
      }

      const removed = await db
        .delete(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.tripId, tripId), ownedByActor(actorId)))
        .returning({ id: expenses.id })
      return removed.length > 0
    },

    async unratedFor(actorId, limit) {
      if (idOrNull(actorId) === null) return []

      const rows = await db
        .select({ expense: expenses })
        .from(expenses)
        .innerJoin(trips, and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId)))
        .innerJoin(items, eq(items.id, expenses.itemId))
        .where(noLiveVerdict(actorId))
        .orderBy(desc(expenses.createdAt), desc(expenses.id))
        .limit(rowLimit(limit))
      return rows.map((row) => toExpense(row.expense))
    },

    async pendingVerdictsFor(actorId, limit) {
      if (idOrNull(actorId) === null) return { items: [], total: 0 }

      const latest = db
        .selectDistinctOn([expenses.itemId], {
          itemId: expenses.itemId,
          // Aliased: both names are `name`, and a subquery keeps only the bare column name.
          name: sql<string>`${items.name}`.as('item_name'),
          placeName: sql<string>`${places.name}`.as('place_name'),
          boughtAt: trips.startedAt,
        })
        .from(expenses)
        .innerJoin(trips, and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId)))
        .innerJoin(items, and(eq(items.id, expenses.itemId), eq(items.kind, 'product')))
        .innerJoin(places, eq(places.id, trips.placeId))
        .where(noLiveVerdict(actorId))
        .orderBy(
          expenses.itemId,
          desc(trips.startedAt),
          desc(expenses.createdAt),
          desc(expenses.id),
        )
        .as('latest')

      // The total is counted by a window over the same rows, before the limit applies: a
      // second statement could see a purchase the first did not, and the counter would
      // disagree with the page it came with.
      const rows = await db
        .select({
          itemId: latest.itemId,
          name: latest.name,
          placeName: latest.placeName,
          boughtAt: latest.boughtAt,
          total: sql<number>`count(*) over ()`.mapWith(Number),
        })
        .from(latest)
        .orderBy(desc(latest.boughtAt), desc(latest.itemId))
        .limit(rowLimit(limit))

      return {
        items: rows.map(({ itemId, name, placeName, boughtAt }) => ({
          itemId,
          name,
          placeName,
          boughtAt,
        })),
        total: rows[0]?.total ?? 0,
      }
    },

    async cheapestFor(actorId, itemIds, limit = PLACES_PER_ITEM) {
      // A malformed identifier can match nothing, so it is dropped rather than sent to meet
      // `22P02`; if none of them survive there is nothing left to ask about.
      const known = itemIds.map(idOrNull).filter((id): id is string => id !== null)
      if (idOrNull(actorId) === null || known.length === 0) return []

      /*
       * The unit price is computed here rather than in the domain (В-7): with other people's
       * data in 0.3 this has to be SQL anyway, and writing it in memory now would mean
       * writing it twice. The scale comes from `UNIT_PRICE_SCALE` rather than a literal so
       * the two cannot drift, and `round` matches `divideRounded` — both take half away from
       * zero. `::numeric` is not optional: integer division truncates, which would shave
       * almost half a unit off every price, quietly and always in the same direction.
       *
       * `::text` on the way out because a numeric wider than a double must not pass through
       * one; the caller turns it into the bigint the domain compares.
       */
      const scaledMinor = sql<string>`min(round(
        ${expenses.amountMinor}::numeric * 1000 * ${sql.raw(UNIT_PRICE_SCALE.toString())}
        / ${expenses.qtyMilli}
      ))::text`

      const rows = await db
        .select({
          itemId: expenses.itemId,
          placeId: trips.placeId,
          currency: expenses.amountCurrency,
          unit: expenses.qtyUnit,
          scaledMinor,
          observations: count(),
        })
        .from(expenses)
        .innerJoin(trips, and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId)))
        // An observation without a price or without a quantity says nothing about a unit
        // price, so it is skipped by an explicit condition rather than silently.
        .where(
          and(
            inArray(expenses.itemId, known),
            isNotNull(expenses.amountMinor),
            isNotNull(expenses.qtyMilli),
          ),
        )
        .groupBy(expenses.itemId, trips.placeId, expenses.amountCurrency, expenses.qtyUnit)
        // Currency and unit are part of the key, so they belong in the order as well:
        // without them two rows of one place are tied, and a tie is an order the planner is
        // free to change between two loads of the same screen.
        .orderBy(
          asc(expenses.itemId),
          asc(trips.placeId),
          asc(expenses.amountCurrency),
          asc(expenses.qtyUnit),
        )
        .limit(rowLimit(limit))

      return rows.flatMap((row) => {
        // The pairing CHECKs make these non-null wherever the amount and the quantity are,
        // but the column types do not say so.
        if (row.currency === null || row.unit === null) return []
        return [
          {
            itemId: row.itemId,
            placeId: row.placeId,
            currency: row.currency,
            unit: row.unit,
            scaledMinor: BigInt(row.scaledMinor),
            observations: row.observations,
          },
        ]
      })
    },
  }
}
