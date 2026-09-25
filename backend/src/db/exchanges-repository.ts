import { and, asc, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql, sum } from 'drizzle-orm'
import { DomainError, ERROR, EXCHANGE_UNDO_MINUTES, exchangeSchema } from '@molvia/model'
import type {
  Currency,
  Exchange,
  ExchangeAmendBody,
  ExchangeBody,
  ExchangeRevision,
  RatePreference,
} from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { actors, exchangeRevisions, exchanges, expenses, trips } from './schema'

export interface ExchangeRepository {
  /**
   * «Записать обмен». The same identifier with the same exchange again is a repeat — a tap sent
   * twice, an answer lost — and returns the row already there with `created: false`.
   *
   * The same identifier with **other** amounts, day or remainder is `CONFLICT` (owner's decision
   * В-6, 25.09.2026): that is not a repeat but a correction sent under the old name after an answer
   * that never arrived, and answering it «saved» left the typo in the wallet with the screen
   * saying all was well (adversarial А2, Б1). There is no amending an exchange — the screen says
   * to remove it and enter it again. The same identifier under someone else is `CONFLICT` too.
   */
  add(actorId: string, input: ExchangeBody): Promise<{ exchange: Exchange; created: boolean }>

  /**
   * «Сохранить правку» (MOL-42, В-3): the owner's exchange as `input` says, the version before it
   * kept in `exchange_revisions`, `created_at` unchanged so it keeps its place in its day.
   *
   * The exchange already as `input` says is a repeat — an answer lost, or nothing changed — and
   * returns it with `amended: false`, leaving no version behind. Otherwise `input.revision` must
   * be the version the row is at: an amendment made elsewhere in between is `CONFLICT`, not lost.
   * A missing exchange, a removed one and someone else's are one answer, `NOT_FOUND`.
   */
  amend(
    actorId: string,
    id: string,
    input: ExchangeAmendBody,
  ): Promise<{ exchange: Exchange; amended: boolean }>

  /** The versions of the owner's exchanges before their amendments, by exchange, newest first. */
  history(actorId: string): Promise<ReadonlyMap<string, readonly ExchangeRevision[]>>

  /**
   * The owner's exchange, gone from every reader — marked, not yet deleted, so «Вернуть» can bring
   * it back as it was (В-5). Whether there was one is not said: a repeat after a lost answer,
   * someone else's identifier and a missing one are one outcome, and nothing tells them apart.
   */
  remove(actorId: string, id: string): Promise<void>

  /**
   * «Вернуть»: the owner's removed exchange, back with its own `created_at` — written anew it
   * would take the moment of the tap, and move both the order of its day and the hint (round 2,
   * В1, В2). Repeatable: an exchange already back is `true` too, because the answer that said so
   * may have been lost (round 3, Д1). `false` only when there is no such row of the owner's —
   * already final, or never theirs.
   */
  restore(actorId: string, id: string): Promise<boolean>

  /**
   * Removed exchanges of the owner, deleted for good — all but `except`. Called by every request of
   * the screen but «Вернуть»: once another request is made, the screen no longer offers them back.
   * The exception is the exchange a removal is about: a removal sent again after a lost answer
   * must not make final the very row it is marking (round 3, Д2).
   */
  purgeRemoved(actorId: string, except?: string): Promise<void>

  /**
   * Removed exchanges of everyone, deleted for good once `EXCHANGE_UNDO_MINUTES` have passed —
   * the server's minute timer, for the owner who removed one and never came back (В-7).
   */
  purgeStale(): Promise<void>

  /** Every exchange of the owner, in the order the wallet walks them: by day, then as written. */
  list(actorId: string): Promise<readonly Exchange[]>

  /**
   * What the owner spent in `currency` after `since`, in minor units: the priced expenses written
   * after it, in trips that were still open at that moment. The hint of «сколько было до обмена»
   * (Р-7) — purchases without a price and money spent outside a trip are not in it, and the screen
   * says so.
   *
   * A purchase added to a trip finished before `since` — the sauce found at home, written into
   * last week's trip — was paid with the money held before; counting it would take it away twice
   * (adversarial А4). A purchase of the trip open across the exchange counts: it was made there
   * and then, with whatever money was at hand.
   */
  spentSince(actorId: string, currency: Currency, since: Date): Promise<bigint>

  /**
   * Which rate a new trip takes (В-3) — the row always has one, the column has a default — and
   * when the currency of conversion last changed, or null if it never did (MOL-42, В-2).
   */
  rateSettings(actorId: string): Promise<{ preference: RatePreference; since: Date | null }>

  setPreference(actorId: string, preference: RatePreference): Promise<void>
}

type Row = typeof exchanges.$inferSelect

/** What an exchange says, in columns — what a repeat is compared by and an amendment writes. */
function columnsOf(input: Omit<ExchangeBody, 'id'>) {
  return {
    givenMinor: input.given.minor,
    givenCurrency: input.given.currency,
    receivedMinor: input.received.minor,
    receivedCurrency: input.received.currency,
    exchangedOn: input.exchangedOn,
    heldBeforeMinor: input.heldBefore?.minor ?? null,
    note: input.note ?? null,
  }
}

function says(row: Row, input: Omit<ExchangeBody, 'id'>): boolean {
  const columns = columnsOf(input)
  return (Object.keys(columns) as (keyof typeof columns)[]).every(
    (column) => row[column] === columns[column],
  )
}

/** The moment before which a removal can no longer be undone, by the database's clock. */
function undoFrom() {
  return sql`clock_timestamp() - make_interval(mins => ${EXCHANGE_UNDO_MINUTES})`
}

function toExchange(row: Row): Exchange {
  return exchangeSchema.parse({
    id: row.id,
    actorId: row.actorId,
    given: { minor: row.givenMinor, currency: row.givenCurrency },
    received: { minor: row.receivedMinor, currency: row.receivedCurrency },
    exchangedOn: row.exchangedOn,
    heldBefore:
      row.heldBeforeMinor === null
        ? null
        : { minor: row.heldBeforeMinor, currency: row.receivedCurrency },
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt,
    amendedAt: row.amendedAt,
  })
}

export function createExchangeRepository(db: Conn): ExchangeRepository {
  return {
    async add(actorId, input) {
      return translateFailures(async () => {
        const [inserted] = await db
          .insert(exchanges)
          .values({ id: input.id, actorId, ...columnsOf(input) })
          .onConflictDoNothing({ target: exchanges.id })
          .returning()
        if (inserted) return { exchange: toExchange(inserted), created: true }

        const [same] = await db.select().from(exchanges).where(eq(exchanges.id, input.id)).limit(1)
        if (same?.actorId !== actorId) throw new DomainError(ERROR.CONFLICT)
        const held = theRow(same, 'exchanges')
        // A removed exchange still holds its name until it is final; «Вернуть» brings it back.
        if (held.deletedAt !== null) throw new DomainError(ERROR.CONFLICT)
        if (!says(held, input)) throw new DomainError(ERROR.CONFLICT)
        return { exchange: toExchange(held), created: false }
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
            .from(exchanges)
            .where(
              and(
                eq(exchanges.id, own),
                eq(exchanges.actorId, actorId),
                isNull(exchanges.deletedAt),
              ),
            )
            .for('update')
          if (!row) throw new DomainError(ERROR.NOT_FOUND)
          if (says(row, input)) return { exchange: toExchange(row), amended: false }
          if (row.revision !== input.revision) throw new DomainError(ERROR.CONFLICT)

          await tx.insert(exchangeRevisions).values({
            exchangeId: row.id,
            revision: row.revision,
            givenMinor: row.givenMinor,
            givenCurrency: row.givenCurrency,
            receivedMinor: row.receivedMinor,
            receivedCurrency: row.receivedCurrency,
            exchangedOn: row.exchangedOn,
            heldBeforeMinor: row.heldBeforeMinor,
            note: row.note,
            // One moment for both: the version stopped being the exchange when the amendment
            // was made. `now()` is the transaction's own, the same in both statements.
            replacedAt: sql`now()`,
          })
          const [amended] = await tx
            .update(exchanges)
            .set({
              ...columnsOf(input),
              revision: row.revision + 1,
              amendedAt: sql`now()`,
            })
            .where(eq(exchanges.id, row.id))
            .returning()
          return { exchange: toExchange(theRow(amended, 'exchanges')), amended: true }
        }),
      )
    },

    async history(actorId) {
      const rows = await db
        .select({ revision: exchangeRevisions })
        .from(exchangeRevisions)
        .innerJoin(exchanges, eq(exchanges.id, exchangeRevisions.exchangeId))
        .where(and(eq(exchanges.actorId, actorId), isNull(exchanges.deletedAt)))
        .orderBy(asc(exchangeRevisions.exchangeId), desc(exchangeRevisions.revision))
      const byExchange = new Map<string, ExchangeRevision[]>()
      for (const { revision: row } of rows) {
        const versions = byExchange.get(row.exchangeId) ?? []
        versions.push({
          revision: row.revision,
          given: { minor: row.givenMinor, currency: row.givenCurrency },
          received: { minor: row.receivedMinor, currency: row.receivedCurrency },
          exchangedOn: row.exchangedOn,
          heldBefore:
            row.heldBeforeMinor === null
              ? null
              : { minor: row.heldBeforeMinor, currency: row.receivedCurrency },
          note: row.note,
          replacedAt: row.replacedAt,
        })
        byExchange.set(row.exchangeId, versions)
      }
      return byExchange
    },

    async remove(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return
      await db
        .update(exchanges)
        .set({ deletedAt: sql`clock_timestamp()` })
        .where(
          and(eq(exchanges.id, own), eq(exchanges.actorId, actorId), isNull(exchanges.deletedAt)),
        )
    },

    async restore(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      const restored = await db
        .update(exchanges)
        .set({ deletedAt: null })
        .where(
          and(
            eq(exchanges.id, own),
            eq(exchanges.actorId, actorId),
            // Past its time a removal is final even before the timer comes round.
            or(isNull(exchanges.deletedAt), gt(exchanges.deletedAt, undoFrom())),
          ),
        )
        .returning({ id: exchanges.id })
      return restored.length > 0
    },

    async purgeStale() {
      await db
        .delete(exchanges)
        .where(and(isNotNull(exchanges.deletedAt), lte(exchanges.deletedAt, undoFrom())))
    },

    async purgeRemoved(actorId, except) {
      const kept = except === undefined ? null : idOrNull(except)
      await db
        .delete(exchanges)
        .where(
          and(
            eq(exchanges.actorId, actorId),
            isNotNull(exchanges.deletedAt),
            kept === null ? undefined : ne(exchanges.id, kept),
          ),
        )
    },

    async list(actorId) {
      const rows = await db
        .select()
        .from(exchanges)
        .where(and(eq(exchanges.actorId, actorId), isNull(exchanges.deletedAt)))
        .orderBy(asc(exchanges.exchangedOn), asc(exchanges.createdAt), asc(exchanges.id))
      return rows.map(toExchange)
    },

    async spentSince(actorId, currency, since) {
      const [row] = await db
        .select({ spent: sum(expenses.amountMinor) })
        .from(expenses)
        .innerJoin(trips, eq(trips.id, expenses.tripId))
        .where(
          and(
            eq(trips.actorId, actorId),
            eq(expenses.amountCurrency, currency),
            gt(expenses.createdAt, since),
            or(isNull(trips.finishedAt), gt(trips.finishedAt, since)),
          ),
        )
      // `sum` of a bigint is a numeric, and the driver hands it back as text — or null for none.
      return BigInt(row?.spent ?? '0')
    },

    async rateSettings(actorId) {
      const [row] = await db
        .select({ preference: actors.ratePreference, since: actors.incomeCurrencySince })
        .from(actors)
        .where(eq(actors.id, actorId))
        .limit(1)
      if (!row) throw new DomainError(ERROR.NO_ACTOR)
      return row
    },

    async setPreference(actorId, preference) {
      await db.update(actors).set({ ratePreference: preference }).where(eq(actors.id, actorId))
    },
  }
}
