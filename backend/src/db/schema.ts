import {
  bigint,
  char,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { currencySchema } from '@molvia/model'
import type { Currency, EventPayload } from '@molvia/model'

/**
 * The lists live in `packages/model` as zod enums; here they become the text of a CHECK.
 * Written as raw SQL rather than through `inArray` so the generated migration carries
 * literals instead of parameters — a migration cannot bind them.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]) {
  const literals = values.map((value) => `'${value}'`).join(', ')
  return sql`${column} in (${sql.raw(literals)})`
}

/**
 * An append-only log of what cannot be reconstructed from domain tables. Nothing reads it
 * except the gate queries, and nothing updates or deletes from it.
 */
export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    // The key is real, not by agreement: a log that points at a nonexistent actor is the
    // same broken row as any other, and the gate queries group by exactly this column.
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<EventPayload | Record<string, never>>().notNull().default({}),
  },
  (table) => [
    // The gate queries walk one actor's history, then filter a type over a window.
    index('events_actor_occurred_idx').on(table.actorId, table.occurredAt),
    index('events_type_occurred_idx').on(table.type, table.occurredAt),
  ],
)

/**
 * Identity and settings are one entity: the relation is strictly 1:1 and settings cannot
 * exist without the person. The device identifier lands here in MOL-8, «my rate» in MOL-40.
 *
 * No default on `id`: the server issues it (Р-3 of MOL-4), and a database default would be
 * a second place that does.
 */
export const actors = pgTable(
  'actors',
  {
    id: uuid('id').primaryKey(),
    country: char('country', { length: 2 }).notNull(),
    city: varchar('city', { length: 120 }).notNull(),
    /** Currency travels beside every amount: without it the minor exponent is unknown. */
    spendCurrency: char('spend_currency', { length: 3 }).$type<Currency>().notNull(),
    incomeCurrency: char('income_currency', { length: 3 }).$type<Currency>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('actors_country_iso', sql`${table.country} ~ '^[A-Z]{2}$'`),
    check('actors_spend_currency_known', oneOf(table.spendCurrency, currencySchema.options)),
    check('actors_income_currency_known', oneOf(table.incomeCurrency, currencySchema.options)),
  ],
)
