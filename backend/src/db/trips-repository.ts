import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { DomainError, ERROR, tripSchema } from '@molvia/model'
import type { Currency, ExchangeRate, NewTrip, Trip } from '@molvia/model'
import { rateFrom, rateTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit, theRow } from './rows'
import { trips } from './schema'

/** A trip to start, named by the device that starts it (MOL-21, В-2). */
export type TripToStart = NewTrip & { readonly id: string }

export interface TripRepository {
  /**
   * The currency is a snapshot of the person's setting and the rate a snapshot of the
   * moment: neither is looked up again later, or last month's total would move with
   * today's rate. Whether that rate is plausible — and that its `asOf` is not from the
   * future — belongs to the use case, which is the only place with a clock.
   *
   * **One open trip per person** (MOL-21, В-4): another unfinished trip refuses with
   * `TRIP_OPEN`, because which of the two goes on is the person's choice, not the server's.
   * The same identifier again is a repeat — a double tap, a queue sent twice — and returns the
   * trip already there with `created: false`, finished or not. The same identifier under
   * someone else is `CONFLICT`.
   *
   * Held here under a lock per owner rather than by a partial unique index (В-10): the rule is
   * about the screen, not about whether a row is readable. So rows written around this method —
   * a fixture, a restore — can still hold two open trips, and `latestUnfinishedFor` still has
   * to answer for them.
   */
  start(
    actorId: string,
    input: TripToStart,
    currency: Currency,
    rate: ExchangeRate | null,
  ): Promise<{ trip: Trip; created: boolean }>
  byId(id: string, actorId: string): Promise<Trip | null>
  /**
   * The most recent trip that has not been finished. Several trips a day, yes; several open at
   * once, no — `start` refuses the second (MOL-21, В-4). Rows written around it can still hold
   * two, and then the newer one is current.
   */
  latestUnfinishedFor(actorId: string): Promise<Trip | null>
  listFor(actorId: string, limit: number): Promise<Trip[]>
  /**
   * The moment comes from the database unless one is handed in, and that default is the
   * whole point: `started_at` is stamped by `clock_timestamp()` in microseconds, while a
   * `Date` out of JS can only name the start of a millisecond. A trip finished inside the
   * millisecond it started therefore landed *before* its own start, and
   * `trips_finished_after_start` refused it — rarely on a laptop, almost always on a CI
   * runner, where nothing slows the two calls apart.
   *
   * `at` stays for the case that genuinely has its own moment: a trip closed after the
   * fact. A moment earlier than the start is still refused, and that is still the caller's
   * defect rather than this repository's.
   *
   * Finishing twice moves nothing (MOL-21): a repeat from a queue is not a later finish, and
   * the moment a trip ended is a fact. The trip comes back as it was.
   */
  finish(id: string, actorId: string, at?: Date): Promise<Trip | null>
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
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          // Per owner: two «Начать поход» at once — a double tap after the screen lost its
          // state — would otherwise both see no open trip and both write one.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext('trips'), hashtext(${actorId}))`,
          )

          const [same] = await tx.select().from(trips).where(eq(trips.id, input.id)).limit(1)
          if (same) {
            if (same.actorId !== actorId) throw new DomainError(ERROR.CONFLICT)
            return { trip: toTrip(same), created: false }
          }

          const [open] = await tx
            .select({ id: trips.id })
            .from(trips)
            .where(and(eq(trips.actorId, actorId), isNull(trips.finishedAt)))
            .limit(1)
          if (open) throw new DomainError(ERROR.TRIP_OPEN)

          // A stranger's insert of the same identifier is not under this lock, so the
          // primary key has the last word: `23505`, translated to CONFLICT like above.
          const [row] = await tx
            .insert(trips)
            .values({ id: input.id, actorId, placeId: input.placeId, currency, ...rateTo(rate) })
            .returning()
          return { trip: toTrip(theRow(row, 'trips')), created: true }
        }),
      )
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
      // through as a 500 on purpose — a moment someone supplies can be wrong. Without one,
      // the row is stamped by the same clock that stamped its start, so the two are
      // comparable by construction rather than by luck.
      if (idOrNull(id) === null || idOrNull(actorId) === null) return null

      const [row] = await db
        .update(trips)
        .set({ finishedAt: at ?? sql`clock_timestamp()` })
        .where(and(ownedBy(id, actorId), isNull(trips.finishedAt)))
        .returning()
      if (row) return toTrip(row)

      const [finished] = await db.select().from(trips).where(ownedBy(id, actorId)).limit(1)
      return finished ? toTrip(finished) : null
    },
  }
}
