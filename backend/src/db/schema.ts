import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { EventPayload } from '@molvia/model'

/**
 * An append-only log of what cannot be reconstructed from domain tables. Nothing reads it
 * except the gate queries, and nothing updates or deletes from it.
 *
 * actor_id carries no foreign key on purpose: there is no user table yet, and the log
 * must not become the reason to invent one before the feature that needs it.
 */
export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<EventPayload>().notNull().default({}),
  },
  (table) => [
    // The gate queries walk one actor's history, then filter a type over a window.
    index('events_actor_occurred_idx').on(table.actorId, table.occurredAt),
    index('events_type_occurred_idx').on(table.type, table.occurredAt),
  ],
)
