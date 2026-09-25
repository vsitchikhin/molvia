import {
  bigint,
  boolean,
  char,
  check,
  date,
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
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  DEVICE_NAME_MAX,
  EVENT,
  LOGIN_CODE_MAX,
  baseUnitSchema,
  catalogueSubjectSchema,
  currencySchema,
  eventTypeSchema,
  itemKindSchema,
  placeKindSchema,
  rateChoiceSchema,
  rateProviderSchema,
  ratePreferenceSchema,
  rateSourceSchema,
} from '@molvia/model'
import type {
  BaseUnit,
  Currency,
  EventPayload,
  ItemKind,
  PlaceKind,
  AmdRate,
  RateChoice,
  RateProvider,
  RatePreference,
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

/**
 * What counts as blank, in one place. Plain `btrim` strips only the ASCII space, so a name
 * padded with a zero-width space or a BOM would slip past it — and the schema would hold two
 * different definitions of «invisible», one for the search key and another for a place.
 */
const BLANKS = String.raw` \t\r\n\u00A0\u200B\u200C\u200D\uFEFF`

/**
 * Variation selectors, which choose how the character before them is drawn and never which
 * character it is: «Кафе ☕» and «Кафе ☕» with VS16 are one café, typed on two keyboards. The
 * name keeps them, so the emoji is drawn as it was typed; the identity drops them (MOL-21,
 * adversarial round 3, Б). Anywhere in the name, not only at the ends.
 */
const SELECTORS = String.raw`[\uFE00-\uFE0F\U000E0100-\U000E01EF]`

/**
 * The identity of a place as the unique index below computes it. Its twin in TypeScript is
 * `placeNameIdentity` in `packages/model`, for the screen that has to know the same thing with
 * no request to make; an integration test runs a corpus through both and holds them equal.
 *
 * Exported because the repository has to repeat it word for word: `ON CONFLICT` infers an index over expressions
 * only from the very same expressions, and naming the columns instead answers `42P10` on the
 * first duplicate \u2014 measured in the review of MOL-6. One definition, two call sites, so the
 * index and the conflict target cannot drift apart.
 */
export function placeIdentity(value: AnyPgColumn | SQL): SQL {
  return sql`btrim(lower(regexp_replace(normalize(${value}, NFKC), E'${sql.raw(SELECTORS)}', '', 'g')), E'${sql.raw(BLANKS)}')`
}

/** The same fold applied to a value rather than to a column — what a query compares against. */
export function identityOf(value: string): SQL {
  // `::text` on purpose: `normalize()` takes text, and a bare parameter arrives as unknown.
  return placeIdentity(sql`${value}::text`)
}

/**
 * A `sha256` written down as hex, which is the only shape either digest column ever holds.
 * Same rule twice, so the two cannot drift into meaning different things.
 */
function hexDigest(column: AnyPgColumn) {
  return sql`${column} ~ '^[0-9a-f]{64}$'`
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
      // `advice_viewed` carries the same axis as `catalogue_viewed` and is checked by the
      // same shape: the gate splits products from venues whichever screen was opened.
      sql`(${table.type} not in (${list([EVENT.CATALOGUE_VIEWED, EVENT.ADVICE_VIEWED])})
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
    /**
     * The external identity a person comes back by (MOL-52). `bigint` because Telegram long
     * outgrew 32 bits, `mode: 'number'` because it promised never to outgrow 52 — the two
     * CHECKs below are that promise, held by the database rather than by whoever writes the
     * next insert.
     */
    telegramUserId: bigint('telegram_user_id', { mode: 'number' }).notNull(),
    country: char('country', { length: 2 }).notNull(),
    city: varchar('city', { length: 120 }).notNull(),
    /** Currency travels beside every amount: without it the minor exponent is unknown. */
    spendCurrency: char('spend_currency', { length: 3 }).$type<Currency>().notNull(),
    incomeCurrency: char('income_currency', { length: 3 }).$type<Currency>().notNull(),
    /**
     * Until when other people's data is visible to this person (MOL-31, Р-9). «How much
     * access someone has» is «until what date»: ten ratings buying a month, a dollar buying
     * one, and a grant made by hand all land in the same column, so the paid layer of 0.2
     * needs no second migration. Empty and a past date mean the same thing — nothing of
     * anyone else's — and the boundary is exactly «now», which is the domain's to decide
     * (`hasSharedAccess`), not a default here.
     */
    sharedUntil: timestamp('shared_until', { withTimezone: true }),
    /**
     * Which rate a new trip takes (MOL-40, В-3): `personal` — the person's own, from their
     * exchanges, when there is one for the pair, and the official one otherwise — or always
     * `official`. Beside the settings rather than among them: it is switched on the screen of
     * exchanges, and the form of MOL-65 compares its four fields and nothing else.
     */
    ratePreference: text('rate_preference').$type<RatePreference>().notNull().default('personal'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Moved by a trigger, not by drizzle: `$onUpdate` lives in the query builder, so raw
    // SQL — the main instrument in this directory — would leave the column behind.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // «One Telegram account, one owner» — the whole point of the column, and a statement
    // about *other rows*, which only the database can make.
    unique('actors_telegram_user_id_key').on(table.telegramUserId),
    check('actors_telegram_user_id_positive', sql`${table.telegramUserId} > 0`),
    // A row JSON could not carry back without distorting it must not exist at all: the first
    // to notice otherwise would be somebody's browser, not this server. 2^53.
    check('actors_telegram_user_id_safe', sql`${table.telegramUserId} < 9007199254740992`),
    check('actors_country_iso', sql`${table.country} ~ '^[A-Z]{2}$'`),
    check('actors_spend_currency_known', oneOf(table.spendCurrency, currencySchema.options)),
    check('actors_income_currency_known', oneOf(table.incomeCurrency, currencySchema.options)),
    check(
      'actors_rate_preference_known',
      oneOf(table.ratePreference, ratePreferenceSchema.options),
    ),
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
    check('items_search_key_present', sql`btrim(${table.searchKey}, E'${sql.raw(BLANKS)}') <> ''`),
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
     * only one where the difference can be deliberate. `btrim` comes after `normalize`
     * on purpose and takes the same `BLANKS` the search key does: NFKC turns a no-break
     * space into an ordinary one, and the zero-width ones it leaves alone — so « SAS »,
     * «\u200BSAS» and «SAS\uFEFF» all stop being second shops on the paths that bypass the
     * domain's own `.trim()`. All three are immutable, so the uniqueness lives in the index
     * and no column is added: the transliterated key («Гюмри» against `Gyumri`) stays Р-15's.
     */
    uniqueIndex('places_identity_key').on(
      table.kind,
      table.country,
      placeIdentity(table.city),
      placeIdentity(table.name),
    ),
    check('places_kind_known', oneOf(table.kind, placeKindSchema.options)),
    check('places_country_iso', sql`${table.country} ~ '^[A-Z]{2}$'`),
  ],
)

/**
 * Currency and rate are snapshots, spread over columns instead of pointing at a rate
 * table: a reference would let today's rate rewrite last month's trip, which is exactly
 * what «the rate is stored with the transaction» forbids. The plausibility band of a rate
 * is not checked here — the real check is disagreement with the official rate (MOL-40).
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
    // Who published the snapshot (MOL-22): the source says it is not the central bank of
    // Armenia, and the screen has to name the one it is instead.
    rateProvider: text('rate_provider').$type<RateProvider>(),
    // When the snapshotted rate jumped (MOL-39, Р-19, Р-21): the flag, the rate before the jump
    // and the person's own — each the snapshot's pair, so only a number and a date — and which
    // one the person chose to count by. The snapshot itself is never rewritten.
    rateJumped: boolean('rate_jumped').notNull().default(false),
    ratePreviousScaled: bigint('rate_previous_scaled', { mode: 'bigint' }),
    ratePreviousAsOf: timestamp('rate_previous_as_of', { withTimezone: true }),
    rateManualScaled: bigint('rate_manual_scaled', { mode: 'bigint' }),
    rateManualAsOf: timestamp('rate_manual_as_of', { withTimezone: true }),
    rateChoice: text('rate_choice').$type<RateChoice>(),
    // `clock_timestamp()`, not `now()`: `now()` is the moment the *transaction* started, one
    // value shared by every row written inside it. `Conn` exists so a caller can write a trip
    // and its first expense together (MOL-21), and under `now()` those rows would carry the
    // same instant exactly — leaving the order to the tie-break, which is a random uuid. The
    // screen then shows a list in an order unrelated to the one things were added in, and it
    // does so *stably*, so the wrong order never flickers and never gets noticed.
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    finishedOnDeviceAt: timestamp('finished_on_device_at', { withTimezone: true }),
  },
  (table) => [
    // The list of trips, the running one, and «what is still unrated» all walk one actor
    // in time order.
    index('trips_actor_started_idx').on(table.actorId, table.startedAt),
    // «Что брали» walks one actor's finished trips newest first, by the time the device named
    // and the server's where there is none — the expression the history orders and pages by.
    // Without it every page sorts all of that actor's trips again, which is exactly what the
    // cursor exists to avoid (MOL-25, Б2). Partial, because the query always says so.
    index('trips_actor_finished_idx')
      .on(
        table.actorId,
        sql`coalesce(${table.finishedOnDeviceAt}, ${table.finishedAt}) desc`,
        sql`${table.id} desc`,
      )
      .where(sql`${table.finishedAt} is not null`),
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
      'trips_rate_provider_known',
      sql`${table.rateProvider} is null or ${oneOf(table.rateProvider, rateProviderSchema.options)}`,
    ),
    // A publisher for every published rate, and none for a rate nobody published — and the two
    // say the same thing: the source *is* the publisher («official» is the central bank of
    // Armenia and nothing else), so «fallback by cba» or «official by erapi» is not a state but a
    // contradiction (MOL-22, В2-11). On a personal rate and on no rate at all the second
    // expression is null and the check passes.
    check(
      'trips_rate_provider_matches_source',
      sql`(${table.rateSource} is null or ${table.rateSource} = 'personal') = (${table.rateProvider} is null)
        and ((${table.rateSource} = 'official') = (${table.rateProvider} = 'cba')) is not false`,
    ),
    check(
      'trips_rate_source_known',
      sql`${table.rateSource} is null or ${oneOf(table.rateSource, rateSourceSchema.options)}`,
    ),
    // Not a plausibility band — that one is the domain's (RATE_MIN, RATE_MAX), and so it stays.
    // Zero and negative are outside any band there could be: a snapshot is written once and
    // never recomputed, so a zero makes last month free and a negative flips its sign, both
    // as arithmetic rather than as an error.
    check('trips_rate_positive', sql`${table.rateScaled} is null or ${table.rateScaled} > 0`),
    check(
      'trips_rate_jumped_needs_rate',
      sql`not ${table.rateJumped} or ${table.rateScaled} is not null`,
    ),
    check(
      'trips_rate_previous_whole',
      sql`num_nonnulls(${table.ratePreviousScaled}, ${table.ratePreviousAsOf}) in (0, 2)`,
    ),
    check(
      'trips_rate_previous_needs_jump',
      sql`${table.ratePreviousScaled} is null or (${table.rateJumped} and ${table.ratePreviousScaled} > 0)`,
    ),
    check(
      'trips_rate_manual_whole',
      sql`num_nonnulls(${table.rateManualScaled}, ${table.rateManualAsOf}) in (0, 2)`,
    ),
    check(
      'trips_rate_manual_needs_jump',
      sql`${table.rateManualScaled} is null or (${table.rateJumped} and ${table.rateManualScaled} > 0)`,
    ),
    check(
      'trips_rate_choice_known',
      sql`${table.rateChoice} is null or ${oneOf(table.rateChoice, rateChoiceSchema.options)}`,
    ),
    // A choice needs a jump, and names a rate the trip holds.
    check(
      'trips_rate_choice_held',
      sql`${table.rateChoice} is null or (${table.rateJumped} and (${table.rateChoice} <> 'previous' or ${table.ratePreviousScaled} is not null) and (${table.rateChoice} <> 'manual' or ${table.rateManualScaled} is not null))`,
    ),
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
    // `clock_timestamp()` for the same reason `trips.started_at` has it: this column is the
    // sort key of the trip screen, and under `now()` every expense written in one
    // transaction would share one instant, leaving the order to a random uuid.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
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
    ratedAt: timestamp('rated_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    /**
     * Moved by `verdicts_touch_updated_at`, a trigger, so every write path moves it — the
     * column exists so a re-rating leaves a trace, and `verdicts_updated_after_rated` is a
     * tautology while it stands still. Triggers are invisible to drizzle-kit and live in a
     * hand-written part of the migration.
     *
     * The default is `clock_timestamp()` — the trigger already uses it, and this column is
     * the sort key of «Что брать». Under `now()` verdicts written in one transaction would
     * all carry one instant and be ordered by a random uuid.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    /**
     * A withdrawn verdict stays a row (MOL-27, the owner's decision): the 0.2 gate asks
     * whether someone reached five ratings in their first two weeks, and «rated five, took
     * one back» has to stay five. So **the gate counts every row, and every other reader
     * counts only `deleted_at IS NULL`** — «Что брать», the verdict itself, and the
     * aggregates of 0.3. A reader that forgets the filter puts a withdrawn opinion back on
     * screen, silently. Rating again clears it on the same row, keeping `rated_at`.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
    check('verdicts_deleted_after_rated', sql`${table.deletedAt} >= ${table.ratedAt}`),
    // The row outlives the withdrawal for the gate, which needs only that it existed and
    // when. The text does not: someone who deleted their review expects it gone, and keeping
    // it would be a promise nobody made. Held here so no write path can forget it.
    check(
      'verdicts_withdrawn_without_review',
      sql`${table.deletedAt} is null or ${table.review} is null`,
    ),
  ],
)

/**
 * How long a remembered query may be, in octets. One number for the column, its CHECK and the
 * repository that decides a query is not worth remembering — three places that would drift.
 */
export const QUERY_KEY_MAX_OCTETS = 600

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
    queryKey: varchar('query_key', { length: QUERY_KEY_MAX_OCTETS }).notNull(),
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
    check(
      'search_picks_query_key_indexable',
      sql`octet_length(${table.queryKey}) <= ${sql.raw(String(QUERY_KEY_MAX_OCTETS))}`,
    ),
  ],
)

/**
 * The official rates as their providers published them: one currency against the dram per
 * day (MOL-39). Not pairs — no provider publishes those, and a stored pair would be a number
 * already divided and already rounded. The pair is built when a trip snapshots it.
 *
 * A cache and nothing more: a trip copies the rate into its own columns, so rewriting a row
 * here — a provider correcting itself — moves no trip that already started.
 */
export const officialRates = pgTable(
  'official_rates',
  {
    provider: text('provider').$type<RateProvider>().notNull(),
    currency: char('currency', { length: 3 }).$type<AmdRate['currency']>().notNull(),
    rateDate: date('rate_date').notNull(),
    // Drams per one unit, at RATE_SCALE — whatever «per 100» the provider printed is divided out.
    scaled: bigint('scaled', { mode: 'bigint' }).notNull(),
    // Over a quarter away from the provider's recent rates when it arrived (MOL-39, Р-19): kept,
    // since it may be true, and a trip that takes it lets the person choose.
    jump: boolean('jump').notNull().default(false),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Also the index «the latest row not after this day» walks, provider and currency first.
    primaryKey({ columns: [table.provider, table.currency, table.rateDate] }),
    check('official_rates_provider_known', oneOf(table.provider, rateProviderSchema.options)),
    check(
      'official_rates_currency_foreign',
      sql`${oneOf(table.currency, currencySchema.options)} and ${table.currency} <> 'AMD'`,
    ),
    check('official_rates_positive', sql`${table.scaled} > 0`),
  ],
)

/**
 * Money changed from one currency into another (MOL-40): the amounts given and received and the
 * day, as the person names them. The rate is not a column — it is what the two amounts say, and
 * the person's own rate is computed from these rows when a trip starts, never stored beside them.
 *
 * Private and nobody else's reader: no aggregate reads it and the log of events does not either.
 * Cascade from the owner, unlike trips and verdicts: those are data other rules still count, and
 * this is one person's record of their own money with no reader but them.
 */
export const exchanges = pgTable(
  'exchanges',
  {
    // Named by the device, as a trip is: a tap sent twice is one exchange.
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    givenMinor: bigint('given_minor', { mode: 'bigint' }).notNull(),
    givenCurrency: char('given_currency', { length: 3 }).$type<Currency>().notNull(),
    receivedMinor: bigint('received_minor', { mode: 'bigint' }).notNull(),
    receivedCurrency: char('received_currency', { length: 3 }).$type<Currency>().notNull(),
    // A day in Yerevan, as the rates are dated — the person names the day, not the minute.
    exchangedOn: date('exchanged_on').notNull(),
    // How much of the received currency was held just before; in that currency, so no column
    // of its own. Null is «not said», which is not zero (MOL-40, В-2).
    heldBeforeMinor: bigint('held_before_minor', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    // Removed, but still offered back (owner's decision В-5): «Вернуть» clears this and the row
    // keeps its `created_at` — the order of a day and the hint both read it, and writing the
    // exchange anew moved both (adversarial round 2, В1, В2). The owner's next request removes
    // such rows for good: by then the screen no longer offers them back.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // The owner's exchanges in the order the wallet walks them.
    index('exchanges_actor_day_idx').on(table.actorId, table.exchangedOn, table.createdAt),
    check('exchanges_given_positive', sql`${table.givenMinor} > 0`),
    check('exchanges_received_positive', sql`${table.receivedMinor} > 0`),
    check(
      'exchanges_held_not_negative',
      sql`${table.heldBeforeMinor} is null or ${table.heldBeforeMinor} >= 0`,
    ),
    check('exchanges_given_currency_known', oneOf(table.givenCurrency, currencySchema.options)),
    check(
      'exchanges_received_currency_known',
      oneOf(table.receivedCurrency, currencySchema.options),
    ),
    check('exchanges_currencies_differ', sql`${table.givenCurrency} <> ${table.receivedCurrency}`),
  ],
)

/**
 * A live way into an account, and nothing else (MOL-52).
 *
 * The token is not here — only `sha256` of it in hex, which is what makes «the token is in the
 * database only as a hash» a property of the table rather than of whoever writes the next
 * insert. sha256 without a salt is the right tool and not a shortcut: the token is 32 bytes of
 * `randomBytes`, so there is no dictionary to make expensive, and the hash has to be
 * deterministic or the unique index below could not find it.
 *
 * Revoking is deleting the row (Р-4). A `revoked_at` would be a column every later query had to
 * remember, and the first one that forgot would quietly let a thrown-out device back in — while
 * a deleted row is indistinguishable from an expired and from a nonexistent one for free, which
 * is exactly what MOL-53 has to answer.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    // Cascade, unlike the trips and verdicts of MOL-6: those are data, this is the key to
    // them, and a key must not outlive its owner by a millisecond.
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    /** Short, derived: «iPhone · Safari», never the browser string it came from. */
    deviceName: varchar('device_name', { length: DEVICE_NAME_MAX }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Nothing moves it yet, so until MOL-53 it is a second `created_at` and a device list would
    // be lying if it showed it. MOL-53 writes it, and not on every request — at most once a day.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // The one path every request to the API takes, so it is an index before it is a rule.
    unique('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_actor_idx').on(table.actorId),
    check('sessions_token_hash_hex', hexDigest(table.tokenHash)),
    check('sessions_lifetime_forward', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

/**
 * A login being waited for: the row that turns a link into a bot into a session for the very
 * browser that asked (MOL-52, MOL-54).
 *
 * Two addresses, on purpose (Р-7). `code` travels into Telegram — into a chat, a link preview,
 * someone's forward — so its alphabet is Telegram's. `id` travels in an HTTP path, that is into
 * the access log, so it is a uuid like every other identifier here.
 *
 * `telegram_user_id` carries no foreign key, and that is not an oversight: on a first login the
 * owner does not exist yet. Referential integrity would be telling a lie about the world.
 */
export const loginRequests = pgTable(
  'login_requests',
  {
    id: uuid('id').primaryKey(),
    code: varchar('code', { length: LOGIN_CODE_MAX }).notNull(),
    /** Of the requesting browser's own secret, which rides in its cookie and nowhere else. */
    secretHash: char('secret_hash', { length: 64 }).notNull(),
    /** What the bot shows the person: «sign in on <this>?». Written here because the bot asks
     * before a session exists, and it cannot see the browser (Р-8). */
    deviceName: varchar('device_name', { length: DEVICE_NAME_MAX }),
    telegramUserId: bigint('telegram_user_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set when the session is handed over — and also when «this was not me» puts the request
     * out without confirming it. One answer for both, because there is one reader. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    unique('login_requests_code_key').on(table.code),
    // The length comes from `LOGIN_CODE_MAX` here too, and not as a second 64 typed out: it is
    // Telegram's number, it already decides the column's width and `loginCodeSchema`, and the
    // one place it was written by hand is the one place it could have drifted.
    check(
      'login_requests_code_format',
      sql`${table.code} ~ '^[A-Za-z0-9_-]{1,${sql.raw(String(LOGIN_CODE_MAX))}}$'`,
    ),
    check('login_requests_secret_hash_hex', hexDigest(table.secretHash)),
    check('login_requests_lifetime_forward', sql`${table.expiresAt} > ${table.createdAt}`),
    // The same two bounds `actors` holds: a confirmed request becomes an owner, and a number
    // that could not survive JSON must not reach that point either.
    check(
      'login_requests_telegram_user_id_positive',
      sql`${table.telegramUserId} is null or ${table.telegramUserId} > 0`,
    ),
    check(
      'login_requests_telegram_user_id_safe',
      sql`${table.telegramUserId} is null or ${table.telegramUserId} < 9007199254740992`,
    ),
  ],
)
