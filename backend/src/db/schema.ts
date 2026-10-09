import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  halfvec,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
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
import type { AnyPgColumn, PgTableExtraConfigValue } from 'drizzle-orm/pg-core'
import {
  BUDGET_PERCENT_MAX,
  DEVICE_NAME_MAX,
  EVENT,
  FEEDBACK_DELIVERY,
  FEEDBACK_NOTICE_KINDS,
  FEEDBACK_KINDS,
  FEEDBACK_PICTURES_MAX,
  FEEDBACK_PICTURE_BYTES_MAX,
  LOCALES,
  LOGIN_CODE_MAX,
  MERGE_SUBJECTS,
  REMINDERS_OFF,
  baseUnitSchema,
  catalogueSubjectSchema,
  currencySchema,
  eventTypeSchema,
  FAILURE_FRAMES,
  FAILURE_NAME_MAX,
  FAILURE_ROUTE_MAX,
  FAILURE_SOURCES,
  OWNER_NOTICE_KINDS,
  exchangeChannelSchema,
  incomeSourceSchema,
  itemKindSchema,
  itemNameLanguageSchema,
  itemOriginSchema,
  marketChannelSchema,
  marketSideSchema,
  placeKindSchema,
  rateChoiceSchema,
  MARKET_CURRENCIES,
  RATE_BASE,
  homeBankOf,
  rateProviderSchema,
  ratePreferenceSchema,
  SALARY_SHIFT_DAY_MAX,
  RECEIPT_CITIES,
  RECEIPT_LAYOUTS,
  rateSourceSchema,
  RECEIPT_PARTS_MAX,
  RECEIPT_PART_BYTES_MAX,
  receiptCountrySchema,
  receiptFailureSchema,
  receiptHeardSchema,
  receiptSourceSchema,
  receiptViaSchema,
  receiptParsedMatchSchema,
  receiptStatusSchema,
  storeMemoryKindSchema,
  SPENDING_CATEGORY_COLOURS,
  spendingPresetSchema,
} from '@molvia/model'
import type {
  ReceiptLayout,
  BaseUnit,
  Currency,
  ItemNameLanguage,
  EventPayload,
  FeedbackDelivery,
  FeedbackKind,
  RemindersOff,
  ExchangeChannel,
  IncomeSource,
  ItemKind,
  ItemOrigin,
  MarketChannel,
  MarketSide,
  PlaceKind,
  AmdRate,
  RateChoice,
  RateProvider,
  RatePreference,
  RateSource,
  AppLocale,
  ReceiptCountry,
  ReceiptFailure,
  ReceiptSource,
  ReceiptVia,
  ReceiptHeard,
  ReceiptParsedMatch,
  ReceiptStatus,
  ReceiptCity,
  StoreMemoryKind,
  SpendingPreset,
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

/**
 * `homeBankOf` of a pair in SQL, written from the model's rule pair by pair (MOL-230): the dinar has
 * two banks by what it is paired with, so a bank per currency no longer says it. Every pair whose
 * bank is not the Central Bank of Armenia is named, so the check of a trip's source can never name
 * another bank than the domain does (MOL-110).
 */
function homeBankSql(base: AnyPgColumn, quote: AnyPgColumn) {
  const pairs = currencySchema.options.flatMap((one) =>
    currencySchema.options.flatMap((other) => {
      const bank = one === other ? 'cba' : homeBankOf(one, other)
      return bank === 'cba'
        ? []
        : [
            sql`when ${base} = ${sql.raw(`'${one}'`)} and ${quote} = ${sql.raw(`'${other}'`)} then ${sql.raw(`'${bank}'`)}`,
          ]
    }),
  )
  return sql`(case ${sql.join(pairs, sql` `)} else 'cba' end)`
}

/** The model's `RATE_BASE` in SQL: the currency a provider's row is quoted in (MOL-230). */
function rateBaseSql(provider: AnyPgColumn) {
  const bases = Object.entries(RATE_BASE).map(
    ([name, base]) => sql`when ${provider} = ${sql.raw(`'${name}'`)} then ${sql.raw(`'${base}'`)}`,
  )
  return sql`(case ${sql.join(bases, sql` `)} end)`
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
    /**
     * When `income_currency` last changed (MOL-42, В-2): a change of the currency of conversion
     * works forwards, so the person's own rate in the new one is built only from exchanges from
     * that day on, and nothing before it is re-counted. Empty for whoever never changed it — then
     * nothing is cut. Set by the settings' own `UPDATE`, in the same statement as the change.
     */
    incomeCurrencySince: timestamp('income_currency_since', { withTimezone: true }),
    /**
     * «Зарплата с … числа — в следующий месяц» (MOL-134, В-3): a salary received on this day of a
     * month or later counts in «Пришло» of the next one, as the owner's sheet does. Empty is off —
     * how every account starts. It moves nothing else: the day of the income, the balances, the
     * person's own rate. Beside the settings rather than among them, as `rate_preference` is: the
     * form of MOL-65 compares its four fields, and those four are also a trip's context (Н-1).
     */
    salaryShiftDay: smallint('salary_shift_day'),
    /**
     * Why the rating reminders are off (MOL-103): `chosen` by the person, `blocked` — they blocked
     * the bot. Empty is on, as every account starts. Here rather than in `rating_reminders`
     * (review Т-3): a ladder with nothing to ask about deletes its row, and the switch would go
     * with it. Beside the settings, as `salary_shift_day` is, and for the same reason (Р-1).
     */
    remindersOff: text('reminders_off').$type<RemindersOff>(),
    /**
     * «Сообщать, что чек разобран» turned off by the person (MOL-129, В-2): a switch of its own on
     * the page «Бот», never the rating reminders'. A block of the bot stays in `reminders_off`.
     */
    receiptNoticesOff: boolean('receipt_notices_off').notNull().default(false),
    /**
     * Since when the person has the bot blocked in Telegram (MOL-129, review №1); empty — not
     * blocked, or not that we heard. Its own column because MOL-103 keeps «chosen» over a block in
     * `reminders_off`, and «чек разобран» must not go to a blocked chat whatever the reminders are.
     */
    botBlockedAt: timestamp('bot_blocked_at', { withTimezone: true }),
    /**
     * Which edition of «Условия использования» and «Данные и приватность» the person accepted, and
     * when (MOL-95): `POLICY_VERSION` of the page they were shown, and the server's moment. Empty for
     * whoever has not accepted any — every owner before this column, who passes the screen once. A
     * later acceptance overwrites both and an earlier one changes nothing; erasure takes them with
     * the row.
     */
    consentVersion: smallint('consent_version'),
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    /**
     * «Учитывать меня в статистике» (MOL-96): since when the person has objected to being counted —
     * the event log stops and its rows go, and neither gate counts them; empty is on, as every
     * account starts. From edition 2 (MOL-236) it is the consent to the statistics: the log is
     * written and the gates count only while it is empty and that edition is accepted.
     */
    analyticsOffAt: timestamp('analytics_off_at', { withTimezone: true }),
    /**
     * When the person last turned it back on (MOL-96, Р-3). Gate 0.3 reads it: someone back on
     * after their fourth week began had that week's rows erased or never written, and counted they
     * would read as not having come back.
     */
    analyticsOnAt: timestamp('analytics_on_at', { withTimezone: true }),
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
    check(
      'actors_salary_shift_day_of_month',
      sql`${table.salaryShiftDay} between 1 and ${sql.raw(String(SALARY_SHIFT_DAY_MAX))}`,
    ),
    check('actors_reminders_off_known', oneOf(table.remindersOff, REMINDERS_OFF)),
    // A version without its moment, or a moment of no version, is a consent nobody can show.
    check(
      'actors_consent_whole',
      sql`(${table.consentVersion} is null) = (${table.consentedAt} is null)`,
    ),
    check('actors_consent_version_positive', sql`${table.consentVersion} >= 1`),
  ],
)

/**
 * The catalogue is shared by everyone: a verdict travels with the person, only prices are
 * tied to a city. `search_key` is the Latin form from `toSearchKey` (MOL-5) and it, not
 * `name`, carries the index — «moloko» scores 0.000 against «молоко».
 *
 * There is deliberately no unique index on `search_key`: the fork fold of MOL-5 merges
 * genuinely different names on purpose; twins are merged by the night (MOL-106), into `merged_into`.
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
    /**
     * Where the item's data may have come from besides its author (MOL-162): `open_food_facts` for
     * one proposed with a code the base named — ODbL, shared on request, and this is what tells it
     * from the rest. Null for everything else, every item before the mark included.
     */
    origin: text('origin').$type<ItemOrigin>(),
    /** null for a seeded item — it belongs to nobody. */
    createdBy: uuid('created_by').references((): AnyPgColumn => actors.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The item this one was merged into (MOL-106), or null. A merged item stays as a trace rather
     * than going: its name is a second name the search finds the survivor by, an id a phone or a
     * bot's button still holds lands on the survivor, a proposal or the seed that writes its name
     * gets the survivor, and `make unmerge` takes the mark off. One step always: a merge into an
     * item that is itself merged is refused, and the traces of an item merged on follow it.
     */
    mergedInto: uuid('merged_into').references((): AnyPgColumn => items.id),
  },
  (table) => [
    index('items_search_key_trgm_idx').using('gin', table.searchKey.op('gin_trgm_ops')),
    index('items_merged_into_idx')
      .on(table.mergedInto)
      .where(sql`${table.mergedInto} is not null`),
    check('items_merged_not_self', sql`${table.mergedInto} <> ${table.id}`),
    // Redundant as a key — `id` is already unique — and required as one: a verdict points
    // at the pair, so that «a product is rated without a place» is checkable by the
    // database rather than by whoever writes the next use case.
    unique('items_id_kind_key').on(table.id, table.kind),
    check('items_kind_known', oneOf(table.kind, itemKindSchema.options)),
    check(
      'items_origin_known',
      sql`${table.origin} is null or ${oneOf(table.origin, itemOriginSchema.options)}`,
    ),
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
    /**
     * Who wrote the code to the item (MOL-100, Р-5): anyone may, and a code written says the person
     * held the package — theirs, as an item's author is. Null for a code written before, or once the
     * person is erased: the code is the catalogue's and stays.
     */
    addedBy: uuid('added_by').references((): AnyPgColumn => actors.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('item_barcodes_item_idx').on(table.itemId),
    // The four lengths a GTIN has — EAN-8, UPC-A, EAN-13, GTIN-14, the same shape the
    // domain schema checks. A range of 8..14 quietly accepts a mistyped nine digits.
    check('item_barcodes_gtin_shape', sql`${table.code} ~ '^([0-9]{8}|[0-9]{12,14})$'`),
  ],
)

/**
 * An item's names in the languages the countries' tills print (MOL-126): «կաթ 3.2%» is «Молоко 3,2%».
 * A receipt line is matched against the names of its country's language; the person's own search is
 * not (yet) — it reads `items.name`. Written by the seed alone: nobody types an Armenian name, and
 * the shop's memory learns the rest.
 */
export const itemNames = pgTable(
  'item_names',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    language: text('language').$type<ItemNameLanguage>().notNull(),
    name: varchar('name', { length: 200 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.language, table.name] }),
    index('item_names_language_idx').on(table.language),
    check('item_names_language_known', oneOf(table.language, itemNameLanguageSchema.options)),
  ],
)

/**
 * The customs headings (ТН ВЭД, four digits) an item may be sold under (MOL-126): an Armenian till
 * prints the heading on the line («0401/1163909»), and it rules out what the line cannot be — no glue
 * is a baby porridge. Written by the seed alone.
 */
export const itemHeadings = pgTable(
  'item_hs',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    hs: char('hs', { length: 4 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.hs] }),
    check('item_hs_four_digits', sql`${table.hs} ~ '^[0-9]{4}$'`),
  ],
)

/**
 * The vector of an item's name, by which search finds it by meaning (MOL-105): «молочка» reaches
 * milk, «овощи» the potato. Made by the API's own model from the name alone, written by one writer
 * — the API's timer, nudged by «Предложить товар» — and never on the way of a write of an item:
 * creating one does not wait for the model and does not fail with it.
 *
 * `model` names the model and its revision (`EMBEDDING_MODEL`): a vector of another model is noise
 * to this one, so a row of another model is computed again and never read meanwhile. One row per
 * item, so the index holds the catalogue once. Nothing here is a person's — neither erasure nor the
 * copy reaches it; the item's own row decides its life.
 */
export const itemEmbeddings = pgTable(
  'item_embeddings',
  {
    itemId: uuid('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'cascade' }),
    model: varchar('model', { length: 100 }).notNull(),
    // Half precision: a sixth digit of a cosine is not what decides a shelf word, and the index is
    // half the size.
    embedding: halfvec('embedding', { dimensions: 768 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('item_embeddings_hnsw_idx').using('hnsw', table.embedding.op('halfvec_cosine_ops')),
  ],
)

/**
 * What Open Food Facts said of a code (MOL-162): the base allows fifteen reads a minute and bans past
 * it, and a code nobody knows is scanned again and again, so both a find and a miss are kept — a find
 * thirty days, a miss seven, decided by the reader. A failure is not a row: it says nothing of the
 * code. A row says that some code was looked up and not by whom, and only the day: no person, no
 * moment, so neither erasure nor the copy of one's data reaches it.
 *
 * `found` is a name worth showing, one for each language of the interface; the size is of the
 * package, in the unit an item is counted in. Keyed by the code as it is written (`writtenBarcode`).
 */
export const openFoodFacts = pgTable(
  'open_food_facts',
  {
    code: varchar('code', { length: 14 }).primaryKey(),
    found: boolean('found').notNull(),
    nameRu: varchar('name_ru', { length: 200 }),
    nameEn: varchar('name_en', { length: 200 }),
    quantityMilli: bigint('quantity_milli', { mode: 'bigint' }),
    quantityUnit: text('quantity_unit').$type<BaseUnit>(),
    fetchedOn: date('fetched_on')
      .notNull()
      .default(sql`current_date`),
  },
  (table) => [
    check('open_food_facts_gtin_shape', sql`${table.code} ~ '^([0-9]{8}|[0-9]{12,14})$'`),
    // A find has a name in every language, a miss has none — never half of one.
    check(
      'open_food_facts_names_found',
      sql`${table.found} = (${table.nameRu} is not null) and ${table.found} = (${table.nameEn} is not null)`,
    ),
    check(
      'open_food_facts_quantity_paired',
      sql`(${table.quantityMilli} is null) = (${table.quantityUnit} is null)`,
    ),
    check('open_food_facts_quantity_found', sql`${table.found} or ${table.quantityMilli} is null`),
    check(
      'open_food_facts_quantity_positive',
      sql`${table.quantityMilli} is null or ${table.quantityMilli} > 0`,
    ),
    // A package's size is a weight or a volume; pieces are never read from the base.
    check(
      'open_food_facts_quantity_unit',
      sql`${table.quantityUnit} is null or ${oneOf(table.quantityUnit, ['kg', 'l'])}`,
    ),
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
    /** The place this one was merged into (MOL-106, from MOL-50), or null — a trace, as an item's. */
    mergedInto: uuid('merged_into').references((): AnyPgColumn => places.id),
  },
  (table) => [
    index('places_merged_into_idx')
      .on(table.mergedInto)
      .where(sql`${table.mergedInto} is not null`),
    check('places_merged_not_self', sql`${table.mergedInto} <> ${table.id}`),
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
 * Where a person's money lies (MOL-115): «Наличные ֏», «Карта ₽». Private as a spending — no
 * aggregate reads it, the log of events does not either — and it goes with its owner. The start is
 * what it held at the end of `start_on`, below zero for a card in debt; the balance is counted, never
 * stored. Removing one with operations is `archived_at` («убран из выбора»), without them a mark
 * offered back for ten minutes, then a delete (MOL-73 В-4).
 */
export const moneyAccounts = pgTable(
  'money_accounts',
  {
    // Named by the device, as everything of one's money is: an account added offline is one.
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    savings: boolean('savings').notNull().default(false),
    startMinor: bigint('start_minor', { mode: 'bigint' }).notNull(),
    startOn: date('start_on').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    // The phone's day it was made on: made on its start day, it starts at `created_at` (MOL-250).
    createdOn: date('created_on').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // What an operation points at: its account is the same owner's — and for money that lands on
    // it or leaves it as it is, of the same currency — held by the database (MOL-115).
    unique('money_accounts_id_actor_unique').on(table.id, table.actorId),
    unique('money_accounts_id_actor_currency_unique').on(table.id, table.actorId, table.currency),
    index('money_accounts_actor_idx').on(table.actorId, table.createdAt),
    check('money_accounts_currency_known', oneOf(table.currency, currencySchema.options)),
    check('money_accounts_revision_positive', sql`${table.revision} > 0`),
  ],
)

/**
 * The account a spending or a trip was paid from, and «списано» (MOL-115, MOL-43 В-3): the account
 * is the owner's own, «списано» is whole, positive, needs an account and is of the account's
 * currency — every one of them a key or a check, not a hope.
 */
function paidFrom(
  name: 'trips' | 'spendings',
  table: {
    actorId: AnyPgColumn
    currency: AnyPgColumn
    accountId: AnyPgColumn
    debitedMinor: AnyPgColumn
    debitedCurrency: AnyPgColumn
  },
) {
  return [
    foreignKey({
      name: `${name}_account_is_owners`,
      columns: [table.accountId, table.actorId],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId],
    }),
    foreignKey({
      name: `${name}_debited_of_account_currency`,
      columns: [table.accountId, table.actorId, table.debitedCurrency],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId, moneyAccounts.currency],
    }),
    check(
      `${name}_debited_whole`,
      sql`num_nonnulls(${table.debitedMinor}, ${table.debitedCurrency}) in (0, 2)`,
    ),
    check(
      `${name}_debited_needs_account`,
      sql`${table.debitedMinor} is null or (${table.accountId} is not null and ${table.debitedMinor} > 0)`,
    ),
    // A spending is one currency, so the row can say it; a trip's purchases may be in any, and
    // «списано» stands for any of them that is not the account's (adversarial Д2) — the use case's.
    ...(name === 'spendings'
      ? [
          check(
            `${name}_debited_in_other_currency`,
            sql`${table.debitedCurrency} is null or ${table.debitedCurrency} <> ${table.currency}`,
          ),
        ]
      : []),
    check(`${name}_debited_currency_known`, currencyKnownOrNull(table.debitedCurrency)),
  ]
}

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
    // The phone's today at the tap of «Начать» and «Завершить» (MOL-121): what an account and «Деньги»
    // date the trip by, beside the spendings the same phone dated. Empty for a trip from an old
    // queue — then the server's day of the moment, as before.
    startedOn: date('started_on'),
    finishedOn: date('finished_on'),
    // The account it was paid from, and «списано» in that account's currency (MOL-115, Р-18).
    accountId: uuid('account_id'),
    debitedMinor: bigint('debited_minor', { mode: 'bigint' }),
    debitedCurrency: char('debited_currency', { length: 3 }).$type<Currency>(),
    // When they last changed: a check's window is the server's moment, not the phone's (Д1б).
    accountSetAt: timestamp('account_set_at', { withTimezone: true }),
    // «Сумма по чеку» (MOL-78): typed whole, and when there is one it is the trip's money in every
    // reader — the prices stay as they are. `receipt_set_at` is when the server last saw it change,
    // taking it off included: what a check's window and «сколько было до обмена» date the receipt
    // by, as a purchase by its own moment.
    receiptMinor: bigint('receipt_minor', { mode: 'bigint' }),
    receiptCurrency: char('receipt_currency', { length: 3 }).$type<Currency>(),
    receiptSetAt: timestamp('receipt_set_at', { withTimezone: true }),
    // When this sum was first typed — an amendment keeps it, taking the sum off clears it: what the
    // hint of «сколько было до обмена» dates the receipt by, as a purchase by the moment it was
    // written, so a typo fixed after an exchange does not move the whole receipt past it (review 2).
    receiptFirstAt: timestamp('receipt_first_at', { withTimezone: true }),
    // «Удалить поход» (MOL-76): marked, not deleted, by the money rule — «Вернуть» for ten
    // minutes, then the minute timer, and every reader but erasure and that timer filters it
    // out. A mark also keeps a start sent again from the queue from writing the trip anew.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
    // say the same thing: the source *is* the publisher («official» is the pair's own bank,
    // `homeBankOf`: the National Bank of Georgia for the lari and the dinar against the dram, the
    // National Bank of Serbia for the dinar's other pairs, the Central Bank of Armenia for the rest,
    // MOL-110, MOL-230), so «fallback by cba» on a pair of drams or «official by erapi» is not a state
    // but a contradiction (MOL-22, В2-11). On a personal rate and on no rate at all the second
    // expression is null and the check passes.
    check(
      'trips_rate_provider_matches_source',
      sql`(${table.rateSource} is null or ${table.rateSource} = 'personal') = (${table.rateProvider} is null)
        and ((${table.rateSource} = 'official') = (${table.rateProvider} = ${homeBankSql(table.rateBase, table.rateQuote)})) is not false`,
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
    // A sum with no currency reads as money and converts by nothing; zero is not a receipt.
    check(
      'trips_receipt_whole',
      sql`num_nonnulls(${table.receiptMinor}, ${table.receiptCurrency}) in (0, 2)
        and (${table.receiptMinor} is null or (${table.receiptMinor} > 0 and ${table.receiptSetAt} is not null))`,
    ),
    check('trips_receipt_currency_known', currencyKnownOrNull(table.receiptCurrency)),
    check(
      'trips_receipt_first_with_sum',
      sql`(${table.receiptMinor} is null) = (${table.receiptFirstAt} is null)`,
    ),
    ...paidFrom('trips', table),
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
     * one back» has to stay five. So **the gate counts every row, the reminder reads the
     * withdrawal's moment to skip a purchase made before it (MOL-101), and every other reader
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

/** Who merged a pair: the night by itself, or the owner by `make merge` (В-2). */
export const MERGE_BY = ['night', 'hand'] as const
export type MergeBy = (typeof MERGE_BY)[number]

/**
 * The journal of the merge of twins (MOL-106): a row a pair, what went into what, by the night or by
 * the owner's hand, with the figures it was judged by. `undone_at` is `make unmerge`'s mark, and an
 * undone pair is never merged or named again. The rows moved are `catalogue_merge_moves`.
 */
export const catalogueMerges = pgTable(
  'catalogue_merges',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    subject: text('subject').$type<(typeof MERGE_SUBJECTS)[number]>().notNull(),
    fromItem: uuid('from_item').references(() => items.id),
    intoItem: uuid('into_item').references(() => items.id),
    fromPlace: uuid('from_place').references(() => places.id),
    intoPlace: uuid('into_place').references(() => places.id),
    by: text('by').$type<MergeBy>().notNull(),
    /**
     * The night that merged it, a day in Yerevan; none by hand. The morning's report is read from here,
     * so a merge made before a night broke off is named all the same (adversarial А6).
     */
    night: date('night'),
    /** The spelling and the meaning the pair was judged by; none for a pair merged by hand. */
    edits: smallint('edits'),
    worst: smallint('worst'),
    meaning: real('meaning'),
    mergedAt: timestamp('merged_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
  },
  (table) => [
    check('catalogue_merges_subject_known', oneOf(table.subject, MERGE_SUBJECTS)),
    check('catalogue_merges_by_known', oneOf(table.by, MERGE_BY)),
    check(
      'catalogue_merges_night_by_night',
      sql`(${table.night} is not null) = (${table.by} = 'night')`,
    ),
    index('catalogue_merges_night_idx').on(table.night),
    check(
      'catalogue_merges_subject_named',
      sql`case ${table.subject} when 'item'
        then ${table.fromItem} is not null and ${table.intoItem} is not null
          and ${table.fromPlace} is null and ${table.intoPlace} is null
        else ${table.fromPlace} is not null and ${table.intoPlace} is not null
          and ${table.fromItem} is null and ${table.intoItem} is null end`,
    ),
    check(
      'catalogue_merges_not_self',
      sql`coalesce(${table.fromItem}, ${table.fromPlace}) <> coalesce(${table.intoItem}, ${table.intoPlace})`,
    ),
    // One live merge of a thing: a trace is merged once, and an undone row leaves room for none other.
    uniqueIndex('catalogue_merges_item_live')
      .on(table.fromItem)
      .where(sql`${table.undoneAt} is null and ${table.fromItem} is not null`),
    uniqueIndex('catalogue_merges_place_live')
      .on(table.fromPlace)
      .where(sql`${table.undoneAt} is null and ${table.fromPlace} is not null`),
    index('catalogue_merges_into_item_idx').on(table.intoItem),
    index('catalogue_merges_into_place_idx').on(table.intoPlace),
  ],
)

/**
 * What a merge moved, a row a row, so that `make unmerge` moves exactly that back. Keyed by the
 * moved row's own key; a remembered pick has no id of its own, so its row names its person, and goes
 * with the person (`ACTOR_REFERENCES`) — nothing is left to undo for someone erased.
 */
export const MERGE_MOVES = [
  'expense',
  'verdict',
  // one person's two verdicts, the trace's the later: the rows stay, their contents swap — the unique
  // key holds row by row, so two rows cannot cross over in one statement
  'verdict_swapped',
  // the verdict that lost, withdrawn on the trace; the gate still counts it, the undo brings it back
  // without its text, which a withdrawn row cannot hold
  'verdict_withdrawn',
  'trip',
  'barcode',
  'item_name',
  'item_hs',
  'store_memory',
  'receipt_line',
  'pick',
  // a pick added to the survivor's own for the same query — `before` holds what the trace's held
  'pick_added',
  // a trace of the merged item, now a trace of the survivor
  'trace',
] as const
export type MergeMove = (typeof MERGE_MOVES)[number]

export const catalogueMergeMoves = pgTable(
  'catalogue_merge_moves',
  {
    mergeId: bigint('merge_id', { mode: 'number' })
      .notNull()
      .references(() => catalogueMerges.id),
    what: text('what').$type<MergeMove>().notNull(),
    key: jsonb('key').notNull(),
    before: jsonb('before'),
    /**
     * The person of a remembered pick, for picks only. Goes with the person by the cascade: once the
     * pick is erased there is nothing to move back, and the journal keeps no one's trace.
     */
    actorId: uuid('actor_id').references(() => actors.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('catalogue_merge_moves_merge_idx').on(table.mergeId),
    index('catalogue_merge_moves_actor_idx').on(table.actorId),
    check('catalogue_merge_moves_what_known', oneOf(table.what, MERGE_MOVES)),
    check(
      'catalogue_merge_moves_pick_named',
      sql`(${table.actorId} is not null) = (${oneOf(table.what, ['pick', 'pick_added'])})`,
    ),
  ],
)

/**
 * One night of the merge (MOL-106): claimed by its day in Yerevan, so two instances of the API never run
 * one night twice, and a night the API slept through runs when it wakes. `report` is the morning's
 * notice, queued at nine and marked `reported_at`.
 */
export const catalogueMergeRuns = pgTable(
  'catalogue_merge_runs',
  {
    day: date('day').primaryKey(),
    mode: text('mode').$type<'on' | 'report'>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    report: jsonb('report'),
    /**
     * Every pair the night merged or, in `report`, would merge — the message names ten (adversarial В2):
     * `make merge-night DAY=` prints them all, with a number to undo or a command to say apart.
     */
    pairs: jsonb('pairs'),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
  },
  (table) => [check('catalogue_merge_runs_mode_known', oneOf(table.mode, ['on', 'report']))],
)

/**
 * A pair the owner said is two things (`make apart`, MOL-106): the night never merges it and never names
 * it — as a pair undone, read by the live things its ends stand in now. The owner's hand still may merge
 * it. By the two ids in order; no foreign key, since neither an item nor a place is ever deleted.
 */
export const catalogueApart = pgTable(
  'catalogue_apart',
  {
    subject: text('subject').$type<(typeof MERGE_SUBJECTS)[number]>().notNull(),
    a: uuid('a').notNull(),
    b: uuid('b').notNull(),
    saidAt: timestamp('said_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.subject, table.a, table.b] }),
    check('catalogue_apart_subject_known', oneOf(table.subject, MERGE_SUBJECTS)),
    check('catalogue_apart_ordered', sql`${table.a} < ${table.b}`),
  ],
)

/**
 * A candidate named to the owner once, so the next morning names only new ones. A pair by its two ids
 * in order; no foreign key, since neither an item nor a place is ever deleted.
 */
export const catalogueMergeCandidates = pgTable(
  'catalogue_merge_candidates',
  {
    subject: text('subject').$type<(typeof MERGE_SUBJECTS)[number]>().notNull(),
    a: uuid('a').notNull(),
    b: uuid('b').notNull(),
    namedOn: date('named_on').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subject, table.a, table.b] }),
    check('catalogue_merge_candidates_subject_known', oneOf(table.subject, MERGE_SUBJECTS)),
    check('catalogue_merge_candidates_ordered', sql`${table.a} < ${table.b}`),
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
    queryKey: varchar('query_key', { length: QUERY_KEY_MAX_OCTETS }).notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    picks: integer('picks').notNull().default(1),
    lastPickedAt: timestamp('last_picked_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The person's own synonym (MOL-45): this query found nothing, and the item was then taken
     * by another one. Such a row lets its item into the answer to exactly this query — the one
     * pick that admits what the search did not find, and only for the person who made it.
     */
    admits: boolean('admits').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.queryKey, table.itemId] }),
    // The merge of twins and its nightly sweep look a pick up by its item alone (MOL-106).
    index('search_picks_item_idx').on(table.itemId),
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
 * The official rates as their providers published them: one currency against the provider's base
 * per day (MOL-39) — the dram, or the dinar for the National Bank of Serbia (`base`, MOL-230). Not
 * pairs — no provider publishes those, and a stored pair would be a number
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
    // What the row is quoted in — the provider's `RATE_BASE`: the dram, or the dinar for the National
    // Bank of Serbia, whose list has no dram (MOL-230). Said by the row so that nobody reading the
    // table takes 1,2257 dinars for a rouble as drams; the key stays the provider's, one base each.
    base: char('base', { length: 3 }).$type<Currency>().notNull().default('AMD'),
    // Units of `base` per one unit, at RATE_SCALE — whatever «per 100» the provider printed is divided out.
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
      sql`${oneOf(table.currency, currencySchema.options)} and ${table.currency} <> ${table.base}`,
    ),
    check('official_rates_base_of_provider', sql`${table.base} = ${rateBaseSql(table.provider)}`),
    check('official_rates_positive', sql`${table.scaled} > 0`),
  ],
)

/**
 * The market the central bank's statistics describe (MOL-137): weighted averages of a day's deals
 * with clients — banks with people in cash and not, banks with every client, exchange offices — on
 * each side of the counter, one currency against the dram. A mirror of the files, rewritten by
 * them, and never a rate anything counts by: an exchange is only set beside it. Kept apart from
 * `official_rates`, whose rows trips take and whose rules (jumps, fallbacks) are not this row's.
 */
export const marketRates = pgTable(
  'market_rates',
  {
    channel: text('channel').$type<MarketChannel>().notNull(),
    currency: char('currency', { length: 3 }).$type<AmdRate['currency']>().notNull(),
    rateDate: date('rate_date').notNull(),
    // The bank's side, in the words of the files: `bankBuys` is where the person sells (Р-1).
    side: text('side').$type<MarketSide>().notNull(),
    // Drams per one unit, at RATE_SCALE, as the official cache keeps them.
    scaled: bigint('scaled', { mode: 'bigint' }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Also the index «each channel's latest row not after this day» walks.
    primaryKey({ columns: [table.channel, table.currency, table.side, table.rateDate] }),
    check('market_rates_channel_known', oneOf(table.channel, marketChannelSchema.options)),
    check('market_rates_side_known', oneOf(table.side, marketSideSchema.options)),
    // The currencies of the files and no other (MOL-110): the lari is in none of them, and a mirror
    // holds what it mirrors.
    check('market_rates_currency_foreign', oneOf(table.currency, MARKET_CURRENCIES)),
    check('market_rates_positive', sql`${table.scaled} > 0`),
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
    // «Где и заметка» (MOL-42, В-4): one line, private as the exchange itself.
    note: text('note'),
    // «Как меняли» (MOL-137, В-1): bank in cash, bank not in cash, exchange office — or not said.
    channel: text('channel').$type<ExchangeChannel>(),
    // Which version of the exchange this is (MOL-42, В-3): an amendment names the one it was made
    // over, so two devices cannot both amend the same old version. Each earlier one is a row of
    // `exchange_revisions`.
    revision: integer('revision').notNull().default(1),
    amendedAt: timestamp('amended_at', { withTimezone: true }),
    // The accounts each side left and landed on (MOL-115), each of its side's currency.
    givenAccountId: uuid('given_account_id'),
    receivedAccountId: uuid('received_account_id'),
    // When either last changed: a check's window is the server's moment (adversarial Д1б).
    accountSetAt: timestamp('account_set_at', { withTimezone: true }),
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
    check('exchanges_revision_positive', sql`${table.revision} > 0`),
    check(
      'exchanges_channel_known',
      sql`${table.channel} is null or ${oneOf(table.channel, exchangeChannelSchema.options)}`,
    ),
    foreignKey({
      name: 'exchanges_given_account_is_owners',
      columns: [table.givenAccountId, table.actorId, table.givenCurrency],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId, moneyAccounts.currency],
    }),
    foreignKey({
      name: 'exchanges_received_account_is_owners',
      columns: [table.receivedAccountId, table.actorId, table.receivedCurrency],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId, moneyAccounts.currency],
    }),
  ],
)

/**
 * The versions an exchange had before it was amended (MOL-42, В-3). The rate of a past exchange is
 * a fact, so an amendment leaves a trace rather than rewriting it in silence — and the trace is
 * what explains why a trip started last week took a rate the exchanges no longer say. Goes with
 * its exchange: a removal made final takes the history too, and so does erasure (MOL-58).
 */
export const exchangeRevisions = pgTable(
  'exchange_revisions',
  {
    exchangeId: uuid('exchange_id')
      .notNull()
      .references(() => exchanges.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    givenMinor: bigint('given_minor', { mode: 'bigint' }).notNull(),
    givenCurrency: char('given_currency', { length: 3 }).$type<Currency>().notNull(),
    receivedMinor: bigint('received_minor', { mode: 'bigint' }).notNull(),
    receivedCurrency: char('received_currency', { length: 3 }).$type<Currency>().notNull(),
    exchangedOn: date('exchanged_on').notNull(),
    heldBeforeMinor: bigint('held_before_minor', { mode: 'bigint' }),
    note: text('note'),
    channel: text('channel').$type<ExchangeChannel>(),
    // When this version stopped being the exchange.
    replacedAt: timestamp('replaced_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.exchangeId, table.revision] }),
    check('exchange_revisions_given_positive', sql`${table.givenMinor} > 0`),
    check('exchange_revisions_received_positive', sql`${table.receivedMinor} > 0`),
    check(
      'exchange_revisions_given_currency_known',
      oneOf(table.givenCurrency, currencySchema.options),
    ),
    check(
      'exchange_revisions_received_currency_known',
      oneOf(table.receivedCurrency, currencySchema.options),
    ),
    check(
      'exchange_revisions_channel_known',
      sql`${table.channel} is null or ${oneOf(table.channel, exchangeChannelSchema.options)}`,
    ),
  ],
)

/**
 * Money that came in with nothing given for it (MOL-66): the day, the amount and its currency, and
 * where it came from. Only what arrived — nothing expected is ever written. Private as an exchange:
 * no aggregate reads it, the log of events does not either, and it goes with its owner.
 */
export const incomes = pgTable(
  'incomes',
  {
    // Named by the device, as an exchange is: a tap sent twice is one income.
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    // A day in Yerevan, as the rates are dated: the official rate of that day values it (В-1).
    receivedOn: date('received_on').notNull(),
    // How much of that currency was held just before; null is «not said», which is not zero.
    heldBeforeMinor: bigint('held_before_minor', { mode: 'bigint' }),
    source: text('source').$type<IncomeSource>().notNull(),
    note: text('note'),
    // The account it came onto (MOL-115); of its own currency, which the key below holds.
    accountId: uuid('account_id'),
    accountSetAt: timestamp('account_set_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    amendedAt: timestamp('amended_at', { withTimezone: true }),
    // Removed and still offered back for ten minutes, as an exchange is (MOL-40, В-5, В-7).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // The owner's incomes in the order the wallet walks them.
    index('incomes_actor_day_idx').on(table.actorId, table.receivedOn, table.createdAt),
    check('incomes_amount_positive', sql`${table.amountMinor} > 0`),
    check(
      'incomes_held_not_negative',
      sql`${table.heldBeforeMinor} is null or ${table.heldBeforeMinor} >= 0`,
    ),
    check('incomes_currency_known', oneOf(table.currency, currencySchema.options)),
    check('incomes_source_known', oneOf(table.source, incomeSourceSchema.options)),
    check('incomes_revision_positive', sql`${table.revision} > 0`),
    foreignKey({
      name: 'incomes_account_is_owners',
      columns: [table.accountId, table.actorId, table.currency],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId, moneyAccounts.currency],
    }),
  ],
)

/** The versions an income had before it was amended — the same trace an exchange keeps (В-3). */
export const incomeRevisions = pgTable(
  'income_revisions',
  {
    incomeId: uuid('income_id')
      .notNull()
      .references(() => incomes.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    receivedOn: date('received_on').notNull(),
    heldBeforeMinor: bigint('held_before_minor', { mode: 'bigint' }),
    source: text('source').$type<IncomeSource>().notNull(),
    note: text('note'),
    replacedAt: timestamp('replaced_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.incomeId, table.revision] }),
    check('income_revisions_amount_positive', sql`${table.amountMinor} > 0`),
    check('income_revisions_currency_known', oneOf(table.currency, currencySchema.options)),
    check('income_revisions_source_known', oneOf(table.source, incomeSourceSchema.options)),
  ],
)

/**
 * Money moved between two of one's own accounts of one currency (MOL-253): «Папина карта $» →
 * «Доллары $». It moves the two balances and nothing else — no month, no wallet. Private as an
 * exchange, and gone with its owner. Both accounts are the owner's and of the money's currency, held
 * by the keys; a transfer with no account is nothing at all, so neither is ever null. Its fee is a row
 * of `spendings` pointing here (`transfer_id`): a real spending, counted where every spending is.
 */
export const accountTransfers = pgTable(
  'account_transfers',
  {
    // Named by the device once per opening of the sheet: a tap sent twice is one transfer.
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    fromAccountId: uuid('from_account_id').notNull(),
    toAccountId: uuid('to_account_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    transferredOn: date('transferred_on').notNull(),
    note: text('note'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    amendedAt: timestamp('amended_at', { withTimezone: true }),
    // Removed and offered back for ten minutes, its fee with it, as an exchange is (MOL-73, В-4).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('account_transfers_actor_day_idx').on(
      table.actorId,
      table.transferredOn,
      table.createdAt,
    ),
    // What its fee points at: a spending of the same owner.
    unique('account_transfers_id_actor_unique').on(table.id, table.actorId),
    foreignKey({
      name: 'account_transfers_from_is_owners',
      columns: [table.fromAccountId, table.actorId, table.currency],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId, moneyAccounts.currency],
    }),
    foreignKey({
      name: 'account_transfers_to_is_owners',
      columns: [table.toAccountId, table.actorId, table.currency],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId, moneyAccounts.currency],
    }),
    check('account_transfers_two_accounts', sql`${table.fromAccountId} <> ${table.toAccountId}`),
    check('account_transfers_amount_positive', sql`${table.amountMinor} > 0`),
    check('account_transfers_currency_known', oneOf(table.currency, currencySchema.options)),
    check('account_transfers_revision_positive', sql`${table.revision} > 0`),
  ],
)

/** The versions a transfer had before it was amended, its fee with each (MOL-42 В-3). */
export const accountTransferRevisions = pgTable(
  'account_transfer_revisions',
  {
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => accountTransfers.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    fromAccountId: uuid('from_account_id').notNull(),
    toAccountId: uuid('to_account_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    feeMinor: bigint('fee_minor', { mode: 'bigint' }),
    transferredOn: date('transferred_on').notNull(),
    note: text('note'),
    replacedAt: timestamp('replaced_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.transferId, table.revision] }),
    check('account_transfer_revisions_amount_positive', sql`${table.amountMinor} > 0`),
    check(
      'account_transfer_revisions_fee_positive',
      sql`${table.feeMinor} is null or ${table.feeMinor} > 0`,
    ),
    check(
      'account_transfer_revisions_currency_known',
      oneOf(table.currency, currencySchema.options),
    ),
  ],
)

/**
 * A person's spending categories (MOL-73, В-3): the presets every account is given and the ones they
 * made. Each account has its own list, because people's categories differ. Removing one is
 * `archived_at`, never a delete: the spendings in it keep it, and past months keep their sums.
 */
export const spendingCategories = pgTable(
  'spending_categories',
  {
    // A preset's row is named by the server; one's own by the device, as everything written
    // offline is — a category made at a shelf with no signal is one category when it arrives.
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    preset: text('preset').$type<SpendingPreset>(),
    name: text('name'),
    colour: smallint('colour'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // The pair a spending points at: its category is the same owner's, held by the database.
    unique('spending_categories_id_actor_unique').on(table.id, table.actorId),
    // Each preset once per owner, so giving them twice — two tabs asking at once — is one list.
    uniqueIndex('spending_categories_actor_preset_unique')
      .on(table.actorId, table.preset)
      .where(sql`${table.preset} is not null`),
    check(
      'spending_categories_preset_or_own',
      sql`(${table.preset} is not null and ${table.name} is null and ${table.colour} is null)
        or (${table.preset} is null and ${table.name} is not null and ${table.colour} is not null)`,
    ),
    check(
      'spending_categories_preset_known',
      sql`${table.preset} is null or ${oneOf(table.preset, spendingPresetSchema.options)}`,
    ),
    check(
      'spending_categories_colour_in_palette',
      sql`${table.colour} is null or ${table.colour} between 0 and ${sql.raw(String(SPENDING_CATEGORY_COLOURS - 1))}`,
    ),
  ],
)

/**
 * Money spent outside a trip (MOL-73): a day, an amount in its currency, one of the owner's
 * categories and two lines of their own words. Private as an income: no aggregate reads it, the
 * log of events does not either, and it goes with its owner. A spending in another currency than
 * the spending one carries the rate of its own day — all five columns or none, as a trip's.
 */
export const spendings = pgTable(
  'spendings',
  {
    // Named by the device: a spending sent twice from the queue is one spending.
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    spentOn: date('spent_on').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    categoryId: uuid('category_id').notNull(),
    note: text('note'),
    place: text('place'),
    rateBase: char('rate_base', { length: 3 }).$type<Currency>(),
    rateQuote: char('rate_quote', { length: 3 }).$type<Currency>(),
    rateScaled: bigint('rate_scaled', { mode: 'bigint' }),
    rateSource: text('rate_source').$type<RateSource>(),
    rateAsOf: timestamp('rate_as_of', { withTimezone: true }),
    // The account it was paid from, and «списано» in that account's currency (MOL-115, В-3).
    accountId: uuid('account_id'),
    debitedMinor: bigint('debited_minor', { mode: 'bigint' }),
    debitedCurrency: char('debited_currency', { length: 3 }).$type<Currency>(),
    // When they last changed: a check's window is the server's moment, not the phone's (Д1б).
    accountSetAt: timestamp('account_set_at', { withTimezone: true }),
    // The transfer this is the fee of (MOL-253, Р-1): written and removed with it, one fee a transfer.
    transferId: uuid('transfer_id'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    amendedAt: timestamp('amended_at', { withTimezone: true }),
    // Removed and offered back for ten minutes, as an exchange is (MOL-73, В-4).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // A month of the journal is one index scan.
    index('spendings_actor_day_idx').on(table.actorId, table.spentOn, table.createdAt),
    // The category is the owner's own: the pair, not the id alone.
    foreignKey({
      name: 'spendings_category_is_owners',
      columns: [table.categoryId, table.actorId],
      foreignColumns: [spendingCategories.id, spendingCategories.actorId],
    }),
    // A fee is the same owner's transfer's, and goes with it.
    foreignKey({
      name: 'spendings_transfer_is_owners',
      columns: [table.transferId, table.actorId],
      foreignColumns: [accountTransfers.id, accountTransfers.actorId],
    }).onDelete('cascade'),
    unique('spendings_transfer_unique').on(table.transferId),
    check('spendings_amount_positive', sql`${table.amountMinor} > 0`),
    check('spendings_currency_known', oneOf(table.currency, currencySchema.options)),
    check('spendings_revision_positive', sql`${table.revision} > 0`),
    check(
      'spendings_rate_all_or_none',
      sql`num_nonnulls(${table.rateBase}, ${table.rateQuote}, ${table.rateScaled}, ${table.rateSource}, ${table.rateAsOf}) in (0, 5)`,
    ),
    // «390 ֏ за $»: the spending's own currency on whichever side keeps the number's digits.
    check(
      'spendings_rate_of_spending_currency',
      sql`${table.rateBase} is null or ${table.currency} in (${table.rateBase}, ${table.rateQuote})`,
    ),
    check(
      'spendings_rate_two_currencies',
      sql`${table.rateBase} is null or ${table.rateBase} <> ${table.rateQuote}`,
    ),
    ...paidFrom('spendings', table),
    check('spendings_rate_quote_known', currencyKnownOrNull(table.rateQuote)),
    check(
      'spendings_rate_source_known',
      sql`${table.rateSource} is null or ${oneOf(table.rateSource, rateSourceSchema.options)}`,
    ),
  ],
)

/**
 * «Сверить с фактом» (MOL-115, MOL-43 В-4): what the person counted, what the server counted then,
 * and when. It moves no balance; it is where the next check starts looking for a reason. Named by
 * the device: the same check counted again after a reason was put right is one row.
 */
export const moneyAccountChecks = pgTable(
  'money_account_checks',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull(),
    checkedOn: date('checked_on').notNull(),
    factMinor: bigint('fact_minor', { mode: 'bigint' }).notNull(),
    countedMinor: bigint('counted_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // The last check of an account is one index scan.
    index('money_account_checks_account_idx').on(table.accountId, table.createdAt),
    // Goes with its account: an account without operations is deleted, checks and all.
    foreignKey({
      name: 'money_account_checks_account_is_owners',
      columns: [table.accountId, table.actorId],
      foreignColumns: [moneyAccounts.id, moneyAccounts.actorId],
    }).onDelete('cascade'),
  ],
)

/**
 * The rate a closed month is counted by in the income currency (MOL-73, handoff 06): the person's
 * rate — or the official one — on its last day, written the first time the month is read after it
 * closed and never again. A new exchange today does not move August.
 */
export const moneyMonthRates = pgTable(
  'money_month_rates',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    month: char('month', { length: 7 }).notNull(),
    base: char('base', { length: 3 }).$type<Currency>().notNull(),
    quote: char('quote', { length: 3 }).$type<Currency>().notNull(),
    scaled: bigint('scaled', { mode: 'bigint' }).notNull(),
    source: text('source').$type<RateSource>().notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.month, table.base, table.quote] }),
    check('money_month_rates_two_currencies', sql`${table.base} <> ${table.quote}`),
    check('money_month_rates_base_known', oneOf(table.base, currencySchema.options)),
    check('money_month_rates_quote_known', oneOf(table.quote, currencySchema.options)),
    check('money_month_rates_source_known', oneOf(table.source, rateSourceSchema.options)),
    check('money_month_rates_month_shape', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
)

/**
 * A person's budget of a month (MOL-117): what a category is planned at — a sum in the spending
 * currency or a whole percent of «Пришло» — **from a month on** (В-1), until a later row of the same
 * category takes over, so a plan set once carries over and a change leaves the months before it as
 * they were. Neither a sum nor a percent is «no plan from this month». `category_id` null is the
 * savings target (В-4), a percent only. Private as a spending; it goes with its owner.
 */
export const budgetPlans = pgTable(
  'budget_plans',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id'),
    fromMonth: char('from_month', { length: 7 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).$type<Currency>(),
    percent: smallint('percent'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // One plan of a category a month; the savings target, `category_id` null, is one too.
    unique('budget_plans_actor_category_month_key')
      .on(table.actorId, table.categoryId, table.fromMonth)
      .nullsNotDistinct(),
    // The category is the owner's own, as a spending's is: the pair, not the id alone.
    foreignKey({
      name: 'budget_plans_category_is_owners',
      columns: [table.categoryId, table.actorId],
      foreignColumns: [spendingCategories.id, spendingCategories.actorId],
    }),
    check('budget_plans_month_shape', sql`${table.fromMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'budget_plans_one_kind',
      sql`(${table.amountMinor} is null) = (${table.currency} is null)
        and not (${table.amountMinor} is not null and ${table.percent} is not null)`,
    ),
    check(
      'budget_plans_amount_non_negative',
      sql`${table.amountMinor} is null or ${table.amountMinor} >= 0`,
    ),
    check('budget_plans_currency_known', currencyKnownOrNull(table.currency)),
    check(
      'budget_plans_percent_range',
      sql`${table.percent} is null or ${table.percent} between 0 and ${sql.raw(String(BUDGET_PERCENT_MAX))}`,
    ),
    // Putting aside is no spending: the savings target is a percent, never a sum.
    check(
      'budget_plans_savings_is_share',
      sql`${table.categoryId} is not null or ${table.amountMinor} is null`,
    ),
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

/**
 * How many people erased themselves (MOL-58), by the week they appeared — and nothing else
 * (MOL-91). Erasure takes a person out of both halves of every gate without a trace, so a gate
 * could fall with nobody seeing why; this is the one line it leaves behind. No id and no day, and
 * no foreign key, since there is nobody left to point at: a week, a Monday in Yerevan, because
 * among ten or fifteen people a day of arrival nearly names the person. Only a count — whether
 * they had reached five ratings or come back would be one more fact about someone erased.
 */
export const erasures = pgTable(
  'erasures',
  {
    appearedWeek: date('appeared_week').primaryKey(),
    erased: integer('erased').notNull(),
  },
  (table) => [
    check('erasures_erased_positive', sql`${table.erased} > 0`),
    check('erasures_week_monday', sql`extract(isodow from ${table.appearedWeek}) = 1`),
  ],
)

/**
 * The login's funnel, counted by the day a login began (MOL-68): how many were started, confirmed
 * in the bot, declined there, collected into a session, and how many ran out — and nothing else.
 *
 * Counted when each step happens, in the transaction of the step itself, because nothing is left
 * to count afterwards: a refusal and a collection only put a request out, and the minute timer
 * deletes it. Not the event log — that keeps a person's return and nothing more — and not a row
 * per person: no id, no Telegram id, no code, no device, so erasure has nothing here to reach.
 *
 * The day is the one the request was **started** on, in Yerevan, not the day of the step: a
 * confirmation at 23:59 and a collection at 00:01 land in the row of the day it began, so a row
 * reads as a funnel of its own. `refused` is the exception — a start the quota turned away makes
 * no request, and it counts on the day it was refused.
 */
export const loginDays = pgTable(
  'login_days',
  {
    day: date('day').primaryKey(),
    started: integer('started').notNull().default(0),
    /** Of `started`, those begun by a device that had begun one before and not yet come in. */
    again: integer('again').notNull().default(0),
    /** The first «Войти» only: the same account pressing it again changes nothing (MOL-55). */
    confirmed: integer('confirmed').notNull().default(0),
    declined: integer('declined').notNull().default(0),
    collected: integer('collected').notNull().default(0),
    /** Ran out never confirmed: the person did not reach the bot, or did not press. */
    expiredUnconfirmed: integer('expired_unconfirmed').notNull().default(0),
    /** Ran out confirmed: the bot said yes and the person never came back to the app. */
    expiredConfirmed: integer('expired_confirmed').notNull().default(0),
    refused: integer('refused').notNull().default(0),
  },
  (table) => [
    check(
      'login_days_counts_non_negative',
      sql`least(${table.started}, ${table.again}, ${table.confirmed}, ${table.declined}, ${table.collected}, ${table.expiredUnconfirmed}, ${table.expiredConfirmed}, ${table.refused}) >= 0`,
    ),
    // Written by the same statement as `started`, so this one holds by construction.
    check('login_days_again_within_started', sql`${table.again} <= ${table.started}`),
  ],
)

/**
 * Where a person stands on the ladder of rating reminders (MOL-101): the last step sent, the day
 * of their own it went out, the moment — a rating after it resets the ladder (Л-1) — and the
 * first day whose purchases the ladder asks about. One row a person, rewritten by each reminder;
 * no row is «no ladder». A table rather than columns on `actors`, so the owner's row is not
 * rewritten every evening.
 *
 * **The switch of MOL-103 cannot simply be a column here** (review Т-3): a ladder that ends with
 * nothing to ask about deletes its row (Л-2), and a switch in it would go with it. MOL-103 either
 * ends a ladder by clearing it — a nullable `step` — or keeps the switch elsewhere.
 *
 * The pause after step 3 is not a column: it is step 3 and its day, and `planReminder` knows how
 * long it lasts.
 */
export const ratingReminders = pgTable(
  'rating_reminders',
  {
    // Cascades like the person's money does (MOL-40): erasure deletes it first to count it.
    actorId: uuid('actor_id')
      .primaryKey()
      .references(() => actors.id, { onDelete: 'cascade' }),
    step: smallint('step').notNull(),
    remindedOn: date('reminded_on').notNull(),
    remindedAt: timestamp('reminded_at', { withTimezone: true }).notNull(),
    windowFrom: date('window_from').notNull(),
  },
  (table) => [
    check('rating_reminders_step', sql`${table.step} between 1 and 3`),
    check('rating_reminders_window_before', sql`${table.windowFrom} < ${table.remindedOn}`),
  ],
)

/**
 * The reminder's lever, counted by day (MOL-101, В-4): how many people got each step, how many
 * items the messages asked about, and how many of those were rated by a press in the bot. The same
 * shape as `login_days` and for the same reason — no id of anyone, so erasure has nothing to reach
 * — and the day is Yerevan's, like there. A person who keeps silent after step 3 goes into the
 * pause, so `third_steps` is also how many were at the edge of it.
 */
export const reminderDays = pgTable(
  'reminder_days',
  {
    day: date('day').primaryKey(),
    firstSteps: integer('first_steps').notNull().default(0),
    secondSteps: integer('second_steps').notNull().default(0),
    thirdSteps: integer('third_steps').notNull().default(0),
    items: integer('items').notNull().default(0),
    /** New verdicts given by a press under a reminder, on the day of the press. */
    rated: integer('rated').notNull().default(0),
    /**
     * People whose reminders went from on to off that day (MOL-103, В-4), by how: «Не напоминать»
     * under a reminder, the switch in the settings, the bot blocked. Whether the lever annoys.
     */
    offButton: integer('off_button').notNull().default(0),
    offSettings: integer('off_settings').notNull().default(0),
    offBlocked: integer('off_blocked').notNull().default(0),
  },
  (table) => [
    check(
      'reminder_days_counts_non_negative',
      sql`least(${table.firstSteps}, ${table.secondSteps}, ${table.thirdSteps}, ${table.items}, ${table.rated}, ${table.offButton}, ${table.offSettings}, ${table.offBlocked}) >= 0`,
    ),
  ],
)

/**
 * The receipt scanner's measure (MOL-222, owner's decision 04.10.2026): how readings ended, and how
 * much of what was read people put right before recording. The hypothesis of 0.2 stops when after
 * four weeks more than a third of the lines are corrected. The same shape as `login_days` and for the
 * same reason — no id of anyone and nothing of a receipt, so erasure has nothing to reach and an
 * erased person's corrections still count.
 *
 * A reading counts on the day it ended, a record on the day it was written, both in Yerevan. A line
 * is edited once however many things changed in it; the kinds beside it may add up past it.
 */
export const receiptDays = pgTable(
  'receipt_days',
  {
    day: date('day').primaryKey(),
    /** Read with its lines, and the lines cover the receipt (`readPartly` is false). */
    read: integer('read').notNull().default(0),
    /** Read with its lines, but they make up too little of it — the «переснимите» of before (В-1). */
    readPartly: integer('read_partly').notNull().default(0),
    /** Not one item line found. */
    reshoot: integer('reshoot').notNull().default(0),
    /** Read whole with no items on it: a sole trader's section and its sum (MOL-227). */
    noItems: integer('no_items').notNull().default(0),
    unreadable: integer('unreadable').notNull().default(0),
    recorded: integer('recorded').notNull().default(0),
    /** Every line of the receipts recorded, the ones left out included. */
    lines: integer('lines').notNull().default(0),
    linesEdited: integer('lines_edited').notNull().default(0),
    /** «Не записывать». */
    linesSkipped: integer('lines_skipped').notNull().default(0),
    /** Another item than the review showed. */
    linesItem: integer('lines_item').notNull().default(0),
    /** The quantity or the sum changed. */
    linesFigures: integer('lines_figures').notNull().default(0),
    /** Receipts whose total the person put right — one edit of the receipt, never of its lines. */
    totalsCorrected: integer('totals_corrected').notNull().default(0),
    /** From the server taking the receipt to its record — never the phone's clock. */
    within5m: integer('within_5m').notNull().default(0),
    within15m: integer('within_15m').notNull().default(0),
    within1h: integer('within_1h').notNull().default(0),
    within1d: integer('within_1d').notNull().default(0),
    later: integer('later').notNull().default(0),
  },
  (table) => [
    check(
      'receipt_days_counts_non_negative',
      sql`least(${table.read}, ${table.readPartly}, ${table.reshoot}, ${table.noItems}, ${table.unreadable}, ${table.recorded}, ${table.lines}, ${table.linesEdited}, ${table.linesSkipped}, ${table.linesItem}, ${table.linesFigures}, ${table.totalsCorrected}, ${table.within5m}, ${table.within15m}, ${table.within1h}, ${table.within1d}, ${table.later}) >= 0`,
    ),
    check('receipt_days_edited_within_lines', sql`${table.linesEdited} <= ${table.lines}`),
  ],
)

/**
 * The receipts from the Serbian tax office (MOL-234), counted as `receipt_days` is and beside it, never
 * in it: their lines are the tax office's, with nothing to read wrong, and counted with OCR's they would
 * thin the stop line of 0.2r. A table of its own rather than a `source` in that one's key — a key moved
 * would break the `on conflict (day)` of the image a failed deploy puts back.
 *
 * How the link came (`sent_*`) is counted when the server takes the receipt, on that day: QR off the
 * photo or pasted, with the camera missing before it or not — the measure of the risk of MOL-233 — and
 * not named by a phone of an earlier build. A reading counts on the day it ended, a record on the day
 * it was written, both in Yerevan. What a person put right is what the matcher missed: the figures are
 * the tax office's.
 */
export const taxReceiptDays = pgTable(
  'tax_receipt_days',
  {
    day: date('day').primaryKey(),
    sentQr: integer('sent_qr').notNull().default(0),
    sentQrMissed: integer('sent_qr_missed').notNull().default(0),
    sentPaste: integer('sent_paste').notNull().default(0),
    sentPasteMissed: integer('sent_paste_missed').notNull().default(0),
    sentUnnamed: integer('sent_unnamed').notNull().default(0),
    /** Read with its lines. */
    read: integer('read').notNull().default(0),
    /** Not shown by the tax office in two days. */
    missing: integer('missing').notNull().default(0),
    /** Refused by the tax office. */
    invalid: integer('invalid').notNull().default(0),
    /** Answered with a journal that holds no list (adversarial А7): the tax office's, never ours. */
    empty: integer('empty').notNull().default(0),
    /** Ours: a link lost to a restored copy, an answer we could not write. */
    unreadable: integer('unreadable').notNull().default(0),
    /** Its specification answered and agreed with the journal; failed — no codes from it (В-1). */
    specsOk: integer('specs_ok').notNull().default(0),
    specsFailed: integer('specs_failed').notNull().default(0),
    /** Not asked: the person's share of the minute went on the journals (adversarial А5). */
    specsSkipped: integer('specs_skipped').notNull().default(0),
    /** Lines that came with a code the catalogue would take. */
    linesCoded: integer('lines_coded').notNull().default(0),
    recorded: integer('recorded').notNull().default(0),
    lines: integer('lines').notNull().default(0),
    linesEdited: integer('lines_edited').notNull().default(0),
    linesSkipped: integer('lines_skipped').notNull().default(0),
    linesItem: integer('lines_item').notNull().default(0),
    linesFigures: integer('lines_figures').notNull().default(0),
    totalsCorrected: integer('totals_corrected').notNull().default(0),
    /** Codes of its lines the person bound to items at «Записать» (В-2). */
    codesWritten: integer('codes_written').notNull().default(0),
    within5m: integer('within_5m').notNull().default(0),
    within15m: integer('within_15m').notNull().default(0),
    within1h: integer('within_1h').notNull().default(0),
    within1d: integer('within_1d').notNull().default(0),
    later: integer('later').notNull().default(0),
  },
  (table) => [
    check(
      'tax_receipt_days_counts_non_negative',
      sql`least(${table.sentQr}, ${table.sentQrMissed}, ${table.sentPaste}, ${table.sentPasteMissed}, ${table.sentUnnamed}, ${table.read}, ${table.missing}, ${table.invalid}, ${table.empty}, ${table.unreadable}, ${table.specsOk}, ${table.specsFailed}, ${table.specsSkipped}, ${table.linesCoded}, ${table.recorded}, ${table.lines}, ${table.linesEdited}, ${table.linesSkipped}, ${table.linesItem}, ${table.linesFigures}, ${table.totalsCorrected}, ${table.codesWritten}, ${table.within5m}, ${table.within15m}, ${table.within1h}, ${table.within1d}, ${table.later}) >= 0`,
    ),
    check('tax_receipt_days_edited_within_lines', sql`${table.linesEdited} <= ${table.lines}`),
  ],
)

/**
 * «Написать разработчику» (MOL-147): what a person wrote to the one who builds the app. Not a
 * review — `verdicts.review` is that — so nothing reads it but the owner. The `id` is the number the
 * owner sees, `#fb42`, so it is the server's and counts up.
 *
 * A thread is its first message and what follows it (MOL-150, В-1): `thread_id` names the first
 * message on a continuation and is empty on the first, `in_reply_to` the owner's reply a continuation
 * answers. The continuations come from the bot (MOL-148), and so do the empty `route`, `platform`,
 * `page_build` and `client_key`: Telegram has no screen, and a repeat there is the same words to the
 * same reply within a day (review №9, round 2 Г1). A thread lives a year from its last message (В-4).
 *
 * **The database holds the thread, not the writer** (MOL-148, adversarial В5 of MOL-147): a
 * continuation names only a first message, and only its own person's — `head` and `thread_head` are
 * there for that key alone, since a key cannot compare with a constant — or `purgeStale`, grouping
 * by `coalesce(thread_id, id)`, took a thread with a fresh word in it. And `in_reply_to` names only a
 * reply to the same person, or erasing one person cascaded into another's row.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<FeedbackKind>().notNull(),
    text: text('text').notNull(),
    locale: text('locale').notNull(),
    pageBuild: text('page_build'),
    apiBuild: text('api_build').notNull(),
    route: text('route'),
    platform: text('platform'),
    errorCode: text('error_code'),
    fromError: boolean('from_error').notNull().default(false),
    threadId: bigint('thread_id', { mode: 'number' }),
    inReplyTo: bigint('in_reply_to', { mode: 'number' }),
    head: boolean('head')
      .notNull()
      .generatedAlwaysAs((): SQL => sql`thread_id is null`),
    // True on a continuation and empty on a first message, so the key below is checked only there.
    threadHead: boolean('thread_head').generatedAlwaysAs(
      (): SQL => sql`case when thread_id is not null then true end`,
    ),
    // The thread a row is of — its first message's id — for the key a continuation answers by.
    threadKey: bigint('thread_key', { mode: 'number' })
      .notNull()
      .generatedAlwaysAs((): SQL => sql`coalesce(thread_id, id)`),
    clientKey: uuid('client_key'),
    // How many pictures went with it (MOL-167): `feedback_pictures` holds them, this only the count,
    // so the rule «words or a picture» is the table's own.
    pictures: smallint('pictures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  // Typed by hand: `feedback` and `feedback_replies` name each other, and inference goes round.
  (table): PgTableExtraConfigValue[] => [
    // A repeat of the same content is found by its key, within one person (MOL-150, Р-4).
    unique('feedback_actor_client_key').on(table.actorId, table.clientKey),
    unique('feedback_id_actor_head_key').on(table.id, table.actorId, table.head),
    unique('feedback_id_actor_thread_key').on(table.id, table.actorId, table.threadKey),
    // A continuation names a first message of the same person, and goes with it.
    foreignKey({
      name: 'feedback_thread_is_owners',
      columns: [table.threadId, table.actorId, table.threadHead],
      foreignColumns: [table.id, table.actorId, table.head],
    }).onDelete('cascade'),
    // A continuation answers the owner's reply in its own thread, never another's — not even another
    // thread of the same person, or `purgeStale` took the fresh word with the old thread (MOL-148,
    // adversarial В5).
    foreignKey({
      name: 'feedback_answers_own_reply',
      columns: [table.inReplyTo, table.actorId, table.threadKey],
      foreignColumns: [feedbackReplies.id, feedbackReplies.actorId, feedbackReplies.threadId],
    }).onDelete('cascade'),
    // The day's limit counts one person's messages over a window.
    index('feedback_actor_created_idx').on(table.actorId, table.createdAt),
    index('feedback_thread_idx').on(table.threadId),
    check('feedback_kind_known', oneOf(table.kind, FEEDBACK_KINDS)),
    check('feedback_locale_known', oneOf(table.locale, LOCALES)),
    // A code is what an error screen knew; a message from the settings has none.
    check('feedback_code_from_error', sql`${table.errorCode} is null or ${table.fromError}`),
    check(
      'feedback_thread_not_itself',
      sql`${table.threadId} is null or ${table.threadId} < ${table.id}`,
    ),
    // A continuation, and only a continuation, answers a reply (В-1): the person replies in Telegram.
    check(
      'feedback_continuation_answers',
      sql`(${table.threadId} is null) = (${table.inReplyTo} is null)`,
    ),
    // Words, a picture, or both (MOL-167, В-3).
    check('feedback_says_something', sql`${table.text} <> '' or ${table.pictures} > 0`),
    check(
      'feedback_pictures_range',
      sql`${table.pictures} between 0 and ${sql.raw(String(FEEDBACK_PICTURES_MAX))}`,
    ),
  ],
)

/**
 * The owner's replies (MOL-150, Р-1), written by the bot's half (MOL-148). Kept so the copy is whole
 * and a continuation shows the owner what is answered; they go with their message. `actor_id` and
 * `thread_id` are the message's author and thread, there for the key a continuation answers by
 * (adversarial В5 of MOL-147 and of MOL-148).
 *
 * `telegram_message_id` is the message the reply went out as in the person's chat (MOL-148, В-2): a
 * person answering it in Telegram is how their word finds its thread, with no number shown to them.
 * Message ids are per chat, so it is looked up beside the person, never alone.
 */
export const feedbackReplies = pgTable(
  'feedback_replies',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    feedbackId: bigint('feedback_id', { mode: 'number' }).notNull(),
    actorId: uuid('actor_id').notNull(),
    threadId: bigint('thread_id', { mode: 'number' }).notNull(),
    text: text('text').notNull(),
    delivered: text('delivered').$type<FeedbackDelivery>(),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      name: 'feedback_replies_message_is_owners',
      columns: [table.feedbackId, table.actorId, table.threadId],
      foreignColumns: [feedback.id, feedback.actorId, feedback.threadKey],
    }).onDelete('cascade'),
    unique('feedback_replies_id_actor_thread_key').on(table.id, table.actorId, table.threadId),
    unique('feedback_replies_telegram_message_key').on(table.actorId, table.telegramMessageId),
    index('feedback_replies_feedback_idx').on(table.feedbackId),
    check(
      'feedback_replies_delivered_known',
      sql`${table.delivered} is null or ${oneOf(table.delivered, FEEDBACK_DELIVERY)}`,
    ),
  ],
)

/**
 * Failures of the API, the bot and the phone, one row a fingerprint (MOL-143, MOL-144): the kind,
 * the driver's code, the top frame without its position and the place — a route's template, a
 * handler of the bot, a job, a phone's catcher and screen — hashed together, so a failure that happens a thousand times is one row with a count.
 *
 * **A failure belongs to nobody** (Р-8 of MOL-149): no actor, no Telegram id, no address, no
 * session, no query, no body and no message — what `describeFailure` lets through and nothing
 * else. So there is no key to `actors`, and erasure and the copy have nothing here to reach; the
 * privacy page says only what a phone sends (MOL-144). Kept 30 days after the last time it happened.
 *
 * `build` is the last build it happened in, and `build_count` how many times there: the owner hears
 * of a fingerprint the first time in a build and at 10, 100 and 1000 (В-2, В-5).
 */
export const failures = pgTable(
  'failures',
  {
    fingerprint: char('fingerprint', { length: 64 }).primaryKey(),
    source: text('source').notNull(),
    errorName: text('error_name').notNull(),
    code: text('code'),
    route: text('route'),
    frames: text('frames').array().notNull(),
    build: text('build').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
    buildCount: integer('build_count').notNull(),
    /**
     * The phone's platform the last time it happened, `ios 18 app` (MOL-144, В-2): the one line
     * `platformLine` makes of the User-Agent, never the User-Agent. The API and the bot have none.
     */
    platform: text('platform'),
  },
  (table) => [
    check('failures_fingerprint_hex', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check('failures_source_known', oneOf(table.source, FAILURE_SOURCES)),
    check(
      'failures_lengths',
      sql`char_length(${table.errorName}) between 1 and ${sql.raw(String(FAILURE_NAME_MAX))}
          and (${table.code} is null or char_length(${table.code}) <= ${sql.raw(String(FAILURE_NAME_MAX))})
          and (${table.route} is null or char_length(${table.route}) <= ${sql.raw(String(FAILURE_ROUTE_MAX))})
          and cardinality(${table.frames}) <= ${sql.raw(String(FAILURE_FRAMES))}`,
    ),
    check(
      'failures_counts',
      sql`${table.count} >= ${table.buildCount} and ${table.buildCount} >= 1`,
    ),
    check('failures_seen_forward', sql`${table.lastSeenAt} >= ${table.firstSeenAt}`),
    check(
      'failures_platform_phone',
      sql`(${table.platform} is not null) = (${table.source} = 'phone')
          and (${table.platform} is null or char_length(${table.platform}) <= 32)`,
    ),
    index('failures_last_seen_at').on(table.lastSeenAt),
  ],
)

/**
 * What the API has queued for the owner's Telegram and the bot has not yet taken (MOL-143, Р-9 of
 * MOL-149): a kind and its fields, as `ownerNoticeSchema` reads them. The bot claims them every
 * minute and the claim marks them handed in its own transaction — at most once, as the rating
 * reminders are. Who the owner is lives in the API's environment, never here.
 *
 * Nothing in a notice about a failure belongs to a person, so there is no key to `actors`. A notice
 * about a message to the developer (MOL-148) carries its text, so it names the message by
 * `feedback_id` and goes with it — the person erased, or the thread a year old (Р-8 of MOL-150).
 */
export const ownerNotices = pgTable(
  'owner_notices',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    feedbackId: bigint('feedback_id', { mode: 'number' }).references(() => feedback.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    handedAt: timestamp('handed_at', { withTimezone: true }),
    // A notice about a message is handed until the bot says it went (MOL-148, adversarial В1): the
    // table holds nothing else of it, so a send that failed must not lose it.
    sentAt: timestamp('sent_at', { withTimezone: true }),
    tries: smallint('tries').notNull().default(0),
  },
  (table) => [
    check('owner_notices_kind_known', oneOf(table.kind, OWNER_NOTICE_KINDS)),
    check(
      'owner_notices_feedback_named',
      sql`(${oneOf(table.kind, FEEDBACK_NOTICE_KINDS)}) = (${table.feedbackId} is not null)`,
    ),
    index('owner_notices_feedback_idx').on(table.feedbackId),
    check('owner_notices_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
    check('owner_notices_payload_kind', sql`${table.payload} ->> 'kind' = ${table.kind}`),
    index('owner_notices_waiting')
      .on(table.id)
      .where(sql`${table.handedAt} is null`),
  ],
)

/** Where a broadcast starts: the nil uuid, before every `actors.id`. */
export const BROADCAST_START = '00000000-0000-0000-0000-000000000000'

/**
 * The message to people about a leak (MOL-237), queued by `make notify` and taken by the bot in
 * batches, the way the rating reminders are (В-1): whom it goes to and how far it has got, and nothing
 * of anyone — so no key to `actors`, nothing for erasure or the person's copy. Who gets it is decided
 * at each claim from `actors`: created before the broadcast, of its countries, the bot not blocked.
 *
 * `cursor` is where the bot has got to in the order of `actors.id`: everybody up to it is done. It
 * moves only by the bot's report, so a batch never reported goes out again (better twice than never),
 * and it always names a live person or nobody (`BROADCAST_START`, before everyone) — the report and
 * erasure both put it on the nearest live id at or below, which leaves the same people after it, so no
 * erased id stays here. `lease_until` keeps a handed batch from going out twice while it is sent.
 */
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    text: text('text').notNull(),
    /** The people of these countries only; empty — everybody. */
    countries: char('countries', { length: 2 }).array(),
    /** A try on the owner alone (`OWNER_TELEGRAM_ID` of the API), before everybody (В-3). */
    ownerOnly: boolean('owner_only').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** How many people it was going to when queued, and how many had the bot blocked then. */
    total: integer('total').notNull(),
    blockedAtStart: integer('blocked_at_start').notNull(),
    cursor: uuid('cursor').notNull().default(BROADCAST_START),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    sent: integer('sent').notNull().default(0),
    /** Telegram answered 403 — blocked since it was queued — and the person was marked so (MOL-103). */
    blocked: integer('blocked').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    check('broadcasts_text_present', sql`char_length(${table.text}) between 1 and 4096`),
    check(
      'broadcasts_audience_one',
      sql`${table.countries} is null
          or (cardinality(${table.countries}) >= 1 and not ${table.ownerOnly})`,
    ),
    check(
      'broadcasts_counts_non_negative',
      sql`${table.total} >= 0 and ${table.blockedAtStart} >= 0
          and ${table.sent} >= 0 and ${table.blocked} >= 0 and ${table.failed} >= 0`,
    ),
    // One broadcast to people at a time: a second `--yes` would write to everybody twice. The try
    // on the owner alone is not one of them.
    uniqueIndex('broadcasts_one_going')
      .on(table.ownerOnly)
      .where(
        sql`${table.finishedAt} is null and ${table.cancelledAt} is null and not ${table.ownerOnly}`,
      ),
  ],
)

/** Bytes as Postgres keeps them: a receipt's photo and its cut-out lines (MOL-125). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

/**
 * The pictures of a message to the developer (MOL-167), by their position: the line of each that
 * stays with the message — where it came from, its sides and size, and when it reached the owner's
 * Telegram (`sent_at`, empty for one that never did). The picture itself is `feedback_picture_files`,
 * kept only until then (В-1).
 *
 * A picture comes from the phone — a JPEG the API stripped of its metadata (Р-2) — or from Telegram,
 * a photo a person sent the bot (Р-8). `fingerprint` tells the same picture sent again from another —
 * the sha256 of the bytes kept, or Telegram's `file_unique_id` — and outlives the picture, since a
 * repeat is looked for after it went.
 */
export const feedbackPictures = pgTable(
  'feedback_pictures',
  {
    feedbackId: bigint('feedback_id', { mode: 'number' })
      .notNull()
      .references(() => feedback.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    source: text('source').$type<'phone' | 'telegram'>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    bytes: integer('bytes'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.feedbackId, table.position] }),
    check(
      'feedback_pictures_position_range',
      sql`${table.position} between 1 and ${sql.raw(String(FEEDBACK_PICTURES_MAX))}`,
    ),
    check('feedback_pictures_source_known', sql`${table.source} in ('phone', 'telegram')`),
    check('feedback_pictures_bytes_size', sql`${table.bytes} is null or ${table.bytes} > 0`),
    check('feedback_pictures_sides_positive', sql`${table.width} > 0 and ${table.height} > 0`),
  ],
)

/**
 * A picture of a message while it waits for the owner's bot (MOL-167, В-1): the phone's JPEG, or the
 * id Telegram keeps a person's photo by. The row goes when the bot says the notice went, or after
 * `FEEDBACK_PICTURE_KEPT_DAYS` the bot never took it — the bot away, or a copy with no owner. **Never
 * in the nightly copy** (`backup.sh`), as a receipt's photo: a table of its own, so the line of a
 * picture in `feedback_pictures` comes back from a restore while the picture does not (adversarial А5).
 */
export const feedbackPictureFiles = pgTable(
  'feedback_picture_files',
  {
    feedbackId: bigint('feedback_id', { mode: 'number' }).notNull(),
    position: smallint('position').notNull(),
    image: bytea('image'),
    telegramFileId: text('telegram_file_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.feedbackId, table.position] }),
    foreignKey({
      name: 'feedback_picture_files_line',
      columns: [table.feedbackId, table.position],
      foreignColumns: [feedbackPictures.feedbackId, feedbackPictures.position],
    }).onDelete('cascade'),
    // One or the other: the phone's bytes, or Telegram's id.
    check(
      'feedback_picture_files_one_source',
      sql`(${table.image} is null) <> (${table.telegramFileId} is null)`,
    ),
    check(
      'feedback_picture_files_image_size',
      sql`${table.image} is null
          or octet_length(${table.image}) between 1 and ${sql.raw(String(FEEDBACK_PICTURE_BYTES_MAX))}`,
    ),
    // The timer looks for pictures held past their week.
    index('feedback_picture_files_created_idx').on(table.createdAt),
  ],
)

/**
 * A receipt photographed on the phone and read on our server (MOL-125). Named by the device, as
 * everything written offline is: a receipt sent twice from the queue is one receipt; «Переснять» is
 * a new one. The head the reader found — the seller's tax number, the printed day, the number, the
 * total — sits on the row; the lines are `receipt_lines`.
 *
 * What lives how long (В-3): a receipt not recorded goes whole 28 days after it arrived, a removed
 * one after the ten minutes of «Вернуть», as everything of «Деньги» (П-8, MOL-73), a recorded one
 * with its trip removed for good (MOL-240).
 */
export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    status: text('status').$type<ReceiptStatus>().notNull(),
    failure: text('failure').$type<ReceiptFailure>(),
    // A photo read by our reader, or a Serbian receipt's link asked of the tax office (MOL-232).
    source: text('source').$type<ReceiptSource>().notNull().default('photo'),
    parts: smallint('parts').notNull(),
    country: char('country', { length: 2 }).$type<ReceiptCountry>().notNull(),
    // When the tax office is asked next about a receipt it did not show yet (MOL-232, Р-2).
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    // How a receipt's link reached the phone, and whether the camera missed before it (MOL-234): the
    // measure of the risk of MOL-233. Empty on a photo, and on a link a phone of an earlier build sent.
    via: text('via').$type<ReceiptVia>(),
    qrMissed: boolean('qr_missed'),
    // The language the lines are to be read out in: the interface's, which nothing else keeps (П-4).
    language: text('language').$type<AppLocale>().notNull(),
    currency: char('currency', { length: 3 }).$type<Currency>().notNull(),
    // The phone's moment of the shot; every other moment here is the server's.
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    readingAt: timestamp('reading_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    // Readings begun: one cut short by a restart is begun again, twice at most. Of a receipt by its
    // link, the asks of the tax office (MOL-232).
    attempts: smallint('attempts').notNull().default(0),
    // Tesseract and its language files, as the reader names them — which model read (MOL-169).
    readerVersion: text('reader_version'),
    layout: text('layout').$type<ReceiptLayout>(),
    tin: text('tin'),
    // A Serbian seller's premises: the tax office's code of one shop of a chain, whose every shop
    // shares the tax number, and the shop's own name, what a new place is proposed as (MOL-232, Р-7).
    shopUnit: text('shop_unit'),
    shop: text('shop'),
    printedOn: date('printed_on'),
    printedTime: text('printed_time'),
    receiptNo: text('receipt_no'),
    // In the receipt's own currency: the total two sources vouch for — the lines that met it, or two
    // places printed (MOL-244) — the review's and the trip's.
    totalMinor: bigint('total_minor', { mode: 'bigint' }),
    // The total as the reading found it in one place, vouched for or not (MOL-244): only what «Прочитали
    // не всё» measures the lines against, never a total shown or recorded.
    readTotalMinor: bigint('read_total_minor', { mode: 'bigint' }),
    balanced: boolean('balanced').notNull().default(false),
    // The city of the settings its address prints (MOL-126, Р-6), where its place is looked for.
    city: text('city').$type<ReceiptCity>(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    // How the person learned it was read (MOL-129): the phone was handed it, or the bot said so —
    // whichever came first. «Чек разобран» goes only to whoever was not handed it.
    heard: text('heard').$type<ReceiptHeard>(),
    heardAt: timestamp('heard_at', { withTimezone: true }),
    // The purchases it was recorded as (MOL-126). The trip removed for good takes the receipt with it
    // (MOL-240): nobody sees a recorded receipt without its trip, so nothing else would ever remove it.
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('receipts_actor_created_idx').on(table.actorId, table.createdAt),
    // One trip is one receipt's (MOL-126): what dates it on the accounts, names it «из чека» and
    // finds a seller's place is read by the trip, each history row and each account a step.
    uniqueIndex('receipts_trip_key')
      .on(table.tripId)
      .where(sql`${table.tripId} is not null`),
    // A seller's place is read off its recorded receipts on every look at a receipt (MOL-126).
    index('receipts_recorded_tin_idx')
      .on(table.tin)
      .where(sql`${table.status} = 'recorded'`),
    // The queue: the oldest receipt waiting for the reader is one index step.
    index('receipts_queue_idx')
      .on(table.queuedAt)
      .where(sql`${table.status} = 'queued' and ${table.deletedAt} is null`),
    // The receipts by their link whose ask of the tax office is due (MOL-232).
    index('receipts_link_queue_idx')
      .on(table.nextAttemptAt)
      .where(
        sql`${table.source} = 'tax' and ${table.status} = 'queued' and ${table.deletedAt} is null`,
      ),
    // The bot's claim (MOL-129): receipts read that nobody has been told of yet, by when they were.
    index('receipts_untold_idx')
      .on(table.readAt)
      .where(
        sql`${table.status} in ('parsed', 'failed') and ${table.heard} is null and ${table.deletedAt} is null`,
      ),
    check('receipts_status_known', oneOf(table.status, receiptStatusSchema.options)),
    check(
      'receipts_failure_known',
      sql`${table.failure} is null or ${oneOf(table.failure, receiptFailureSchema.options)}`,
    ),
    // A failure is said exactly when the receipt failed.
    check(
      'receipts_failure_of_failed',
      sql`(${table.status} = 'failed') = (${table.failure} is not null)`,
    ),
    check('receipts_source_known', oneOf(table.source, receiptSourceSchema.options)),
    // A photo has its parts; a receipt by its link has none (MOL-232).
    check(
      'receipts_parts_range',
      sql`(${table.source} = 'photo' and ${table.parts} between 1 and ${sql.raw(String(RECEIPT_PARTS_MAX))})
          or (${table.source} = 'tax' and ${table.parts} = 0)`,
    ),
    // A receipt by its link waiting in the tax office's queue knows when it is asked next (MOL-232).
    check(
      'receipts_asked_when_queued',
      sql`${table.source} = 'photo' or ${table.status} <> 'queued' or ${table.nextAttemptAt} is not null`,
    ),
    check(
      'receipts_via_known',
      sql`${table.via} is null or ${oneOf(table.via, receiptViaSchema.options)}`,
    ),
    // A photo came by no link; whether the camera missed is said only of how the link came (MOL-234).
    check(
      'receipts_via_of_link',
      sql`(${table.source} = 'tax' or (${table.via} is null and ${table.qrMissed} is null))
          and (${table.qrMissed} is null or ${table.via} is not null)`,
    ),
    check('receipts_country_known', oneOf(table.country, receiptCountrySchema.options)),
    check('receipts_language_known', oneOf(table.language, LOCALES)),
    check('receipts_currency_known', oneOf(table.currency, currencySchema.options)),
    check(
      'receipts_whole_when_queued',
      sql`${table.status} = 'uploading' or ${table.queuedAt} is not null`,
    ),
    check('receipts_attempts_non_negative', sql`${table.attempts} >= 0`),
    // A recorded receipt is its trip's (MOL-240): one without would lie on the server unseen.
    check(
      'receipts_recorded_with_trip',
      sql`${table.status} <> 'recorded' or ${table.tripId} is not null`,
    ),
    check(
      'receipts_city_known',
      sql`${table.city} is null or ${oneOf(table.city, RECEIPT_CITIES)}`,
    ),
    check(
      'receipts_layout_known',
      sql`${table.layout} is null or ${oneOf(table.layout, RECEIPT_LAYOUTS)}`,
    ),
    check(
      'receipts_heard_known',
      sql`${table.heard} is null or ${oneOf(table.heard, receiptHeardSchema.options)}`,
    ),
    check('receipts_heard_when', sql`(${table.heard} is null) = (${table.heardAt} is null)`),
    check(
      'receipts_total_non_negative',
      sql`${table.totalMinor} is null or ${table.totalMinor} >= 0`,
    ),
    check(
      'receipts_read_total_non_negative',
      sql`${table.readTotalMinor} is null or ${table.readTotalMinor} >= 0`,
    ),
  ],
)

/**
 * The link of a Serbian receipt by its QR code (MOL-232), kept only while the tax office is still to be
 * asked: the buyer's tax id may be in it (Р-4) — read, refused or given up, the row is deleted in the
 * same statement. **A table of its own so the nightly copy leaves it out** (`backup.sh`, adversarial А4),
 * as a photo's: a receipt waits up to two days, and a copy kept fourteen would keep the link longer than
 * `/privacy` says. A restore brings it back empty, and a receipt left without its link fails.
 */
export const receiptLinks = pgTable('receipt_links', {
  receiptId: uuid('receipt_id')
    .primaryKey()
    .references(() => receipts.id, { onDelete: 'cascade' }),
  link: text('link').notNull(),
})

/**
 * A receipt's photo, part by part, top to bottom (MOL-124 В-1): the JPEG the phone cropped to the
 * receipt's edges. Kept until the receipt is recorded, removed or 28 days old — and never in the
 * nightly copy of the database (В-2): a photo carries the customer's name.
 */
export const receiptParts = pgTable(
  'receipt_parts',
  {
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    photo: bytea('photo').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.receiptId, table.position] }),
    check(
      'receipt_parts_position_range',
      sql`${table.position} between 1 and ${sql.raw(String(RECEIPT_PARTS_MAX))}`,
    ),
    check(
      'receipt_parts_photo_size',
      sql`octet_length(${table.photo}) between 1 and ${sql.raw(String(RECEIPT_PART_BYTES_MAX))}`,
    ),
    check('receipt_parts_sides_positive', sql`${table.width} > 0 and ${table.height} > 0`),
  ],
)

/**
 * The lines the reader laid a receipt out into, in the order printed (MOL-125): as printed, with the
 * customs heading and the till's article, and the figures the receipt's own arithmetic chose. Every
 * amount is in the receipt's currency. Machine output, written once per reading; a person's edits
 * and the purchases are MOL-126's.
 */
export const receiptLines = pgTable(
  'receipt_lines',
  {
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    printed: text('printed').notNull(),
    hs: text('hs'),
    sku: text('sku'),
    qtyMilli: bigint('qty_milli', { mode: 'bigint' }),
    qtyUnit: text('qty_unit').$type<BaseUnit>(),
    priceMinor: bigint('price_minor', { mode: 'bigint' }),
    sumMinor: bigint('sum_minor', { mode: 'bigint' }),
    discountMinor: bigint('discount_minor', { mode: 'bigint' }),
    settled: boolean('settled').notNull(),
    // The item the parse found (MOL-126): by the catalogue's names or its search; null — a new one,
    // named by `translation`. The shop's memory is laid over it on every reading of the receipt.
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    match: text('match').$type<ReceiptParsedMatch>(),
    // The line word by word in the language of the receipt, by the dictionary of till words.
    translation: text('translation'),
    // The package's code the Serbian tax office's specification gave the line (MOL-234): only one the
    // catalogue would take (`writtenBarcode`), never a shop's own. Written to an item only by the person.
    gtin: text('gtin'),
    // The purchase the line was recorded as: a change of its item later teaches the memory (Р-2). The
    // purchase removed takes its line (MOL-240); a line not recorded goes at «Записать».
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'cascade' }),
    // «Записать» recorded the line as read — it added up, its quantity and sum unchanged (В-4): its price
    // is the shelf's, what the person's word in the shops' memory carries (MOL-240, round 4, Р4-1). Judged
    // once, at the record: a sum put right later is what was paid, never the shelf. `null` — no record of
    // this build judged it: read and not recorded, or recorded by an image rolled back (round 6, Р6-1).
    asRead: boolean('as_read'),
  },
  (table) => [
    primaryKey({ columns: [table.receiptId, table.position] }),
    index('receipt_lines_item_idx').on(table.itemId),
    check('receipt_lines_position_non_negative', sql`${table.position} >= 0`),
    check(
      'receipt_lines_quantity_whole',
      sql`(${table.qtyMilli} is null) = (${table.qtyUnit} is null)`,
    ),
    check(
      'receipt_lines_quantity_positive',
      sql`${table.qtyMilli} is null or ${table.qtyMilli} > 0`,
    ),
    check(
      'receipt_lines_unit_known',
      sql`${table.qtyUnit} is null or ${oneOf(table.qtyUnit, baseUnitSchema.options)}`,
    ),
    uniqueIndex('receipt_lines_expense_key').on(table.expenseId),
    check(
      'receipt_lines_match_known',
      sql`${table.match} is null or ${oneOf(table.match, receiptParsedMatchSchema.options)}`,
    ),
    check(
      'receipt_lines_gtin_shape',
      sql`${table.gtin} is null or ${table.gtin} ~ '^([0-9]{8}|[0-9]{12,14})$'`,
    ),
    check(
      'receipt_lines_amounts_non_negative',
      sql`coalesce(${table.priceMinor}, 0) >= 0 and coalesce(${table.sumMinor}, 0) >= 0 and coalesce(${table.discountMinor}, 0) >= 0`,
    ),
  ],
)

/**
 * The item lines of a receipt cut out of its photo, row by row — the name and the figures, never
 * the head with the customer's name nor the total — for retraining the reader (MOL-169, owner,
 * 02.10.2026). Cut when the receipt is read; recording it (MOL-126) writes the text a person
 * confirmed, and from then on a row lives 28 days — or until its line goes (MOL-240). Never in the
 * nightly copy (В-2).
 */
export const receiptLineImages = pgTable(
  'receipt_line_images',
  {
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    // The row of the line: its name first, its figures after.
    piece: smallint('piece').notNull(),
    image: bytea('image').notNull(),
    // What the reader read on this row; the text a person confirmed comes with the record.
    readText: text('read_text').notNull(),
    confirmedText: text('confirmed_text'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.receiptId, table.position, table.piece] }),
    // A row is a picture of its line, and goes with it (MOL-240): the positions are the lines'.
    foreignKey({
      name: 'receipt_line_images_line',
      columns: [table.receiptId, table.position],
      foreignColumns: [receiptLines.receiptId, receiptLines.position],
    }).onDelete('cascade'),
    index('receipt_line_images_confirmed_idx').on(table.confirmedAt),
    check('receipt_line_images_piece_range', sql`${table.piece} between 0 and 3`),
    check(
      'receipt_line_images_confirmed_whole',
      sql`(${table.confirmedText} is null) = (${table.confirmedAt} is null)`,
    ),
  ],
)

/**
 * The shop's memory (MOL-126): «01282006 + 1163909 — молоко 3,2 %» is a fact about the shop, not the
 * person (owner, 30.09.2026), so it is shared. A row is one person's word on one key: recording a
 * receipt writes it, a change of a recorded line's item rewrites it. Read: the person's own word first,
 * else the item most people said, the later on a tie. Erasure leaves the row without its author — the
 * word still counts, as an item outlives its author (MOL-58). The price is the shelf price per unit the
 * article had, the memory's argument when a figure reads two ways (В-1).
 */
export const storeMemory = pgTable(
  'store_memory',
  {
    id: uuid('id').primaryKey(),
    tin: text('tin').notNull(),
    kind: text('kind').$type<StoreMemoryKind>().notNull(),
    key: text('key').notNull(),
    actorId: uuid('actor_id').references((): AnyPgColumn => actors.id, { onDelete: 'set null' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    priceMinor: bigint('price_minor', { mode: 'bigint' }),
    priceCurrency: char('price_currency', { length: 3 }).$type<Currency>(),
    writtenAt: timestamp('written_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // one word per person and key; the erased are many words of nobody
    uniqueIndex('store_memory_word_key').on(table.tin, table.kind, table.key, table.actorId),
    index('store_memory_item_idx').on(table.itemId),
    index('store_memory_actor_idx').on(table.actorId),
    check('store_memory_kind_known', oneOf(table.kind, storeMemoryKindSchema.options)),
    check(
      'store_memory_price_whole',
      sql`(${table.priceMinor} is null) = (${table.priceCurrency} is null)`,
    ),
    check(
      'store_memory_price_non_negative',
      sql`${table.priceMinor} is null or ${table.priceMinor} >= 0`,
    ),
    check(
      'store_memory_currency_known',
      sql`${table.priceCurrency} is null or ${oneOf(table.priceCurrency, currencySchema.options)}`,
    ),
  ],
)
