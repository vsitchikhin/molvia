import { and, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm'
import { DomainError, ERROR, TRIP_HISTORY_PAGE_SIZE, tripSchema } from '@molvia/model'
import type {
  TripHistory,
  TripHistoryCursor,
  Currency,
  ExchangeRate,
  NewTrip,
  RateChoice,
  RateProvider,
  Trip,
} from '@molvia/model'
import { rateFrom, rateTo, sideRateFrom } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit, theRow } from './rows'
import { trips, places } from './schema'

/**
 * The rate a trip is started with, as the trip keeps it: who published it, whether it jumped when
 * it arrived, and the rate before the jump (MOL-39, Р-19, Р-21; MOL-22, Р-3). An `OfficialRate`
 * is one; `provider` is null only for a rate the person entered themselves, which is MOL-40's.
 */
export interface TripSnapshot {
  readonly rate: ExchangeRate
  /**
   * Who published it — `null` only for a rate the person entered themselves, which is MOL-40's.
   * A discriminated union would say this in the type, and it is not used on purpose: `OfficialRate`
   * carries the wide `RateSource`, so every producer of a snapshot would have to narrow it, and the
   * rule would be stated in three places instead of two. The agreement between this and
   * `rate.source` — `official` is `cba` and nothing else — is held where every write goes through
   * anyway: `tripSchema`'s refine and the `trips_rate_provider_matches_source` check (В2-14).
   */
  readonly provider: RateProvider | null
  readonly jumped: boolean
  readonly previous: ExchangeRate | null
}

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
    snapshot: TripSnapshot | null,
  ): Promise<{ trip: Trip; created: boolean }>
  byId(id: string, actorId: string): Promise<Trip | null>
  /**
   * The trip, locked until the caller's transaction ends — `null` for a stranger's or a missing
   * one. Every write to a trip's rows takes it first, so two of them run one after the other:
   * each checks the total with the other's row in view (MOL-21, adversarial Б), and a change
   * racing a delete meets the delete rather than a list read before it (adversarial Г).
   * Outside a transaction the lock lasts one statement and holds nothing.
   */
  lock(id: string, actorId: string): Promise<Trip | null>
  /**
   * The most recent trip that has not been finished. Several trips a day, yes; several open at
   * once, no — `start` refuses the second (MOL-21, В-4). Rows written around it can still hold
   * two, and then the newer one is current.
   */
  latestUnfinishedFor(actorId: string): Promise<Trip | null>
  listFor(actorId: string, limit: number): Promise<Trip[]>
  history(actorId: string, cursor?: TripHistoryCursor): Promise<TripHistory>
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
  finish(id: string, actorId: string, at?: Date, deviceAt?: Date): Promise<Trip | null>
  /**
   * Which rate a trip counts by, when its snapshot jumped (MOL-39, Р-19, Р-21), and the
   * person's own when that is the choice. The snapshot is not rewritten. Whether the choice is
   * possible is the use case's to check under `lock`; the CHECKs refuse what slips past it.
   */
  chooseRate(
    id: string,
    actorId: string,
    choice: RateChoice,
    manual: ExchangeRate | null,
  ): Promise<Trip | null>
}

type TripRow = typeof trips.$inferSelect

function toTrip(row: TripRow): Trip {
  const snapshot = rateFrom(row)
  return tripSchema.parse({
    id: row.id,
    actorId: row.actorId,
    placeId: row.placeId,
    currency: row.currency,
    rate: snapshot,
    rateProvider: row.rateProvider,
    rateJumped: row.rateJumped,
    previousRate: sideRateFrom(snapshot, row.ratePreviousScaled, row.ratePreviousAsOf),
    manualRate: sideRateFrom(snapshot, row.rateManualScaled, row.rateManualAsOf, 'personal'),
    rateChoice: row.rateChoice,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    finishedOnDeviceAt: row.finishedOnDeviceAt,
  })
}

/** A trip belongs to one person, so the owner is a condition and never a later check. */
function ownedBy(id: string, actorId: string) {
  return and(eq(trips.id, id), eq(trips.actorId, actorId))
}

export function createTripRepository(db: Conn): TripRepository {
  return {
    async start(actorId, input, currency, snapshot) {
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
            .values({
              id: input.id,
              actorId,
              placeId: input.placeId,
              currency,
              ...rateTo(snapshot?.rate ?? null),
              rateProvider: snapshot?.provider ?? null,
              rateJumped: snapshot?.jumped ?? false,
              ratePreviousScaled: snapshot?.previous?.scaled ?? null,
              ratePreviousAsOf: snapshot?.previous?.asOf ?? null,
            })
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

    async lock(id, actorId) {
      if (idOrNull(id) === null || idOrNull(actorId) === null) return null

      const [row] = await db.select().from(trips).where(ownedBy(id, actorId)).limit(1).for('update')
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

    async history(actorId, cursor) {
      const time = sql`coalesce(${trips.finishedOnDeviceAt}, ${trips.finishedAt})`
      const rows = await db
        .select({
          id: trips.id,
          place: { id: places.id, kind: places.kind, name: places.name },
          startedAt: trips.startedAt,
          finishedAt: trips.finishedAt,
          finishedOnDeviceAt: trips.finishedOnDeviceAt,
          cursorAt: sql<string>`to_char(${time} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(trips)
        .innerJoin(places, eq(places.id, trips.placeId))
        .where(
          and(
            eq(trips.actorId, actorId),
            isNotNull(trips.finishedAt),
            cursor
              ? sql`(${time}, ${trips.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(sql`${time} desc`, desc(trips.id))
        .limit(TRIP_HISTORY_PAGE_SIZE + 1)
      const page = rows.slice(0, TRIP_HISTORY_PAGE_SIZE)
      const last = page.at(-1)
      return {
        trips: page.map(({ id, place, startedAt, finishedAt, finishedOnDeviceAt }) => {
          if (!finishedAt) throw new Error('history contained an unfinished trip')
          return { id, place, startedAt, finishedAt, finishedOnDeviceAt }
        }),
        nextCursor:
          rows.length > TRIP_HISTORY_PAGE_SIZE && last ? { at: last.cursorAt, id: last.id } : null,
      }
    },

    async finish(id, actorId, at, deviceAt) {
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
        .set({ finishedAt: at ?? sql`clock_timestamp()`, finishedOnDeviceAt: deviceAt ?? null })
        .where(and(ownedBy(id, actorId), isNull(trips.finishedAt)))
        .returning()
      if (row) return toTrip(row)

      const [finished] = await db.select().from(trips).where(ownedBy(id, actorId)).limit(1)
      return finished ? toTrip(finished) : null
    },

    async chooseRate(id, actorId, choice, manual) {
      if (idOrNull(id) === null || idOrNull(actorId) === null) return null
      const [row] = await db
        .update(trips)
        .set({
          rateChoice: choice,
          ...(manual ? { rateManualScaled: manual.scaled, rateManualAsOf: manual.asOf } : {}),
        })
        .where(ownedBy(id, actorId))
        .returning()
      return row ? toTrip(row) : null
    },
  }
}
