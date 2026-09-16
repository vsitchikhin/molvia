import { randomUUID } from 'node:crypto'
import { and, asc, eq, exists, sql } from 'drizzle-orm'
import { DomainError, ERROR, expenseSchema } from '@molvia/model'
import type { Expense, ExpensePatch, NewExpense } from '@molvia/model'
import { moneyFrom, moneyTo, quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { theRow } from './rows'
import { expenses, trips } from './schema'

export interface ExpenseRepository {
  /** The only required field is the item; everything else may be filled in later. */
  add(actorId: string, input: NewExpense): Promise<Expense>
  forTrip(tripId: string, actorId: string): Promise<Expense[]>
  update(id: string, actorId: string, patch: ExpensePatch): Promise<Expense | null>
  remove(id: string, actorId: string): Promise<boolean>
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
  }
}
