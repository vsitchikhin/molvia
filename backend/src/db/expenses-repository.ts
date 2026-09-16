import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, exists, inArray, isNotNull, notExists, sql } from 'drizzle-orm'
import { DomainError, ERROR, UNIT_PRICE_SCALE, expenseSchema } from '@molvia/model'
import type { BaseUnit, Currency, Expense, ExpensePatch, NewExpense } from '@molvia/model'
import { moneyFrom, moneyTo, quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { theRow } from './rows'
import { expenses, items, trips, verdicts } from './schema'

export interface ExpenseRepository {
  /** The only required field is the item; everything else may be filled in later. */
  add(actorId: string, input: NewExpense): Promise<Expense>
  forTrip(tripId: string, actorId: string): Promise<Expense[]>
  update(id: string, actorId: string, patch: ExpensePatch): Promise<Expense | null>
  remove(id: string, actorId: string): Promise<boolean>
  /** Bought but not yet rated — by this person, since a stranger's verdict is not an opinion. */
  unratedFor(actorId: string, limit: number): Promise<Expense[]>
  /** Where it was cheaper: one row per place, currency and unit. */
  cheapestFor(actorId: string, itemIds: readonly string[]): Promise<PlacePrice[]>
}

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
              id: randomUUID(),
              tripId: input.tripId,
              itemId: input.itemId,
              qtyMilli: quantity.milli,
              qtyUnit: quantity.unit,
              amountMinor: amount.minor,
              amountCurrency: amount.currency,
            })
            .returning()
          return toExpense(theRow(row, 'expenses'))
        }),
      )
    },

    async forTrip(tripId, actorId) {
      const rows = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.tripId, tripId), ownedByActor(actorId)))
        // The screen lists them in the order they were added; `id` settles two in one
        // millisecond, which a fast thumb at the shelf produces.
        .orderBy(asc(expenses.createdAt), asc(expenses.id))
      return rows.map(toExpense)
    },

    async update(id, actorId, patch) {
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

      const [row] = await db
        .update(expenses)
        .set(set)
        .where(and(eq(expenses.id, id), ownedByActor(actorId)))
        .returning()
      return row ? toExpense(row) : null
    },

    async remove(id, actorId) {
      const removed = await db
        .delete(expenses)
        .where(and(eq(expenses.id, id), ownedByActor(actorId)))
        .returning({ id: expenses.id })
      return removed.length > 0
    },

    async unratedFor(actorId, limit) {
      const rows = await db
        .select({ expense: expenses })
        .from(expenses)
        .innerJoin(trips, and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId)))
        .innerJoin(items, eq(items.id, expenses.itemId))
        .where(
          notExists(
            db
              .select({ one: sql`1` })
              .from(verdicts)
              .where(
                and(
                  eq(verdicts.actorId, actorId),
                  eq(verdicts.itemId, expenses.itemId),
                  // A product is rated as itself and a dish only where it was served, so the
                  // place that closes a purchase depends on the kind. `is not distinct from`
                  // rather than `=`, because for a product both sides are null.
                  sql`${verdicts.placeId} is not distinct from
                      (case when ${items.kind} = 'dish' then ${trips.placeId} end)`,
                ),
              ),
          ),
        )
        .orderBy(desc(expenses.createdAt), desc(expenses.id))
        .limit(limit)
      return rows.map((row) => toExpense(row.expense))
    },

    async cheapestFor(actorId, itemIds) {
      if (itemIds.length === 0) return []

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
            inArray(expenses.itemId, [...itemIds]),
            isNotNull(expenses.amountMinor),
            isNotNull(expenses.qtyMilli),
          ),
        )
        .groupBy(expenses.itemId, trips.placeId, expenses.amountCurrency, expenses.qtyUnit)
        .orderBy(asc(expenses.itemId), asc(trips.placeId))

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
