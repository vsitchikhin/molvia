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
import { baseUnitSchema, currencySchema, itemKindSchema } from '@molvia/model'
import type { BaseUnit, Currency, EventPayload, ItemKind } from '@molvia/model'

/**
 * The lists live in `packages/model` as zod enums; here they become the text of a CHECK.
 * Written as raw SQL rather than through `inArray` so the generated migration carries
 * literals instead of parameters — a migration cannot bind them.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]) {
  const literals = values.map((value) => `'${value}'`).join(', ')
  return sql`${column} in (${sql.raw(literals)})`
}

/** A quantity unit is nullable in several tables; the list is the same everywhere. */
function unitKnownOrNull(column: AnyPgColumn) {
  return sql`${column} is null or ${oneOf(column, baseUnitSchema.options)}`
}

/** Pieces do not come in halves — the same rule `quantitySchema` refuses in the domain. */
function wholePieces(unit: AnyPgColumn, milli: AnyPgColumn) {
  return sql`${unit} is distinct from 'piece' or ${milli} % 1000 = 0`
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

/**
 * The catalogue is shared by everyone: a verdict travels with the person, only prices are
 * tied to a city. `search_key` is the Latin form from `toSearchKey` (MOL-5) and it, not
 * `name`, carries the index — «moloko» scores 0.000 against «молоко».
 *
 * There is deliberately no unique index on `search_key`: the fork fold of MOL-5 merges
 * genuinely different names on purpose, and merging duplicate entries is a 0.2 question.
 */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').$type<ItemKind>().notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    searchKey: varchar('search_key', { length: 800 }).notNull(),
    note: varchar('note', { length: 300 }),
    defaultUnit: text('default_unit').$type<BaseUnit>().notNull(),
    typicalQtyMilli: bigint('typical_qty_milli', { mode: 'bigint' }),
    typicalQtyUnit: text('typical_qty_unit').$type<BaseUnit>(),
    /** null for a seeded item — it belongs to nobody. */
    createdBy: uuid('created_by').references((): AnyPgColumn => actors.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('items_search_key_trgm_idx').using('gin', table.searchKey.op('gin_trgm_ops')),
    check('items_kind_known', oneOf(table.kind, itemKindSchema.options)),
    check('items_default_unit_known', oneOf(table.defaultUnit, baseUnitSchema.options)),
    // A number without its unit means nothing, so the two travel together or not at all.
    check(
      'items_typical_quantity_paired',
      sql`(${table.typicalQtyMilli} is null) = (${table.typicalQtyUnit} is null)`,
    ),
    check(
      'items_typical_quantity_positive',
      sql`${table.typicalQtyMilli} is null or ${table.typicalQtyMilli} > 0`,
    ),
    check('items_typical_quantity_unit_known', unitKnownOrNull(table.typicalQtyUnit)),
    check(
      'items_typical_quantity_whole_pieces',
      wholePieces(table.typicalQtyUnit, table.typicalQtyMilli),
    ),
  ],
)

/**
 * A table rather than a column: one item comes in several packagings, and a repeating
 * group inside a column breaks first normal form. The code is the key — one barcode
 * belongs to one item — so a surrogate id would only add a second uniqueness over the
 * first. «No more than twenty per item» stays a domain rule: it needs a trigger, and a
 * trigger for 0.2 is not worth owning.
 */
export const itemBarcodes = pgTable(
  'item_barcodes',
  {
    code: varchar('code', { length: 14 }).primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('item_barcodes_item_idx').on(table.itemId),
    // The four lengths a GTIN has — EAN-8, UPC-A, EAN-13, GTIN-14, the same shape the
    // domain schema checks. A range of 8..14 quietly accepts a mistyped nine digits.
    check('item_barcodes_gtin_shape', sql`${table.code} ~ '^([0-9]{8}|[0-9]{12,14})$'`),
  ],
)
