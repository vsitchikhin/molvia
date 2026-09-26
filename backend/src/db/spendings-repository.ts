import { and, asc, eq, gt, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { DomainError, ERROR, SPENDING_UNDO_MINUTES, spendingSchema } from '@molvia/model'
import type { ExchangeRate, Spending, SpendingAmendBody, SpendingBody } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { spendings } from './schema'

/**
 * The owner's spendings outside trips (MOL-73). Every rule of writing is an income's, so one money
 * model keeps one set: the same identifier with the same spending is a repeat, with another is
 * `CONFLICT`; an amendment names the version it was made over; a removal is a mark offered back for
 * ten minutes whatever is written meanwhile (В-4), then made final by the minute timer. The rate of
 * the spending's day is decided by the use case and written beside it.
 */
export interface SpendingRepository {
  add(
    actorId: string,
    input: SpendingBody,
    rate: ExchangeRate | null,
  ): Promise<{ spending: Spending; created: boolean }>

  /**
   * The owner's spending as `input` says. Already so — a repeat — it returns with `amended: false`.
   * Otherwise `input.revision` must be the row's; a missing, removed or someone else's is `NOT_FOUND`.
   */
  amend(
    actorId: string,
    id: string,
    input: SpendingAmendBody,
    rate: ExchangeRate | null,
  ): Promise<{ spending: Spending; amended: boolean }>

  /** The owner's live spending, or null — for the use case to know what an amendment changes. */
  byId(actorId: string, id: string): Promise<Spending | null>

  remove(actorId: string, id: string): Promise<void>
  restore(actorId: string, id: string): Promise<boolean>
  purgeStale(): Promise<void>

  /** The owner's live spendings with a day from `from` to `to`, both included. */
  between(actorId: string, from: string, to: string): Promise<readonly Spending[]>
}

type Row = typeof spendings.$inferSelect

function columnsOf(input: Omit<SpendingBody, 'id'>) {
  return {
    spentOn: input.spentOn,
    amountMinor: input.amount.minor,
    currency: input.amount.currency,
    categoryId: input.categoryId,
    note: input.note ?? null,
    place: input.place ?? null,
  }
}

function rateColumnsOf(rate: ExchangeRate | null) {
  return {
    rateBase: rate?.base ?? null,
    rateQuote: rate?.quote ?? null,
    rateScaled: rate?.scaled ?? null,
    rateSource: rate?.source ?? null,
    rateAsOf: rate?.asOf ?? null,
  }
}

function says(row: Row, input: Omit<SpendingBody, 'id'>): boolean {
  const columns = columnsOf(input)
  return (Object.keys(columns) as (keyof typeof columns)[]).every(
    (column) => row[column] === columns[column],
  )
}

function undoFrom() {
  return sql`clock_timestamp() - make_interval(mins => ${SPENDING_UNDO_MINUTES})`
}

function toSpending(row: Row): Spending {
  const rate =
    row.rateBase === null ||
    row.rateQuote === null ||
    row.rateScaled === null ||
    row.rateSource === null ||
    row.rateAsOf === null
      ? null
      : {
          base: row.rateBase,
          quote: row.rateQuote,
          scaled: row.rateScaled,
          source: row.rateSource,
          asOf: row.rateAsOf,
        }
  return spendingSchema.parse({
    id: row.id,
    actorId: row.actorId,
    spentOn: row.spentOn,
    amount: { minor: row.amountMinor, currency: row.currency },
    categoryId: row.categoryId,
    note: row.note,
    place: row.place,
    rate,
    revision: row.revision,
    createdAt: row.createdAt,
    amendedAt: row.amendedAt,
  })
}

export function createSpendingRepository(db: Conn): SpendingRepository {
  return {
    async add(actorId, input, rate) {
      return translateFailures(async () => {
        const [inserted] = await db
          .insert(spendings)
          .values({ id: input.id, actorId, ...columnsOf(input), ...rateColumnsOf(rate) })
          .onConflictDoNothing({ target: spendings.id })
          .returning()
        if (inserted) return { spending: toSpending(inserted), created: true }

        const [same] = await db.select().from(spendings).where(eq(spendings.id, input.id)).limit(1)
        if (same?.actorId !== actorId) throw new DomainError(ERROR.CONFLICT)
        const held = theRow(same, 'spendings')
        // A removed spending holds its name until it is final; «Вернуть» brings it back.
        if (held.deletedAt !== null || !says(held, input)) throw new DomainError(ERROR.CONFLICT)
        return { spending: toSpending(held), created: false }
      })
    },

    async amend(actorId, id, input, rate) {
      const own = idOrNull(id)
      if (own === null) throw new DomainError(ERROR.NOT_FOUND)
      return translateFailures(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(spendings)
            .where(
              and(
                eq(spendings.id, own),
                eq(spendings.actorId, actorId),
                isNull(spendings.deletedAt),
              ),
            )
            .for('update')
          if (!row) throw new DomainError(ERROR.NOT_FOUND)
          if (says(row, input)) return { spending: toSpending(row), amended: false }
          if (row.revision !== input.revision) throw new DomainError(ERROR.CONFLICT)
          const [amended] = await tx
            .update(spendings)
            .set({
              ...columnsOf(input),
              ...rateColumnsOf(rate),
              revision: row.revision + 1,
              amendedAt: sql`now()`,
            })
            .where(eq(spendings.id, row.id))
            .returning()
          return { spending: toSpending(theRow(amended, 'spendings')), amended: true }
        }),
      )
    },

    async byId(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return null
      const [row] = await db
        .select()
        .from(spendings)
        .where(
          and(eq(spendings.id, own), eq(spendings.actorId, actorId), isNull(spendings.deletedAt)),
        )
      return row ? toSpending(row) : null
    },

    async remove(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return
      await db
        .update(spendings)
        .set({ deletedAt: sql`clock_timestamp()` })
        .where(
          and(eq(spendings.id, own), eq(spendings.actorId, actorId), isNull(spendings.deletedAt)),
        )
    },

    async restore(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      const restored = await db
        .update(spendings)
        .set({ deletedAt: null })
        .where(
          and(
            eq(spendings.id, own),
            eq(spendings.actorId, actorId),
            // Past its time a removal is final even before the timer comes round.
            or(isNull(spendings.deletedAt), gt(spendings.deletedAt, undoFrom())),
          ),
        )
        .returning({ id: spendings.id })
      return restored.length > 0
    },

    async purgeStale() {
      await db
        .delete(spendings)
        .where(and(isNotNull(spendings.deletedAt), lte(spendings.deletedAt, undoFrom())))
    },

    async between(actorId, from, to) {
      const rows = await db
        .select()
        .from(spendings)
        .where(
          and(
            eq(spendings.actorId, actorId),
            isNull(spendings.deletedAt),
            gte(spendings.spentOn, from),
            lte(spendings.spentOn, to),
          ),
        )
        .orderBy(asc(spendings.spentOn), asc(spendings.createdAt), asc(spendings.id))
      return rows.map(toSpending)
    },
  }
}
