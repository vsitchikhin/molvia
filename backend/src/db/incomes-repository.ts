import { and, asc, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { DomainError, ERROR, INCOME_UNDO_MINUTES, incomeSchema } from '@molvia/model'
import type { Income, IncomeAmendBody, IncomeBody, IncomeRevision } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { incomeRevisions, incomes } from './schema'

/**
 * The owner's incomes (MOL-66). Every rule of writing is an exchange's (MOL-40, MOL-42), so that one
 * money model has one: the same identifier with the same income is a repeat, with another is
 * `CONFLICT` (В-6); an amendment keeps the version before it and names the one it was made over
 * (В-3); a removal is a mark offered back for ten minutes (В-5, В-7).
 */
export interface IncomeRepository {
  /**
   * «Записать доход». The same identifier with the same income again is a repeat and returns the row
   * already there with `created: false`; with anything else, or under someone else, `CONFLICT`.
   */
  add(actorId: string, input: IncomeBody): Promise<{ income: Income; created: boolean }>

  /**
   * «Сохранить правку»: the owner's income as `input` says, the version before it kept, `created_at`
   * unchanged. Already as `input` says — a repeat — it returns with `amended: false`. Otherwise
   * `input.revision` must be the row's: an amendment made elsewhere in between is `CONFLICT`. A
   * missing income, a removed one and someone else's are one answer, `NOT_FOUND`.
   */
  amend(
    actorId: string,
    id: string,
    input: IncomeAmendBody,
  ): Promise<{ income: Income; amended: boolean }>

  /** The versions of the owner's incomes before their amendments, by income, newest first. */
  history(actorId: string): Promise<ReadonlyMap<string, readonly IncomeRevision[]>>

  /** The owner's income, marked and gone from every reader; whether there was one is not said. */
  remove(actorId: string, id: string): Promise<void>

  /** «Вернуть»: the owner's removed income, back with its own `created_at`; repeatable. */
  restore(actorId: string, id: string): Promise<boolean>

  /** Removed incomes of the owner, deleted for good — all but `except`, the one being removed. */
  purgeRemoved(actorId: string, except?: string): Promise<void>

  /** Removed incomes of everyone, deleted for good once `INCOME_UNDO_MINUTES` have passed. */
  purgeStale(): Promise<void>

  /** Every income of the owner, by day, then as written — the order the wallet walks them. */
  list(actorId: string): Promise<readonly Income[]>
}

type Row = typeof incomes.$inferSelect

/** What an income says, in columns — what a repeat is compared by and an amendment writes. */
function columnsOf(input: Omit<IncomeBody, 'id'>) {
  return {
    amountMinor: input.amount.minor,
    currency: input.amount.currency,
    receivedOn: input.receivedOn,
    heldBeforeMinor: input.heldBefore?.minor ?? null,
    source: input.source,
    note: input.note ?? null,
  }
}

function says(row: Row, input: Omit<IncomeBody, 'id'>): boolean {
  const columns = columnsOf(input)
  return (Object.keys(columns) as (keyof typeof columns)[]).every(
    (column) => row[column] === columns[column],
  )
}

/** The moment before which a removal can no longer be undone, by the database's clock. */
function undoFrom() {
  return sql`clock_timestamp() - make_interval(mins => ${INCOME_UNDO_MINUTES})`
}

function toIncome(row: Row): Income {
  return incomeSchema.parse({
    id: row.id,
    actorId: row.actorId,
    amount: { minor: row.amountMinor, currency: row.currency },
    receivedOn: row.receivedOn,
    heldBefore:
      row.heldBeforeMinor === null ? null : { minor: row.heldBeforeMinor, currency: row.currency },
    source: row.source,
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt,
    amendedAt: row.amendedAt,
  })
}

export function createIncomeRepository(db: Conn): IncomeRepository {
  return {
    async add(actorId, input) {
      return translateFailures(async () => {
        const [inserted] = await db
          .insert(incomes)
          .values({ id: input.id, actorId, ...columnsOf(input) })
          .onConflictDoNothing({ target: incomes.id })
          .returning()
        if (inserted) return { income: toIncome(inserted), created: true }

        const [same] = await db.select().from(incomes).where(eq(incomes.id, input.id)).limit(1)
        if (same?.actorId !== actorId) throw new DomainError(ERROR.CONFLICT)
        const held = theRow(same, 'incomes')
        // A removed income still holds its name until it is final; «Вернуть» brings it back.
        if (held.deletedAt !== null || !says(held, input)) throw new DomainError(ERROR.CONFLICT)
        return { income: toIncome(held), created: false }
      })
    },

    async amend(actorId, id, input) {
      const own = idOrNull(id)
      if (own === null) throw new DomainError(ERROR.NOT_FOUND)
      return translateFailures(() =>
        db.transaction(async (tx) => {
          // Locked, so two amendments of one version are one after the other and the second
          // finds the version moved.
          const [row] = await tx
            .select()
            .from(incomes)
            .where(
              and(eq(incomes.id, own), eq(incomes.actorId, actorId), isNull(incomes.deletedAt)),
            )
            .for('update')
          if (!row) throw new DomainError(ERROR.NOT_FOUND)
          if (says(row, input)) return { income: toIncome(row), amended: false }
          if (row.revision !== input.revision) throw new DomainError(ERROR.CONFLICT)

          await tx.insert(incomeRevisions).values({
            incomeId: row.id,
            revision: row.revision,
            amountMinor: row.amountMinor,
            currency: row.currency,
            receivedOn: row.receivedOn,
            heldBeforeMinor: row.heldBeforeMinor,
            source: row.source,
            note: row.note,
            // One moment for both, the transaction's own (MOL-42).
            replacedAt: sql`now()`,
          })
          const [amended] = await tx
            .update(incomes)
            .set({ ...columnsOf(input), revision: row.revision + 1, amendedAt: sql`now()` })
            .where(eq(incomes.id, row.id))
            .returning()
          return { income: toIncome(theRow(amended, 'incomes')), amended: true }
        }),
      )
    },

    async history(actorId) {
      const rows = await db
        .select({ revision: incomeRevisions })
        .from(incomeRevisions)
        .innerJoin(incomes, eq(incomes.id, incomeRevisions.incomeId))
        .where(and(eq(incomes.actorId, actorId), isNull(incomes.deletedAt)))
        .orderBy(asc(incomeRevisions.incomeId), desc(incomeRevisions.revision))
      const byIncome = new Map<string, IncomeRevision[]>()
      for (const { revision: row } of rows) {
        const versions = byIncome.get(row.incomeId) ?? []
        versions.push({
          revision: row.revision,
          amount: { minor: row.amountMinor, currency: row.currency },
          receivedOn: row.receivedOn,
          heldBefore:
            row.heldBeforeMinor === null
              ? null
              : { minor: row.heldBeforeMinor, currency: row.currency },
          source: row.source,
          note: row.note,
          replacedAt: row.replacedAt,
        })
        byIncome.set(row.incomeId, versions)
      }
      return byIncome
    },

    async remove(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return
      await db
        .update(incomes)
        .set({ deletedAt: sql`clock_timestamp()` })
        .where(and(eq(incomes.id, own), eq(incomes.actorId, actorId), isNull(incomes.deletedAt)))
    },

    async restore(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      const restored = await db
        .update(incomes)
        .set({ deletedAt: null })
        .where(
          and(
            eq(incomes.id, own),
            eq(incomes.actorId, actorId),
            // Past its time a removal is final even before the timer comes round.
            or(isNull(incomes.deletedAt), gt(incomes.deletedAt, undoFrom())),
          ),
        )
        .returning({ id: incomes.id })
      return restored.length > 0
    },

    async purgeStale() {
      await db
        .delete(incomes)
        .where(and(isNotNull(incomes.deletedAt), lte(incomes.deletedAt, undoFrom())))
    },

    async purgeRemoved(actorId, except) {
      const kept = except === undefined ? null : idOrNull(except)
      await db
        .delete(incomes)
        .where(
          and(
            eq(incomes.actorId, actorId),
            isNotNull(incomes.deletedAt),
            kept === null ? undefined : ne(incomes.id, kept),
          ),
        )
    },

    async list(actorId) {
      const rows = await db
        .select()
        .from(incomes)
        .where(and(eq(incomes.actorId, actorId), isNull(incomes.deletedAt)))
        .orderBy(asc(incomes.receivedOn), asc(incomes.createdAt), asc(incomes.id))
      return rows.map(toIncome)
    },
  }
}
