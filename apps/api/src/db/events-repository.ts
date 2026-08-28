import { sql } from 'drizzle-orm'
import type { CatalogueSubject, EventPayload, EventType } from '@molvia/model'
import type { Db } from './index'
import { events } from './schema'

export interface RecordedEvent {
  readonly actorId: string
  readonly type: EventType
  readonly payload?: EventPayload
  /** Only ever passed by tests, which have to place events in the past. */
  readonly occurredAt?: Date
}

export interface CohortReturn {
  readonly cohortSize: number
  readonly returned: number
}

export interface EventRepository {
  record(event: RecordedEvent): Promise<void>
  /** Gate 0.3: of those first seen in a window, how many came back in their fourth week. */
  weekFourReturn(subject: CatalogueSubject, from: Date, to: Date): Promise<CohortReturn>
}

// A repository is a function over a connection, not a module-level singleton: the
// integration tests point it at their own database, and the composition point in
// server.ts points it at the real one.
export function createEventRepository(db: Db): EventRepository {
  return {
    async record(event) {
      await db.insert(events).values({
        actorId: event.actorId,
        type: event.type,
        payload: event.payload ?? {},
        ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
      })
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
