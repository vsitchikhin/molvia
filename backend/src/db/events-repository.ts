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
   * Records the event unless this actor already has one of this type within the window —
   * `true` when a row was written. One statement, measured by the database's clock, the same
   * clock `occurred_at` is stamped with. Two calls in the same instant may both write; the
   * gates count distinct actors, so that costs them nothing.
   */
  recordUnlessWithin(event: RecordedEvent, windowMs: number): Promise<boolean>
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

    async recordUnlessWithin(event, windowMs) {
      const payload = 'payload' in event ? event.payload : {}
      const rows = await db.execute<{ id: string }>(sql`
        insert into ${events} (actor_id, type, payload)
        select ${event.actorId}::uuid, ${event.type}, ${JSON.stringify(payload)}::jsonb
        where not exists (
          select 1 from ${events}
          where actor_id = ${event.actorId}::uuid
            and type = ${event.type}
            and occurred_at > now() - make_interval(secs => ${windowMs / 1000})
        )
        returning id
      `)
      return rows.length > 0
    },

    async weekFourReturn(subject, from, to) {
      // "Fourth week" is counted from each actor's own first event, not from a calendar
      // week: the threshold asks whether a person came back, and people arrive on
      // different days.
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
            and e.occurred_at >= c.started + interval '21 days'
            and e.occurred_at < c.started + interval '28 days'
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
