import { sql } from 'drizzle-orm'
import type { CatalogueSubject, EventInput } from '@molvia/model'
import type { Conn } from './index'
import { events } from './schema'

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
}

export interface EventRepository {
  record(event: RecordedEvent): Promise<void>
  /**
   * Records the event unless this actor already has the same one — same type, same payload —
   * in the current day of their own life: days counted from their first event, exactly as
   * `weekFourReturn` counts weeks. `true` when a row was written.
   *
   * Not a rolling 24 hours from the last row: that window slid across the gate's week line, and
   * a visit early in week four was swallowed by an evening in week three — a person who came
   * back counted as one who did not. Days of the person's own life never straddle a week of
   * the gate, so one row per such day loses nothing the gate reads. The payload takes part so
   * the product and venue halves never hide each other's visits.
   *
   * Serialised per actor by a transaction-scoped advisory lock: the screen searches on every
   * keystroke, and two overlapping requests would otherwise both see no row and both write.
   */
  recordOncePerDay(event: RecordedEvent): Promise<boolean>
  /** Gate 0.3: of those first seen in a window, how many came back in their fourth week. */
  weekFourReturn(subject: CatalogueSubject, from: Date, to: Date): Promise<CohortReturn>
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
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('events'), hashtext(${event.actorId}))`,
        )
        const rows = await tx.execute<{ id: string }>(sql`
          with first_seen as (
            select min(occurred_at) as started from ${events} where actor_id = ${event.actorId}::uuid
          )
          insert into ${events} (actor_id, type, payload)
          select ${event.actorId}::uuid, ${event.type}, ${payload}::jsonb
          where not exists (
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

    async weekFourReturn(subject, from, to) {
      // "Fourth week" is counted from each actor's own first event, not from a calendar
      // week: the threshold asks whether a person came back, and people arrive on
      // different days. In hours, not days: `interval '1 day'` is a calendar day in the
      // session's time zone — 23 or 25 hours across a daylight-saving change — and the days
      // of `recordOncePerDay` have to fall on exactly these weeks. Hours mean the same in
      // every zone, so neither depends on a `timezone` someone sets later.
      const rows = await db.execute<{ cohort_size: number; returned: number }>(sql`
        with first_seen as (
          select actor_id, min(occurred_at) as started
          from ${events}
          group by actor_id
        ),
        cohort as (
          select actor_id, started
          from first_seen
          where started >= ${from.toISOString()}::timestamptz
            and started <  ${to.toISOString()}::timestamptz
        ),
        came_back as (
          select distinct c.actor_id
          from cohort c
          join ${events} e on e.actor_id = c.actor_id
          where e.type = 'catalogue_viewed'
            and e.payload ->> 'subject' = ${subject}
            and e.occurred_at >= c.started + interval '504 hours'
            and e.occurred_at < c.started + interval '672 hours'
        )
        select
          (select count(*) from cohort)::int as cohort_size,
          (select count(*) from came_back)::int as returned
      `)

      const row = rows[0]
      return { cohortSize: row?.cohort_size ?? 0, returned: row?.returned ?? 0 }
    },
  }
}
