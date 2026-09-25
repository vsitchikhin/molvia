import { and, asc, eq, gt, isNotNull, isNull, lte, ne, or, sql, sum } from 'drizzle-orm'
import { DomainError, ERROR, EXCHANGE_UNDO_MINUTES, exchangeSchema } from '@molvia/model'
import type { Currency, Exchange, ExchangeBody, RatePreference } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { actors, exchanges, expenses, trips } from './schema'

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

  /** Which rate a new trip takes (В-3). The row always has one: the column has a default. */
  preference(actorId: string): Promise<RatePreference>

  setPreference(actorId: string, preference: RatePreference): Promise<void>
}

type Row = typeof exchanges.$inferSelect

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
    createdAt: row.createdAt,
  })
}

export function createExchangeRepository(db: Conn): ExchangeRepository {
  return {
    async add(actorId, input) {
      return translateFailures(async () => {
        const [inserted] = await db
          .insert(exchanges)
          .values({
            id: input.id,
            actorId,
            givenMinor: input.given.minor,
            givenCurrency: input.given.currency,
            receivedMinor: input.received.minor,
            receivedCurrency: input.received.currency,
            exchangedOn: input.exchangedOn,
            heldBeforeMinor: input.heldBefore?.minor ?? null,
          })
          .onConflictDoNothing({ target: exchanges.id })
          .returning()
        if (inserted) return { exchange: toExchange(inserted), created: true }

        const [same] = await db.select().from(exchanges).where(eq(exchanges.id, input.id)).limit(1)
        if (same?.actorId !== actorId) throw new DomainError(ERROR.CONFLICT)
        const held = theRow(same, 'exchanges')
        // A removed exchange still holds its name until it is final; «Вернуть» brings it back.
        if (held.deletedAt !== null) throw new DomainError(ERROR.CONFLICT)
        const repeated =
          held.givenMinor === input.given.minor &&
          held.givenCurrency === input.given.currency &&
          held.receivedMinor === input.received.minor &&
          held.receivedCurrency === input.received.currency &&
          held.exchangedOn === input.exchangedOn &&
          held.heldBeforeMinor === (input.heldBefore?.minor ?? null)
        if (!repeated) throw new DomainError(ERROR.CONFLICT)
        return { exchange: toExchange(held), created: false }
      })
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

    async preference(actorId) {
      const [row] = await db
        .select({ preference: actors.ratePreference })
        .from(actors)
        .where(eq(actors.id, actorId))
        .limit(1)
      if (!row) throw new DomainError(ERROR.NO_ACTOR)
      return row.preference
    },

    async setPreference(actorId, preference) {
      await db.update(actors).set({ ratePreference: preference }).where(eq(actors.id, actorId))
    },
  }
}
