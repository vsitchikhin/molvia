import { eq, sql } from 'drizzle-orm'
import { EVENT, STATISTICS_CONSENT_EDITION } from '@molvia/model'
import type { AnalyticsSetting, CatalogueSubject, EventInput } from '@molvia/model'
import type { Conn } from './index'
import { actors, events } from './schema'

// The type and its payload travel together, so a catalogue view cannot be recorded
// without the axis the 0.3 gate splits on.
export type RecordedEvent = EventInput & {
  readonly actorId: string
  /** Only ever passed by tests, which have to place events in the past. */
  readonly occurredAt?: Date
}

export interface CohortReturn {
  readonly cohortSize: number
  readonly returned: number
  /**
   * Their fourth week is not over yet, with access or without: no answer yet, not in the cohort
   * (MOL-91). Whether they will have had access is not known until then — it can still be granted.
   */
  readonly pending: number
  /**
   * Their fourth week is over, and no access reached it: not in the cohort (Р-24). A fact, not a
   * forecast — decided only for those whose window has closed (adversarial А).
   */
  readonly withoutAccess: number
  /**
   * Their fourth week is over and access reached it, but they have not accepted the edition that asks
   * consent to the statistics (MOL-236): no log was written for them. Out of both halves, named.
   */
  readonly withoutConsent: number
  /**
   * Their fourth week is over, access reached it and they consented, but they objected to being counted (MOL-96):
   * off now, or back on only after that week began — its rows erased or never written. Out of both
   * halves, or the rate fell with every objection and read «stop» for a reason unrelated to the
   * hypothesis; named, so how many the cohort lost to objections is seen.
   */
  readonly optedOut: number
}

export interface EventRepository {
  record(event: RecordedEvent): Promise<void>
  /**
   * Records the event unless this actor already has the same one — same type, same payload —
   * in the current day of their own life: days counted from `actors.created_at`, exactly as
   * `weekFourReturn` counts weeks from it. `true` when a row was written.
   *
   * Not a rolling 24 hours from the last row: that window slid across the gate's week line, and
   * a visit early in week four was swallowed by an evening in week three — a person who came
   * back counted as one who did not. Days of the person's own life never straddle a week of
   * the gate, so one row per such day loses nothing the gate reads. The payload takes part so
   * the product and venue halves never hide each other's visits.
   *
   * Serialised per actor by a transaction-scoped advisory lock: the screen searches on every
   * keystroke, and two overlapping requests would otherwise both see no row and both write.
   *
   * Nothing is written for someone who has turned «Учитывать меня в статистике» off (MOL-96), nor
   * for someone who has not accepted the edition that asks consent to it (MOL-236).
   */
  recordOncePerDay(event: RecordedEvent): Promise<boolean>
  /** «Учитывать меня в статистике» (MOL-96): whether the person has objected to being counted. */
  analyticsOf(actorId: string): Promise<AnalyticsSetting>
  /**
   * Turns «Учитывать меня в статистике» off or back on (MOL-96). Off erases every row of the
   * person's log at once (В-1) — the second written exception to append-only, after erasure
   * (MOL-58): the gates stop counting them, so the rows have no reader left, and a consent withdrawn
   * (edition 2, MOL-236) takes what it gathered with it. Back on, the log starts afresh from that
   * moment, and gate 0.3 counts the person only if their fourth week began after it (Р-3).
   *
   * Under the lock of `recordOncePerDay`: a visit being written as the switch goes off either
   * lands before the erasure and goes with it, or waits and finds the objection.
   * The same choice again moves no moment.
   */
  chooseAnalytics(actorId: string, off: boolean): Promise<AnalyticsSetting>
  /**
   * Gate 0.3: of those who appeared in a window, how many came back in their fourth week —
   * and came back *to read other people's data*, which is what the threshold actually asks.
   *
   * It counts `advice_viewed` (MOL-31, Р-15), not `catalogue_viewed`. The search wrote that
   * one while nothing on any screen came from anyone else, so it meant «came back to enter a
   * purchase»; once «Что брать» shows other people's figures, the visit that answers this
   * gate is the one to that screen. The rows the search already wrote stay where they are —
   * the log is append-only — and nothing reads them.
   *
   * The cohort comes from `actors.created_at`, not from a first event (Р-20). With one writer
   * left, and that one behind a paid door, «first event» had become «first paid view»: a
   * person without access never entered the denominator at all, and one with access had their
   * fourth week counted from the day they paid. The gate would then have measured return
   * among those who already bought — a threshold selected on the very thing it tests, and one
   * that could no longer say «no». Reading a domain table is not what the log's rule forbids;
   * duplicating it into the log is, which is why MOL-8's `session_started` stays withdrawn.
   *
   * **And only those whose access reached their fourth week** (Р-24). The numerator stays
   * behind that same door, so a denominator of everyone who ever appeared counted people who
   * had nothing to come back to. The condition is read from `actors.shared_until` and is
   * approximate — see the statement, where the direction of the error is written down.
   *
   * **And only those whose fourth week is over** (MOL-91), the rule gate 0.2 already kept (MOL-51).
   * Counted before, a person who came last week read as one who did not come back — and the more
   * people arrive, the harder that pulls the gate towards «stop». The ones still waiting are
   * named beside the cohort, not in it; so are those without access.
   *
   * **And not those who never consented, nor those who objected** (MOL-236, MOL-96): out of both
   * halves, each named beside them — or every one of them lowered the rate and nothing said why.
   */
  weekFourReturn(subject: CatalogueSubject, from: Date, to: Date): Promise<CohortReturn>
}

/** One person's log, held by its writer and by the switch that stops it (MOL-96). */
function lockLog(actorId: string) {
  return sql`select pg_advisory_xact_lock(hashtext('events'), hashtext(${actorId}))`
}

// A repository is a function over a connection, not a module-level singleton: the
// integration tests point it at their own database, and the composition point in
// server.ts points it at the real one.
export function createEventRepository(db: Conn): EventRepository {
  return {
    async record(event) {
      await db.insert(events).values({
        actorId: event.actorId,
        type: event.type,
        payload: 'payload' in event ? event.payload : {},
        ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
      })
    },

    async recordOncePerDay(event) {
      const payload = JSON.stringify('payload' in event ? event.payload : {})
      return db.transaction(async (tx) => {
        await tx.execute(lockLog(event.actorId))
        const rows = await tx.execute<{ id: string }>(sql`
          -- From when the person appeared, not from their first event (MOL-31, Р-20). While
          -- the log had a writer on the first visit the two were the same day; now the only
          -- writer is «Что брать» in the shared mode, so a first event is a paid view — and
          -- the days of this window have to fall on the weeks the gate counts.
          with first_seen as (
            select ${actors.createdAt} as started from ${actors} where ${actors.id} = ${event.actorId}::uuid
          )
          insert into ${events} (actor_id, type, payload)
          select ${event.actorId}::uuid, ${event.type}, ${payload}::jsonb
          -- An objection stops the log (MOL-96), and so does a consent never given (MOL-236): the
          -- log rests on the consent of edition 2, not on an interest Armenia's law has not got.
          -- Read after the lock, so a switch turned off meanwhile is seen; a person who is not
          -- there still fails on the foreign key.
          where not exists (
            select 1 from ${actors}
            where ${actors.id} = ${event.actorId}::uuid
              and (${actors.analyticsOffAt} is not null
                or ${actors.consentVersion} is null
                or ${actors.consentVersion} < ${STATISTICS_CONSENT_EDITION}::int)
          )
          and not exists (
            select 1 from ${events} e, first_seen f
            where e.actor_id = ${event.actorId}::uuid
              and e.type = ${event.type}
              and e.payload = ${payload}::jsonb
              and e.occurred_at >= f.started
                + floor(extract(epoch from now() - f.started) / 86400) * interval '24 hours'
          )
          returning id
        `)
        return rows.length > 0
      })
    },

    async analyticsOf(actorId) {
      const [row] = await db
        .select({ offAt: actors.analyticsOffAt })
        .from(actors)
        .where(eq(actors.id, actorId))
      return { off: (row?.offAt ?? null) !== null }
    },

    async chooseAnalytics(actorId, off) {
      return db.transaction(async (tx) => {
        await tx.execute(lockLog(actorId))
        // The right-hand sides read the row as it was: «back on» is a moment only for someone
        // who was off, and «off» keeps the moment of the first objection.
        const [row] = await tx.execute<{ off: boolean }>(sql`
          update ${actors} set
            analytics_off_at = case when ${off}::boolean then coalesce(analytics_off_at, now()) end,
            analytics_on_at = case
              when not ${off}::boolean and analytics_off_at is not null then now()
              else analytics_on_at
            end
          where ${actors.id} = ${actorId}::uuid
          returning analytics_off_at is not null as off
        `)
        if (off) await tx.delete(events).where(eq(events.actorId, actorId))
        return { off: row?.off ?? off }
      })
    },

    async weekFourReturn(subject, from, to) {
      // "Fourth week" is counted from each actor's own first event, not from a calendar
      // week: the threshold asks whether a person came back, and people arrive on
      // different days. In hours, not days: `interval '1 day'` is a calendar day in the
      // session's time zone — 23 or 25 hours across a daylight-saving change — and the days
      // of `recordOncePerDay` have to fall on exactly these weeks. Hours mean the same in
      // every zone, so neither depends on a `timezone` someone sets later.
      const rows = await db.execute<{
        cohort_size: number
        returned: number
        pending: number
        without_access: number
        without_consent: number
        opted_out: number
      }>(sql`
        with appeared as (
          select ${actors.id} as actor_id, ${actors.createdAt} as started, ${actors.sharedUntil} as shared_until,
            ${actors.analyticsOffAt} as off_at, ${actors.analyticsOnAt} as on_at,
            ${actors.consentVersion} as consent
          from ${actors}
          where ${actors.createdAt} >= ${from.toISOString()}::timestamptz
            and ${actors.createdAt} <  ${to.toISOString()}::timestamptz
        ),
        closed as (
          select actor_id, started, shared_until, off_at, on_at, consent
          from appeared
          -- Time first, access after (MOL-91, adversarial А). A fourth week still going is no
          -- answer yet, as gate 0.2 keeps its open windows out: counted now, a person who came
          -- last week reads as one who did not come back. And whether access reached that week
          -- is not known before it: judged by today's access, a newcomer read «no access in week
          -- 4» eighteen days early, and moved to «waiting» the day access was granted.
          where started + interval '672 hours' <= now()
        ),
        with_access as (
          select actor_id, started, off_at, on_at, consent
          from closed
          -- Only those who could have answered the question (Р-24). The numerator is behind
          -- a paid door — advice_viewed is written in the shared mode alone — so counting
          -- everyone who ever appeared put people in the denominator who had nothing to come
          -- back to, and the threshold read «stop» for a reason unrelated to the hypothesis
          -- (adversarial round 2, G1).
          --
          -- Approximate, and knowingly: there is no history of grants, only the moment
          -- access runs out, and it only ever moves forward. Someone who bought access after
          -- their fourth week is counted as though they had it then, so the denominator errs
          -- large and the return rate errs small — the gate errs towards «stop», which is
          -- the safe side of this particular number. Exactness needs a table of grants, and
          -- that is a task, not a line.
          where shared_until >= started + interval '504 hours'
        ),
        consented as (
          select actor_id, started, off_at, on_at
          from with_access
          -- Only those who accepted the edition that asks consent to the statistics (MOL-236): no log
          -- was written for anyone else. Approximate, as access is: an edition accepted in the middle
          -- of the fourth week leaves its first days unwritten, so the gate errs towards «stop».
          where consent >= ${STATISTICS_CONSENT_EDITION}::int
        ),
        cohort as (
          select actor_id, started
          from consented
          -- Not those who objected to being counted (MOL-96), out of both halves. Back on counts
          -- again only from before the fourth week began: switched off later, that week's rows were
          -- erased, and switched on later, part of it was never written (Р-3).
          where off_at is null
            and (on_at is null or on_at <= started + interval '504 hours')
        ),
        came_back as (
          select distinct c.actor_id
          from cohort c
          join ${events} e on e.actor_id = c.actor_id
          where e.type = ${EVENT.ADVICE_VIEWED}
            and e.payload ->> 'subject' = ${subject}
            and e.occurred_at >= c.started + interval '504 hours'
            and e.occurred_at < c.started + interval '672 hours'
        )
        select
          (select count(*) from cohort)::int as cohort_size,
          (select count(*) from came_back)::int as returned,
          (select count(*) from appeared)::int - (select count(*) from closed)::int as pending,
          (select count(*) from closed)::int - (select count(*) from with_access)::int as without_access,
          (select count(*) from with_access)::int - (select count(*) from consented)::int as without_consent,
          (select count(*) from consented)::int - (select count(*) from cohort)::int as opted_out
      `)

      const row = rows[0]
      return {
        cohortSize: row?.cohort_size ?? 0,
        returned: row?.returned ?? 0,
        pending: row?.pending ?? 0,
        withoutAccess: row?.without_access ?? 0,
        withoutConsent: row?.without_consent ?? 0,
        optedOut: row?.opted_out ?? 0,
      }
    },
  }
}
