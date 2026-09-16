import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { tripSchema } from '@molvia/model'
import type { Currency, ExchangeRate, NewTrip, Trip } from '@molvia/model'
import { rateFrom, rateTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit, theRow } from './rows'
import { trips } from './schema'

export interface TripRepository {
  /**
   * The currency is a snapshot of the person's setting and the rate a snapshot of the
   * moment: neither is looked up again later, or last month's total would move with
   * today's rate. Whether that rate is plausible — and that its `asOf` is not from the
   * future — belongs to the use case, which is the only place with a clock.
   */
  start(
    actorId: string,
    input: NewTrip,
    currency: Currency,
    rate: ExchangeRate | null,
  ): Promise<Trip>
  byId(id: string, actorId: string): Promise<Trip | null>
  /**
   * The most recent trip that has not been finished — a row, not a verdict on which trip is
   * «current». Several trips in one day is an open product question (the market in the
   * morning, the supermarket in the evening) and MOL-22 is the one that answers it.
   */
  latestUnfinishedFor(actorId: string): Promise<Trip | null>
  listFor(actorId: string, limit: number): Promise<Trip[]>
  finish(id: string, actorId: string, at: Date): Promise<Trip | null>
}

type TripRow = typeof trips.$inferSelect

function toTrip(row: TripRow): Trip {
  return tripSchema.parse({
    id: row.id,
    actorId: row.actorId,
    placeId: row.placeId,
    currency: row.currency,
    rate: rateFrom(row),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  })
}

/** A trip belongs to one person, so the owner is a condition and never a later check. */
function ownedBy(id: string, actorId: string) {
  return and(eq(trips.id, id), eq(trips.actorId, actorId))
}

export function createTripRepository(db: Conn): TripRepository {
  return {
    async start(actorId, input, currency, rate) {
      return translateFailures(async () => {
        const [row] = await db
          .insert(trips)
          .values({ id: randomUUID(), actorId, placeId: input.placeId, currency, ...rateTo(rate) })
          .returning()
        return toTrip(theRow(row, 'trips'))
      })
    },

    async byId(id, actorId) {
      // A malformed identifier matches nothing, and Postgres would say so with `22P02` — a
      // 500, and a third distinct answer where a stranger's row and a missing row are
      // deliberately indistinguishable.
      if (idOrNull(id) === null || idOrNull(actorId) === null) return null

      const [row] = await db.select().from(trips).where(ownedBy(id, actorId)).limit(1)
      return row ? toTrip(row) : null
    },

    async latestUnfinishedFor(actorId) {
      if (idOrNull(actorId) === null) return null

      const [row] = await db
        .select()
        .from(trips)
        .where(and(eq(trips.actorId, actorId), isNull(trips.finishedAt)))
        // `id` settles two trips started in the same moment, so two loads of one screen
        // cannot disagree about which of them came last.
        .orderBy(desc(trips.startedAt), desc(trips.id))
        .limit(1)
      return row ? toTrip(row) : null
    },

    async listFor(actorId, limit) {
      if (idOrNull(actorId) === null) return []

      const rows = await db
        .select()
        .from(trips)
        .where(eq(trips.actorId, actorId))
        .orderBy(desc(trips.startedAt), desc(trips.id))
        // Through `rowLimit`, because a negative one made drizzle print no `LIMIT` clause at
        // all — handing back everything, the exact thing a limit exists to prevent.
        .limit(rowLimit(limit))
      return rows.map(toTrip)
    },

    async finish(id, actorId, at) {
      // Someone else's trip and a trip that never existed answer the same `null`: telling
      // them apart is how an identifier gets guessed by the difference in the reply.
      //
      // Finishing before the start is refused by `trips_finished_after_start` and falls
      // through as a 500 on purpose. Note what that asks of the caller: `at` is an argument,
      // so the moment is *theirs* to supply, and supplying one earlier than the start is the
      // caller's defect rather than this repository's. It has no clock of its own to correct
      // them with — the use case that finishes a trip is the one holding the clock.
      if (idOrNull(id) === null || idOrNull(actorId) === null) return null

      const [row] = await db
        .update(trips)
        .set({ finishedAt: at })
        .where(ownedBy(id, actorId))
        .returning()
      return row ? toTrip(row) : null
    },
  }
}
