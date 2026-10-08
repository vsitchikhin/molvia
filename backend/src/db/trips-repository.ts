import { and, desc, eq, gt, inArray, isNull, isNotNull, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  DomainError,
  ERROR,
  INT8_MAX,
  TRIP_HISTORY_PAGE_SIZE,
  TRIP_UNDO_MINUTES,
  tripSchema,
} from '@molvia/model'
import type {
  TripHistory,
  TripHistoryCursor,
  Currency,
  ExchangeRate,
  Money,
  NewTrip,
  RateChoice,
  RateProvider,
  Trip,
} from '@molvia/model'
import { rateFrom, rateTo, sideRateFrom } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit, theRow } from './rows'
import { expenses, trips, places } from './schema'
import { forgetWordsOf } from './store-memory-repository'
import { tripMoneyRows } from './trip-money'
import type { TripMoneyRow } from './trip-money'

/**
 * The rate a trip is started with, as the trip keeps it: who published it, whether it jumped when
 * it arrived, and the rate before the jump (MOL-39, Р-19, Р-21; MOL-22, Р-3). An `OfficialRate`
 * is one; `provider` is null only for the person's own rate, from their exchanges (MOL-40).
 */
export interface TripSnapshot {
  readonly rate: ExchangeRate
  /**
   * Who published it — `null` only for the person's own rate, from their exchanges (MOL-40).
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
export type TripToStart = NewTrip & {
  readonly id: string
  /** The phone's today at the tap (MOL-121), already judged; none from an old queue. */
  readonly startedOn?: string | null
}

/** A trip recorded from a receipt (MOL-126): its place, the receipt's day, and its moment if printed. */
export interface RecordedTrip {
  readonly id: string
  readonly placeId: string
  readonly day: string
  readonly deviceAt: Date | null
}

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
   * someone else is `CONFLICT`, and so is a trip of one's own removed less than ten minutes ago
   * (MOL-76): «Вернуть» brings it back, a start sent again does not. Past its ten minutes the
   * removal is final whether or not the timer has come round, and the start writes it anew.
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
  /**
   * The owner's lock of trips, to the end of the caller's transaction (MOL-126): «Записать» takes it
   * before it looks for the same receipt recorded, so two shots of one receipt recorded at once see
   * each other.
   */
  lockOwner(actorId: string): Promise<void>
  /**
   * A trip from a receipt (MOL-126): written finished, dated by the receipt's day for «Деньги» and the
   * accounts alike, at the rate of that day, with the receipt's sum whole (MOL-78). It is never the
   * open trip, so another one open does not stand in its way. A trip of this id already there is a
   * 409: a receipt recorded again is answered by the receipt, before this is called.
   */
  recordFinished(
    actorId: string,
    input: RecordedTrip,
    currency: Currency,
    snapshot: TripSnapshot | null,
    receipt: Money | null,
  ): Promise<Trip>
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
  finish(
    id: string,
    actorId: string,
    at?: Date,
    deviceAt?: Date,
    deviceDay?: string,
  ): Promise<Trip | null>
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
  /**
   * «Сумма по чеку» (MOL-78): the receipt's sum whole, or none, and the moment it changed — what a
   * check and the hint of an exchange date it by. Whether it changed at all is the use case's to
   * decide under `lock`: a repeat must move neither the moment nor «списано».
   */
  setReceipt(id: string, actorId: string, receipt: Money | null): Promise<Trip | null>
  /**
   * «Удалить поход» (MOL-76): marked, and from then on no reader but erasure and the minute timer
   * sees it. `false` when it is not the owner's — a stranger's, a missing one, one already final.
   * Marking a marked one again is `true` and moves nothing: a repeat from the queue.
   */
  remove(id: string, actorId: string): Promise<boolean>
  /**
   * «Вернуть» within ten minutes — `null` past them or for a trip that is not the owner's; a trip
   * never removed comes back as it is. An unfinished trip while another is open is `TRIP_OPEN`:
   * two open trips is the state `start` exists to refuse (Р-4) — unless it comes back finished
   * (`finish`, round 3 В1), which is one statement, so no moment holds two open trips.
   */
  restore(
    id: string,
    actorId: string,
    finish?: { deviceAt?: Date; deviceDay?: string },
  ): Promise<Trip | null>
  /** The minute timer: removals past their ten minutes deleted, their purchases by cascade. */
  purgeStale(): Promise<void>
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
    accountId: row.accountId,
    debited:
      row.debitedMinor === null || row.debitedCurrency === null
        ? null
        : { minor: row.debitedMinor, currency: row.debitedCurrency },
    receipt:
      row.receiptMinor === null || row.receiptCurrency === null
        ? null
        : { minor: row.receiptMinor, currency: row.receiptCurrency },
  })
}

/**
 * A trip belongs to one person, so the owner is a condition and never a later check — and a removed
 * one belongs to nobody but erasure and the timer (MOL-76), so the mark is part of the same condition.
 */
function ownedBy(id: string, actorId: string) {
  return and(eq(trips.id, id), eq(trips.actorId, actorId), isNull(trips.deletedAt))
}

function undoFrom() {
  return sql`clock_timestamp() - make_interval(mins => ${TRIP_UNDO_MINUTES})`
}

/** Per owner: a start, a removal and a «Вернуть» see one another's open trip (MOL-21, MOL-76). */
/**
 * The lines of trips `which` (on `trips` aliased `t`) whose removal is final: what `forgetWordsOf` takes
 * before they are deleted, and their receipts with them (MOL-240).
 */
function removedForGood(which: SQL) {
  return sql`e.trip_id in (select t.id from trips t where t.deleted_at <= ${undoFrom()} and ${which})`
}

function ownerLock(tx: Conn, actorId: string) {
  return tx.execute(sql`select pg_advisory_xact_lock(hashtext('trips'), hashtext(${actorId}))`)
}

export function createTripRepository(db: Conn): TripRepository {
  /**
   * «12 позиций · 9 870 ֏» of every row on a page of the history (MOL-128, В-4): how many
   * purchases, and what the trip came to — by the one rule of a trip's money (`tripMoneyRows`,
   * MOL-78): the receipt's sum when there is one, else one sum per currency of the priced
   * purchases, a purchase with no price counting as a purchase and adding nothing. Two statements
   * for the page, after it, so the order and the cursor stay the history's own.
   */
  async function purchasesOf(
    tripIds: readonly string[],
  ): Promise<Map<string, { itemCount: number; total: Money[] | null }>> {
    const counted = new Map<string, { itemCount: number; total: Money[] | null }>()
    if (tripIds.length === 0) return counted
    const chosen = sql`t.id in (${sql.join(
      tripIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`
    const [counts, sums] = await Promise.all([
      db
        .select({ tripId: expenses.tripId, items: sql<number>`count(*)::int` })
        .from(expenses)
        .where(inArray(expenses.tripId, [...tripIds]))
        .groupBy(expenses.tripId),
      db.execute<TripMoneyRow>(sql`
        select m.trip_id, m.currency, m.minor
          from (${tripMoneyRows(chosen)}) m
         order by m.trip_id, m.currency
      `),
    ])
    const entryOf = (tripId: string) => {
      const entry = counted.get(tripId) ?? { itemCount: 0, total: [] }
      counted.set(tripId, entry)
      return entry
    }
    for (const row of counts) entryOf(row.tripId).itemCount = row.items
    for (const row of sums) {
      const entry = entryOf(row.trip_id)
      const minor = BigInt(row.minor)
      // A sum no amount can carry — only an absurd entry makes one — is unknown rather than a
      // failure of the whole page: the cursor could never walk past it (review, MOL-128).
      entry.total =
        entry.total && minor <= INT8_MAX
          ? [...entry.total, { minor, currency: row.currency }]
          : null
    }
    return counted
  }

  return {
    async start(actorId, input, currency, snapshot) {
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          // Per owner: two «Начать поход» at once — a double tap after the screen lost its
          // state — would otherwise both see no open trip and both write one.
          await ownerLock(tx, actorId)

          // Past its ten minutes a removal is final, and the same name is a new trip (MOL-76).
          await forgetWordsOf(
            tx,
            removedForGood(sql`t.id = ${input.id} and t.actor_id = ${actorId}`),
          )
          await tx
            .delete(trips)
            .where(
              and(
                eq(trips.id, input.id),
                eq(trips.actorId, actorId),
                lte(trips.deletedAt, undoFrom()),
              ),
            )
          const [same] = await tx.select().from(trips).where(eq(trips.id, input.id)).limit(1)
          if (same) {
            if (same.actorId !== actorId || same.deletedAt !== null) {
              throw new DomainError(ERROR.CONFLICT)
            }
            return { trip: toTrip(same), created: false }
          }

          const [open] = await tx
            .select({ id: trips.id })
            .from(trips)
            .where(
              and(eq(trips.actorId, actorId), isNull(trips.finishedAt), isNull(trips.deletedAt)),
            )
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
              startedOn: input.startedOn ?? null,
            })
            .returning()
          return { trip: toTrip(theRow(row, 'trips')), created: true }
        }),
      )
    },

    async lockOwner(actorId) {
      await ownerLock(db, actorId)
    },

    async recordFinished(actorId, input, currency, snapshot, receipt) {
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          await ownerLock(tx, actorId)
          await forgetWordsOf(
            tx,
            removedForGood(sql`t.id = ${input.id} and t.actor_id = ${actorId}`),
          )
          await tx
            .delete(trips)
            .where(
              and(
                eq(trips.id, input.id),
                eq(trips.actorId, actorId),
                lte(trips.deletedAt, undoFrom()),
              ),
            )
          // One moment for the start and the end: the trip is written whole, and «finished after
          // started» holds by its own row.
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
              startedAt: sql`now()`,
              finishedAt: sql`now()`,
              finishedOnDeviceAt: input.deviceAt,
              startedOn: input.day,
              finishedOn: input.day,
              receiptMinor: receipt?.minor ?? null,
              receiptCurrency: receipt?.currency ?? null,
              receiptSetAt: receipt === null ? null : sql`now()`,
              receiptFirstAt: receipt === null ? null : sql`now()`,
            })
            .onConflictDoNothing({ target: trips.id })
            .returning()
          if (row === undefined) throw new DomainError(ERROR.CONFLICT)
          return toTrip(row)
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
        .where(and(eq(trips.actorId, actorId), isNull(trips.finishedAt), isNull(trips.deletedAt)))
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
        .where(and(eq(trips.actorId, actorId), isNull(trips.deletedAt)))
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
          fromReceipt: sql<boolean>`exists (select 1 from receipts r where r.trip_id = ${trips.id})`,
          cursorAt: sql<string>`to_char(${time} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(trips)
        .innerJoin(places, eq(places.id, trips.placeId))
        .where(
          and(
            eq(trips.actorId, actorId),
            isNotNull(trips.finishedAt),
            isNull(trips.deletedAt),
            cursor
              ? sql`(${time}, ${trips.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(sql`${time} desc`, desc(trips.id))
        .limit(TRIP_HISTORY_PAGE_SIZE + 1)
      const page = rows.slice(0, TRIP_HISTORY_PAGE_SIZE)
      const last = page.at(-1)
      const sums = await purchasesOf(page.map((row) => row.id))
      return {
        trips: page.map(({ id, place, startedAt, finishedAt, finishedOnDeviceAt, fromReceipt }) => {
          if (!finishedAt) throw new Error('history contained an unfinished trip')
          const counted = sums.get(id)
          return {
            id,
            place,
            startedAt,
            finishedAt,
            finishedOnDeviceAt,
            itemCount: counted?.itemCount ?? 0,
            total: counted ? counted.total : [],
            fromReceipt,
          }
        }),
        nextCursor:
          rows.length > TRIP_HISTORY_PAGE_SIZE && last ? { at: last.cursorAt, id: last.id } : null,
      }
    },

    async finish(id, actorId, at, deviceAt, deviceDay) {
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
        .set({
          finishedAt: at ?? sql`clock_timestamp()`,
          finishedOnDeviceAt: deviceAt ?? null,
          finishedOn: deviceDay ?? null,
        })
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

    async setReceipt(id, actorId, receipt) {
      if (idOrNull(id) === null || idOrNull(actorId) === null) return null
      const [row] = await db
        .update(trips)
        .set({
          receiptMinor: receipt?.minor ?? null,
          receiptCurrency: receipt?.currency ?? null,
          receiptSetAt: sql`clock_timestamp()`,
          // Kept by an amendment, cleared with the sum: a new sum after «Убрать» is a new receipt.
          receiptFirstAt: receipt
            ? sql`coalesce(${trips.receiptFirstAt}, clock_timestamp())`
            : null,
        })
        .where(ownedBy(id, actorId))
        .returning()
      return row ? toTrip(row) : null
    },

    async remove(id, actorId) {
      if (idOrNull(id) === null || idOrNull(actorId) === null) return false
      return db.transaction(async (tx) => {
        await ownerLock(tx, actorId)
        const [row] = await tx
          .update(trips)
          // `coalesce`: a repeat keeps the first moment, so it cannot stretch the ten minutes.
          .set({ deletedAt: sql`coalesce(${trips.deletedAt}, clock_timestamp())` })
          .where(
            and(
              eq(trips.id, id),
              eq(trips.actorId, actorId),
              or(isNull(trips.deletedAt), gt(trips.deletedAt, undoFrom())),
            ),
          )
          .returning({ id: trips.id })
        return row !== undefined
      })
    },

    async restore(id, actorId, finish) {
      if (idOrNull(id) === null || idOrNull(actorId) === null) return null
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          await ownerLock(tx, actorId)
          const [held] = await tx
            .select()
            .from(trips)
            .where(
              and(
                eq(trips.id, id),
                eq(trips.actorId, actorId),
                // Past its time a removal is final even before the timer comes round.
                or(isNull(trips.deletedAt), gt(trips.deletedAt, undoFrom())),
              ),
            )
            .limit(1)
            .for('update')
          if (!held) return null
          const finishing = finish !== undefined && held.finishedAt === null
          if (held.deletedAt === null && !finishing) return toTrip(held)
          if (held.finishedAt === null && !finishing) {
            const [open] = await tx
              .select({ id: trips.id })
              .from(trips)
              .where(
                and(eq(trips.actorId, actorId), isNull(trips.finishedAt), isNull(trips.deletedAt)),
              )
              .limit(1)
            if (open) throw new DomainError(ERROR.TRIP_OPEN)
          }
          const [row] = await tx
            .update(trips)
            .set({
              deletedAt: null,
              // The same stamp `finish` gives: the database's clock, and the device's moment beside it.
              ...(finishing
                ? {
                    finishedAt: sql`clock_timestamp()`,
                    finishedOnDeviceAt: finish.deviceAt ?? null,
                    finishedOn: finish.deviceDay ?? null,
                  }
                : {}),
            })
            .where(eq(trips.id, id))
            .returning()
          return toTrip(theRow(row, 'trips'))
        }),
      )
    },

    async purgeStale() {
      await db.transaction(async (tx) => {
        await forgetWordsOf(tx, removedForGood(sql`true`))
        await tx
          .delete(trips)
          .where(and(isNotNull(trips.deletedAt), lte(trips.deletedAt, undoFrom())))
      })
    },
  }
}
