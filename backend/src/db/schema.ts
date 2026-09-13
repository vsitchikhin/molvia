import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  EVENT,
  baseUnitSchema,
  catalogueSubjectSchema,
  currencySchema,
  eventTypeSchema,
  itemKindSchema,
  placeKindSchema,
  rateSourceSchema,
} from '@molvia/model'
import type {
  BaseUnit,
  Currency,
  EventPayload,
  ItemKind,
  PlaceKind,
  RateSource,
} from '@molvia/model'

/**
 * The lists live in `packages/model` as zod enums; here they become the text of a CHECK.
 * Written as raw SQL rather than through `inArray` so the generated migration carries
 * literals instead of parameters — a migration cannot bind them.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]) {
  return sql`${column} in (${list(values)})`
}

/** Values as SQL text. Interpolating them directly would emit `$1` into the migration. */
function list(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(', '))
}

function literal(value: string) {
  return sql.raw(`'${value}'`)
}

/** A quantity unit is nullable in several tables; the list is the same everywhere. */
function unitKnownOrNull(column: AnyPgColumn) {
  return sql`${column} is null or ${oneOf(column, baseUnitSchema.options)}`
}

/** Currency is nullable wherever the amount beside it is. */
function currencyKnownOrNull(column: AnyPgColumn) {
  return sql`${column} is null or ${oneOf(column, currencySchema.options)}`
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
    // The domain ties the payload to the type with a discriminated union, for a reason
    // written down in `contracts/events.ts`: the log is append-only, so one event recorded
    // without the axis the gate splits on is a gate measuring less than happened, silently
    // and with nothing to backfill from. `DEFAULT '{}'` handed that hole back — these three
    // take it away again, on the one table CLAUDE.md calls the groundwork of the gates.
    check('events_type_known', oneOf(table.type, eventTypeSchema.options)),
    check('events_payload_is_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      'events_payload_matches_type',
      // Two traps, both met in the making. `payload ->> 'subject'` on an empty object is
      // NULL, and `NULL in (...)` is NULL, which a CHECK lets through — so the key is
      // asserted to be there before its value is compared. And the domain's `strictObject`
      // has to hold here too: `payload - 'subject'` must leave nothing, or an extra key
      // lands in an append-only log with nothing to clean it out with.
      sql`(${table.type} <> ${literal(EVENT.CATALOGUE_VIEWED)}
             or (jsonb_exists(${table.payload}, 'subject')
                 and ${table.payload} ->> 'subject' in (${list(catalogueSubjectSchema.options)})
                 and ${table.payload} - 'subject' = '{}'::jsonb))
          and (${table.type} <> ${literal(EVENT.SESSION_STARTED)}
             or ${table.payload} = '{}'::jsonb)`,
    ),
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
    // Moved by a trigger, not by drizzle: `$onUpdate` lives in the query builder, so raw
    // SQL — the main instrument in this directory — would leave the column behind.
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
    // Redundant as a key — `id` is already unique — and required as one: a verdict points
    // at the pair, so that «a product is rated without a place» is checkable by the
    // database rather than by whoever writes the next use case.
    unique('items_id_kind_key').on(table.id, table.kind),
    check('items_kind_known', oneOf(table.kind, itemKindSchema.options)),
    // An empty key is a row the catalogue cannot reach: search compares against this column
    // and nothing else. The blanks are listed rather than left to plain `btrim`, which only
    // strips the ASCII space — a key of one no-break space would pass and the item would be
    // unfindable forever. The rule is a floor, not a normalisation: `'   k   '` passes,
    // because the middle of a key is content. `visibleLine` stays the domain's.
    check(
      'items_search_key_present',
      sql`btrim(${table.searchKey}, E' \\t\\r\\n\\u00A0\\u200B\\u200C\\u200D\\uFEFF') <> ''`,
    ),
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

/**
 * `kind` is part of the key, not decoration: SAS in Yerevan is both a supermarket and a
 * café, one name over two different things. The key is exact — «Гюмри» and `Gyumri` stay
 * two cities until a normalised key is worth its migration (Р-15).
 */
export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').$type<PlaceKind>().notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    country: char('country', { length: 2 }).notNull(),
    city: varchar('city', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Identity, not spelling. Exact uniqueness let «SAS» and «sas» — and «Ёлки» written
     * with U+0401 against the same word with U+0415 U+0308 — become two places that look
     * identical on screen, and with them two price histories for one shop, which is the
     * product's key splitting in half. NFKC rather than NFC so that «ＳＡＳ» in fullwidth
     * folds too; homoglyphs («SАS» with a Cyrillic А) are the one spelling left, and the
     * only one where the difference can be deliberate. `lower` and `normalize` are
     * immutable, so the uniqueness lives in the index and no column is added: the
     * transliterated key («Гюмри» against `Gyumri`) stays Р-15's.
     */
    uniqueIndex('places_identity_key').on(
      table.kind,
      table.country,
      sql`lower(normalize(${table.city}, NFKC))`,
      sql`lower(normalize(${table.name}, NFKC))`,
    ),
    check('places_kind_known', oneOf(table.kind, placeKindSchema.options)),
    check('places_country_iso', sql`${table.country} ~ '^[A-Z]{2}$'`),
  ],
)

/**
 * Currency and rate are snapshots, spread over columns instead of pointing at a rate
 * table: a reference would let today's rate rewrite last month's trip, which is exactly
 * what «the rate is stored with the transaction» forbids. The plausibility band of a rate
 * is not checked here — the real check is disagreement with the official rate (MOL-39).
 */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    rateBase: char('rate_base', { length: 3 }).$type<Currency>(),
    rateQuote: char('rate_quote', { length: 3 }).$type<Currency>(),
    rateScaled: bigint('rate_scaled', { mode: 'bigint' }),
    rateSource: text('rate_source').$type<RateSource>(),
    rateAsOf: timestamp('rate_as_of', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    // The list of trips, the running one, and «what is still unrated» all walk one actor
    // in time order.
    index('trips_actor_started_idx').on(table.actorId, table.startedAt),
    // «Where is it cheaper» joins expenses to trips to places and filters by city: this is
    // the one foreign key of 0.1 that a product query walks, not merely a delete.
    index('trips_place_idx').on(table.placeId),
    check('trips_currency_known', oneOf(table.currency, currencySchema.options)),
    // Half a snapshot is worse than none: it reads as a rate and converts by nothing.
    check(
      'trips_rate_all_or_none',
      sql`num_nonnulls(${table.rateBase}, ${table.rateQuote}, ${table.rateScaled}, ${table.rateSource}, ${table.rateAsOf}) in (0, 5)`,
    ),
    check(
      'trips_rate_quote_is_trip_currency',
      sql`${table.rateQuote} is null or ${table.rateQuote} = ${table.currency}`,
    ),
    check(
      'trips_rate_two_currencies',
      sql`${table.rateBase} is null or ${table.rateBase} <> ${table.rateQuote}`,
    ),
    check('trips_rate_base_known', currencyKnownOrNull(table.rateBase)),
    check('trips_rate_quote_known', currencyKnownOrNull(table.rateQuote)),
    check(
      'trips_rate_source_known',
      sql`${table.rateSource} is null or ${oneOf(table.rateSource, rateSourceSchema.options)}`,
    ),
    // Not a plausibility band — that one is MOL-39's, and its numbers stay in the domain.
    // Zero and negative are outside any band there could be: a snapshot is written once and
    // never recomputed, so a zero makes last month free and a negative flips its sign, both
    // as arithmetic rather than as an error.
    check('trips_rate_positive', sql`${table.rateScaled} is null or ${table.rateScaled} > 0`),
    check(
      'trips_finished_after_start',
      sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
  ],
)

/**
 * Everything but the item may be empty: «I do not know the weight, so I do not enter it».
 * The currency is its own and is only prefilled from the trip — paying for one thing by
 * card in another currency is an ordinary afternoon.
 *
 * No uniqueness on «item + place»: a second price for the same pair is a new observation,
 * and «where is it cheaper» exists because there are many of them.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    qtyMilli: bigint('qty_milli', { mode: 'bigint' }),
    qtyUnit: text('qty_unit').$type<BaseUnit>(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    amountCurrency: char('amount_currency', { length: 3 }).$type<Currency>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('expenses_trip_idx').on(table.tripId),
    // «Where is it cheaper» and the unit price walk every expense of one item.
    index('expenses_item_idx').on(table.itemId),
    check(
      'expenses_quantity_paired',
      sql`(${table.qtyMilli} is null) = (${table.qtyUnit} is null)`,
    ),
    check('expenses_quantity_positive', sql`${table.qtyMilli} is null or ${table.qtyMilli} > 0`),
    check('expenses_quantity_unit_known', unitKnownOrNull(table.qtyUnit)),
    check('expenses_quantity_whole_pieces', wholePieces(table.qtyUnit, table.qtyMilli)),
    // The exponent of a minor unit is a property of the currency, so the amount is
    // unreadable without it — the pair travels together or not at all.
    check(
      'expenses_amount_paired',
      sql`(${table.amountMinor} is null) = (${table.amountCurrency} is null)`,
    ),
    check(
      'expenses_amount_not_negative',
      sql`${table.amountMinor} is null or ${table.amountMinor} >= 0`,
    ),
    check('expenses_amount_currency_known', currencyKnownOrNull(table.amountCurrency)),
  ],
)

/**
 * Keyed on the item, not on «item + place»: the same milk in every shop, only the price
 * differs. `place_id` is null for a product and filled for a dish in 0.3 — which is why
 * the uniqueness is NULLS NOT DISTINCT. A plain UNIQUE counts two nulls as different and
 * would let a second verdict on the same product in, silently, so a re-rating would
 * become a second vote instead of replacing the first.
 */
export const verdicts = pgTable(
  'verdicts',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id),
    itemId: uuid('item_id').notNull(),
    /**
     * A copy of `items.kind`, held true by the composite foreign key below. Not a new fact
     * and not a domain field: the only way to say «this place belongs to this kind of
     * item» inside one row, and a CHECK cannot look at another table.
     */
    itemKind: text('item_kind').$type<ItemKind>().notNull(),
    placeId: uuid('place_id').references(() => places.id),
    score: smallint('score').notNull(),
    review: varchar('review', { length: 500 }),
    ratedAt: timestamp('rated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Moved by `verdicts_touch_updated_at`, a trigger, so every write path moves it — the
     * column exists so a re-rating leaves a trace, and `verdicts_updated_after_rated` is a
     * tautology while it stands still. Triggers are invisible to drizzle-kit and live in a
     * hand-written part of the migration.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * `NO ACTION`, deliberately, where a cascade would read better and lie: the kind
     * travelling into a verdict always meets the place rule below — a product's verdict has
     * no place, a dish's has one — so it can never arrive. An item with even one verdict has
     * an immutable kind, and that is a decision about the verdicts, not about the catalogue.
     */
    foreignKey({
      columns: [table.itemId, table.itemKind],
      foreignColumns: [items.id, items.kind],
      name: 'verdicts_item_id_kind_fk',
    }),
    unique('verdicts_actor_item_place_key')
      .on(table.actorId, table.itemId, table.placeId)
      .nullsNotDistinct(),
    // Without this, one person rates the same product twice — once with an empty place and
    // once with a place — and the average counts both. The uniqueness above cannot see it:
    // the two rows differ in `place_id`.
    check(
      'verdicts_place_matches_kind',
      sql`(${table.itemKind} = 'product') = (${table.placeId} is null)`,
    ),
    // The average score of an item is read across everyone's verdicts.
    index('verdicts_item_idx').on(table.itemId),
    check('verdicts_score_range', sql`${table.score} between 1 and 5`),
    check('verdicts_updated_after_rated', sql`${table.updatedAt} >= ${table.ratedAt}`),
  ],
)

/**
 * A query and the item chosen after it, so the pair comes up first next time. No domain
 * type: it never crosses the wire and takes part in no rule — it is server-side ranking
 * machinery, and the labelled set anything smarter would later need.
 *
 * The stored column is the search key, not the raw query: the same question typed in
 * another script or with the other half of a transliteration fork is a different string
 * and would never match itself. Writing and reading it is MOL-11; here it is only a place.
 */
export const searchPicks = pgTable(
  'search_picks',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id),
    // 600, not 800 like `items.search_key`: the primary key is a btree row and stops at
    // 2704 bytes. The column now says what it actually takes; the CHECK below stays for the
    // alphabets `toSearchKey` keeps as they are, where one character is four octets.
    queryKey: varchar('query_key', { length: 600 }).notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    picks: integer('picks').notNull().default(1),
    lastPickedAt: timestamp('last_picked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.queryKey, table.itemId] }),
    check('search_picks_counted', sql`${table.picks} > 0`),
    // The key is a btree row, and a btree row stops at 2704 bytes: 800 four-byte code
    // points would overflow it with `54000`, an error about index internals rather than
    // about the query. The cap makes the refusal say what it is — and MOL-11, which writes
    // here, is the one that decides how long a query is worth remembering.
    check('search_picks_query_key_indexable', sql`octet_length(${table.queryKey}) <= 600`),
  ],
)
