import { and, asc, desc, eq, exists, inArray, isNull, notExists, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { DomainError, ERROR, UNIT_PRICE_SCALE, expenseSchema } from '@molvia/model'
import type {
  AdviceScope,
  BaseUnit,
  Currency,
  Expense,
  ExpensePatch,
  NewExpense,
  PendingVerdicts,
} from '@molvia/model'
import { moneyFrom, moneyTo, quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { kindAt } from './kind-word'
import { idOrNull, rowLimit } from './rows'
import { expenses, identityOf, items, placeIdentity, places, trips, verdicts } from './schema'

/** An expense to add, named by the device that adds it (MOL-21, В-2). */
export type ExpenseToAdd = NewExpense & { readonly id: string }

export interface ExpenseRepository {
  /**
   * The only required field is the item; everything else may be filled in later.
   *
   * The identifier comes from the device, so a queue that sends twice after a lost reply writes
   * one purchase, not two: the same identifier in the same trip for the same item is a repeat
   * and returns the row already there with `created: false` — the first write wins, the fields
   * sent again are not applied. Anything else holding that identifier is `CONFLICT`.
   *
   * A finished trip takes expenses like an open one (MOL-21, В-8): the soy sauce found in the
   * bag at home belongs to the trip it was bought on.
   */
  add(actorId: string, input: ExpenseToAdd): Promise<{ expense: Expense; created: boolean }>
  /**
   * Every expense of one trip, and deliberately without a limit — the one exception to the
   * rule that a listing takes one. A trip is a single visit to a single shop, the screen
   * shows its rows in full, and a truncated list would quietly disagree with the total
   * computed from the same rows.
   */
  forTrip(tripId: string, actorId: string): Promise<Expense[]>
  /**
   * The expense is named with its trip, and both are conditions of the statement: a row of the
   * person's other trip, named under this one, is not found rather than changed — and the
   * identifiers are compared by Postgres as uuids, so an upper-case one a device sent is the same
   * row (MOL-21, adversarial В). `null` when no row matched.
   */
  update(id: string, tripId: string, actorId: string, patch: ExpensePatch): Promise<Expense | null>
  /** `false` when no row matched — gone already, someone else's, or of another trip. */
  remove(id: string, tripId: string, actorId: string): Promise<boolean>
  /** Bought but not yet rated — by this person, since a stranger's verdict is not an opinion. */
  unratedFor(actorId: string, limit: number): Promise<Expense[]>
  /**
   * The same purchases as the screen «Оценки» asks about them (MOL-28): one row per item, with
   * the name, the place and the day of the latest purchase, newest first, and how many items
   * wait in all. The day is when the row was entered, but never after its trip was finished
   * (owner's decision, R6): the sauce found in the bag at home and written into last week's
   * trip was bought that week, and a trip left open for days takes today's cheese today. The
   * one case it misses is an open trip sent late by an offline queue.
   *
   * Products only — a dish is rated where it was served, and until 0.3 the verdict path
   * refuses a place, so a dish here would be a question with no way to answer it.
   *
   * With `bought`, the same question asked by the rating reminder (MOL-101): only purchases whose
   * day falls in `[from, to)`, and none made before the person withdrew their verdict on the item —
   * the answer to MOL-29 (В-3): a purchase after the withdrawal is a new experience and is asked
   * about, one before it the person has already had their say on and taken back. The screen asks
   * without it and is unchanged.
   */
  pendingVerdictsFor(
    actorId: string,
    limit: number,
    bought?: { readonly from: Date; readonly to: Date },
  ): Promise<PendingVerdicts>
  /**
   * «Что брать»: what each place charges, one row per place, currency and unit — the **last**
   * price paid there, not the lowest ever (MOL-166; the owner's decision of MOL-92, В-3: «цены в
   * магазинах подниматься могут, а вот спускаются редко»). Where this person bought, their own
   * last purchase, in either mode, by the rule «Тут дешевле» reads (`latestFirst`): the home and
   * the sheet name one price for one milk. A place opened by other people (the shared mode, Р-17)
   * is the lower median of each buyer's own last price there (В-1) — three people's figure, never
   * the receipt of whoever bought last, which anyone looking twice would read as it changed — and
   * only of last purchases within `freshDays` (adversarial Б).
   *
   * «Last» is the place's, not the pair's (adversarial А): a pair the last purchase was not made in
   * is not the place's price at all, and is left out — three August kilos at a discount do not name
   * a shop where a pack was bought in September.
   *
   * The limit has a default rather than being required, because the number of rows follows
   * the number of places a person shopped in — a handful in 0.1 — and every caller today
   * wants all of them. It is still an argument: in the shared mode the same aggregate counts
   * other people's data, and then the caller, not the data, decides how much comes back.
   */
  placePricesFor(query: PriceQuery): Promise<PlacePrice[]>
  /**
   * The lower median of the unit prices seen for an item, one row per currency and unit
   * (MOL-31, Р-2 — the answer to MOL-33). «Стоит брать дешевле …» is that number, and the
   * caller, not this file, decides how many observations it takes to show one.
   *
   * `percentile_disc(0.5)` returns an observation that actually happened and, on an even
   * count, the lower of the two middle ones — the same rule `isRateJump` follows, and for
   * the same reason: half a median between two prices is a price nobody ever paid.
   */
  medianPriceFor(query: PriceQuery): Promise<PriceMedian[]>
  /**
   * «Тут дешевле» (MOL-92): the **last** price this person paid in each place of the city, one
   * row per item and place, in the currency and unit of that last purchase (MOL-166, adversarial
   * А) — «цены в магазинах подниматься могут, а вот спускаются редко» (owner's decision, В-3).
   * Built on the rows the other two aggregates read, in the own mode and only in the city asked
   * about (В-4). Each item's places come cheapest first inside a currency and unit.
   *
   * «Last» is by the day of the record as the phone named it (MOL-121), then the moment it
   * began, then the moment the row was written: two packs in one record — the later one.
   */
  ownLatestFor(query: OwnLatestQuery): Promise<OwnLatestPrice[]>
  /**
   * The other products this person bought with a price in the city whose word of the kind is
   * `kind` (`kindKey`, MOL-45; MOL-92, В-7) — the candidates for «другое молоко». Ids only, at
   * most `limit`: whether they are rated, and how, is the verdicts' to say.
   */
  ownItemsOfKind(query: OwnKindQuery): Promise<string[]>
}

/**
 * What «Что брать» asks the expenses for.
 *
 * In the own mode the person's own purchases count, wherever they were made: their data is
 * theirs. In the shared mode everyone's do, but only in their own city (Р-10) — a verdict
 * travels with the person and a price does not, so an Erevan price beside a Gyumri one would
 * read as «cheaper» while meaning «elsewhere».
 */
export interface PriceQuery {
  readonly actorId: string
  readonly itemIds: readonly string[]
  readonly scope: AdviceScope
  /**
   * How many people must have bought it before their prices may be shown together — the
   * domain's `AGGREGATE_MIN_CONTRIBUTIONS`, passed in rather than known here. Below it the
   * answer falls back to this person's own purchases, because one stranger's price in one
   * shop is their basket, and «expenses are always private» (Р-17).
   */
  readonly minBuyers: number
  /**
   * How long another person's last purchase still counts towards a place opened by other people —
   * the domain's `SHARED_PRICE_FRESH_DAYS` (MOL-166, adversarial Б). Read by `placePricesFor`
   * alone; one's own last purchase has no window.
   */
  readonly freshDays: number
  /** Where this person is. Read only in the shared mode. */
  readonly country: string
  readonly city: string
  readonly limit?: number
  /** A purchase left out — the one the sheet amends, never compared with itself (MOL-92, Т-9). */
  readonly except?: string
  /**
   * The phone's zone (MOL-121), for the day of a record from an old queue — the same one «Тут
   * дешевле» reads it in, or the two would disagree about which purchase was the last (MOL-166).
   * Read by `placePricesFor` alone; Yerevan's without one.
   */
  readonly zone?: string
  /**
   * The phone's today (`TODAY_HEADER`, MOL-121), which `freshDays` counts back from — «today» is
   * the phone's on the server too. Without one, the server's day in `zone`.
   */
  readonly today?: string
}

/** What «Тут дешевле» asks for (MOL-92): this person's own purchases, in the city of the record. */
export interface OwnLatestQuery {
  readonly actorId: string
  readonly itemIds: readonly string[]
  readonly country: string
  readonly city: string
  readonly except?: string
  /**
   * The phone's zone (MOL-121): a record from an old queue has no day of its own, and its moment is
   * read as a day in this zone — the one its printed day is counted in, or the two would disagree
   * on which purchase was the last (review №3). Yerevan's without one.
   */
  readonly zone?: string
}

/** The candidates for «другое молоко» (MOL-92, В-7): the word of the kind, and whom to leave out. */
export interface OwnKindQuery {
  readonly actorId: string
  /** `kindKey` of the item on the sheet; empty matches nothing. */
  readonly kind: string
  readonly notItem: string
  readonly country: string
  readonly city: string
  readonly limit: number
}

/**
 * How many priced places one call brings back by default. A person shops in a handful of
 * places, and «Что брать» shows the first plus a short «ещё здесь» — so this is generous
 * rather than tight, and it exists to bound the answer, not to shape the screen.
 */
const PLACES_PER_ITEM = 50

/** The day of a moment the phone named no zone for is Yerevan's (MOL-121). */
const YEREVAN = 'Asia/Yerevan'

/**
 * Not a domain entity but the result of an aggregate: a place and what it charges — its last
 * unit price (MOL-166). Currency and unit are part of the key rather than of the value — two
 * prices in different currencies have no common ground without a rate, and the rate is a
 * snapshot of one trip.
 */
export interface PlacePrice {
  readonly itemId: string
  readonly placeId: string
  /** Carried rather than looked up after: the statement already joins the place for its city. */
  readonly placeName: string
  readonly currency: Currency
  readonly unit: BaseUnit
  /** The same scale `unitPrice()` produces, so the domain can compare these directly. */
  readonly scaledMinor: bigint
  readonly observations: number
  /**
   * The day of the most recent **visit** in which this was bought — `trips.started_at`, not
   * the moment a row reached the server (F4) — and at a place of one's own, one's own visit, as
   * its price is (adversarial М). It is what a place of another pair is set against on the row
   * (Н), and it is named after the trip on purpose: called «the latest purchase» it invited the
   * next reader to «fix» it back to `created_at`, which is what the offline queue stamps.
   */
  readonly latestVisitAt: Date
  /**
   * What the pair this row is in weighs for Р-4: every purchase of the item in this currency and
   * unit, in every place, and the latest visit among them — including places the pair does not
   * name because their last purchase was made in another (MOL-166, adversarial Д). The same on
   * every row of one pair.
   */
  readonly pairObservations: number
  readonly pairLatestVisitAt: Date
  /**
   * Whether the place is in the asker's own city (Р-26): the statement orders by it inside a pair,
   * and the use case puts a pair with such a place first among pairs (MOL-166, adversarial Ж).
   */
  readonly nearby: boolean
  /**
   * Whether the place's last purchase was made within `freshDays` of the phone's today. A place
   * whose pair is not the row's first stands on the row only while it is (MOL-166, adversarial И):
   * a cheese bought once in Moscow two years ago stayed under «Ещё» for good, and took «Дешевле
   * всего» away from the market of every week with it.
   */
  readonly recent: boolean
}

/**
 * The middle of what an item cost, over one currency and unit. Not per place: the threshold
 * answers «is this cheap», and a place that sells it once dearly is part of that answer.
 */
export interface PriceMedian {
  readonly itemId: string
  readonly currency: Currency
  readonly unit: BaseUnit
  readonly scaledMinor: bigint
  /** How many purchases the median stands on — the caller's `PRICE_MEDIAN_MIN_OBSERVATIONS`. */
  readonly observations: number
}

/**
 * Raw SQL bypasses drizzle's per-column mapping, and the postgres-js client hands timestamps
 * over as strings. The builder path arrives with a `Date` and `db.execute` with a string, so
 * they are levelled here rather than in a statement: no cast in SQL produces a JavaScript date.
 */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Which purchase in a place is the last one (MOL-92, В-3): the record's own day as the phone named
 * it (MOL-121), else the moment it began read as a day in `zone`; then that moment, then the moment
 * the row was written — two packs in one record, the later one. An `order by` over the columns of
 * `pricedRows`, written once: «Что брать» and «Тут дешевле» name a place by the same purchase, or
 * the home and the sheet disagree about one milk (MOL-166).
 */
function latestFirst(zone: string): SQL {
  return sql`coalesce(started_on, (bought_at at time zone ${zone})::date::text) desc,
             bought_at desc, written_at desc, expense_id desc`
}

/**
 * The two pieces of the statement both price aggregates share. What they mean, and why the
 * choosing happens on the row rather than on the aggregate, is written once — over
 * `pricedRows` below, where it is built.
 */
interface PricedRows {
  /** `from (…) priced where …` — the visible, showable purchases, ready to be aggregated. */
  readonly rows: SQL
  readonly limit: SQL
}

/** What the two statements below select. `::text` out of every numeric wider than a double. */
interface PlacePriceShape extends Record<string, unknown> {
  itemId: string
  placeId: string
  placeName: string
  currency: Currency | null
  unit: BaseUnit | null
  scaledMinor: string | null
  observations: string
  latestVisitAt: Date | string
  pairObservations: string
  pairLatestVisitAt: Date | string
  nearby: boolean
  recent: boolean
}

interface PriceMedianShape extends Record<string, unknown> {
  itemId: string
  currency: Currency | null
  unit: BaseUnit | null
  scaledMinor: string | null
  observations: string
}

/**
 * The last price paid for an item in one place (MOL-92). The day is left to the caller: the
 * record's own day where the phone named one, else the moment it began read in the zone of the
 * request — a zone this file does not know.
 */
export interface OwnLatestPrice {
  readonly itemId: string
  readonly placeId: string
  readonly placeName: string
  readonly currency: Currency
  readonly unit: BaseUnit
  readonly scaledMinor: bigint
  /** How much that last purchase was, in thousandths of the unit (adversarial Г′). */
  readonly quantityMilli: bigint
  /** How many purchases of it there are in the place, in this currency and unit. */
  readonly observations: number
  /** `trips.started_on` — the phone's day at «Записать покупки», absent from an old queue. */
  readonly startedOn: string | null
  readonly startedAt: Date
}

interface OwnLatestShape extends Record<string, unknown> {
  itemId: string
  placeId: string
  placeName: string
  currency: Currency | null
  unit: BaseUnit | null
  scaledMinor: string | null
  quantityMilli: string | null
  observations: string
  startedOn: string | null
  startedAt: Date | string
}

type ExpenseRow = typeof expenses.$inferSelect

function toExpense(row: ExpenseRow): Expense {
  return expenseSchema.parse({
    id: row.id,
    tripId: row.tripId,
    itemId: row.itemId,
    quantity: quantityFrom(row.qtyMilli, row.qtyUnit),
    amount: moneyFrom(row.amountMinor, row.amountCurrency),
    createdAt: row.createdAt,
  })
}

export function createExpenseRepository(db: Conn): ExpenseRepository {
  /**
   * The zones Postgres knows, read once (adversarial Ж). The phone's zone is checked by `Intl`, and
   * a name ICU knows and tzdata does not — renamed, or new — met `time zone not recognized` and a 500
   * for every record from before MOL-121. Such a zone orders by Yerevan's day, as one with none does.
   */
  let knownZones: Promise<ReadonlySet<string>> | null = null
  async function zoneFor(zone: string | undefined): Promise<string> {
    if (zone === undefined) return YEREVAN
    knownZones ??= db
      .execute<{ name: string }>(sql`select name from pg_timezone_names`)
      .then((rows) => new Set(rows.map((row) => row.name)))
      .catch((error: unknown) => {
        knownZones = null
        throw error
      })
    return (await knownZones).has(zone) ? zone : YEREVAN
  }

  /**
   * An expense has no `actor_id` of its own — deliberately, since MOL-6 — so it belongs to a
   * person through its trip. The ownership is a condition of the statement rather than a
   * check after loading: a check can be forgotten in one method out of ten, and nothing in
   * the types would say so. A removed trip's purchases are nobody's (MOL-76).
   */
  const ownedByActor = (actorId: string) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(trips)
        .where(
          and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId), isNull(trips.deletedAt)),
        ),
    )

  /**
   * The purchase has no living verdict of this person. Shared by both readers of the queue, so
   * «unrated» cannot mean two things. Expects `trips` and `items` joined to the expense.
   */
  const noLiveVerdict = (actorId: string) =>
    notExists(
      db
        .select({ one: sql`1` })
        .from(verdicts)
        .where(
          and(
            eq(verdicts.actorId, actorId),
            eq(verdicts.itemId, expenses.itemId),
            // A product is rated as itself and a dish only where it was served, so the place
            // that closes a purchase depends on the kind. `is not distinct from` rather than
            // `=`, because for a product both sides are null.
            sql`${verdicts.placeId} is not distinct from
                (case when ${items.kind} = 'dish' then ${trips.placeId} end)`,
            // A withdrawn verdict is no opinion, so the purchase waits for one again.
            isNull(verdicts.deletedAt),
          ),
        ),
    )

  /**
   * The rows both price aggregates are built on (MOL-31): same purchases, same privacy, and
   * the choosing is done once, here, on the row rather than on the aggregate.
   *
   * It has to be the row. The first version decided per aggregate — «everyone's, or this
   * person's own» — and the two aggregates group differently: a place at a time for the
   * place's price, a whole «currency + unit» for the median. Three strangers in three shops then
   * made the median «enough» although no shop of theirs passed the threshold, and
   * `percentile_disc` handed back an exact price someone paid in a shop the same answer had
   * just refused to show (adversarial round 1, F1). One `showable` per row, read by both, is
   * what makes «same privacy» true rather than merely claimed.
   *
   * What a row carries:
   *
   * - `unitPrice`, computed in SQL rather than in the domain (MOL-21, В-7): with other
   *   people's data it has to be SQL anyway, and in memory it would be written twice. The
   *   scale comes from `UNIT_PRICE_SCALE`, and `round` matches `divideRounded` — both take
   *   half away from zero. `::numeric` is not optional: integer division truncates, shaving
   *   almost half a unit off every price, quietly and always in the same direction.
   * - `bought_at` — `trips.started_at`, the day of the visit. Not `created_at`: the offline
   *   queue (MOL-24) sends a whole trip when the connection returns, so a ten-day-old purchase
   *   can carry today's, and «the last purchase» of Р-4 would be decided by when the phone
   *   found signal (F4).
   * - `mine`, and `place_buyers` — how many people bought this item in this place, counted
   *   over the visible rows. A buyer is a person: three purchases by one of them are one.
   * - `showable` — `mine or place_buyers >= minBuyers` (Р-17). The number arrives with the
   *   query, so this file holds no threshold of its own.
   * - `place_last` — whether this is its buyer's last purchase of the item in the place, in any
   *   currency and unit (`latestFirst` in `zone`), and `mine_here` — whether this person bought
   *   the item there at all (MOL-166, adversarial А). Both are counted before `showable` filters:
   *   a buyer's last purchase may sit in a pair too few people bought in, and it is still their
   *   last — counted after, an August kilo would stand for someone who has bought packs since.
   *
   * Which rows are visible at all: in the own mode only this person's, wherever they shopped;
   * in the shared mode theirs **and** everyone else's in their own city. «Theirs» is there on
   * purpose — the city rule is about other people's prices (Р-10), and without it buying
   * access took away the Erevan prices a Gyumri resident could see for free (F5).
   */
  function pricedRows(
    query: Omit<PriceQuery, 'freshDays'>,
    zone: string = YEREVAN,
  ): PricedRows | null {
    // A malformed identifier can match nothing, so it is dropped rather than sent to meet
    // `22P02`; if none of them survive there is nothing left to ask about.
    const known = query.itemIds.map(idOrNull).filter((id): id is string => id !== null)
    if (idOrNull(query.actorId) === null || known.length === 0) return null

    const mine = sql`${trips.actorId} = ${query.actorId}::uuid`
    // The city by the fold the place was stored under, not by the exact spelling: `ensure`
    // keeps whichever spelling was written first, so «гюмри» and «Гюмри» are one shop when a
    // place is created and must stay one when its prices are read (MOL-65, adversarial Г2).
    const here = sql`${places.country} = ${query.country}
      and ${placeIdentity(places.city)} = ${identityOf(query.city)}`
    const visible = query.scope === 'own' ? mine : sql`${mine} or (${here})`
    // A malformed one can be no row, so there is nothing to leave out.
    const left = query.except === undefined ? null : idOrNull(query.except)
    const except = left === null ? sql`` : sql` and ${expenses.id} <> ${left}::uuid`

    return {
      rows: sql`
        from (
          with visible as (
            select
              ${expenses.itemId} as item_id,
              ${trips.placeId} as place_id,
              ${places.name} as place_name,
              ${expenses.amountCurrency} as currency,
              ${expenses.qtyUnit} as unit,
              round(
                ${expenses.amountMinor}::numeric * 1000 * ${sql.raw(UNIT_PRICE_SCALE.toString())}
                / ${expenses.qtyMilli}
              ) as unit_price,
              -- The day of the visit, not the moment the row reached the server. The offline
              -- queue (MOL-24) sends a whole trip when the connection returns, so a ten-day-old
              -- purchase can carry today's created_at and win a tie it lost by ten days
              -- (adversarial round 1, F4). A row added to a trip later — the sauce found in the
              -- bag at home — belongs to the visit it was bought on, which is the same answer.
              ${trips.startedAt} as bought_at,
              -- What the last of them is decided by (MOL-92): the phone's day of the record, then
              -- the moment it began, then the moment the row was written.
              ${trips.startedOn}::text as started_on,
              ${expenses.createdAt} as written_at,
              ${expenses.id} as expense_id,
              ${expenses.qtyMilli} as qty_milli,
              ${trips.actorId} as actor_id,
              ${mine} as mine,
              -- Whether the place is in this person's own city. Read by the order alone: the
              -- shared mode shows «mine or my city», and without it a person's own receipt
              -- from another city stood first in the list — that is, under the word «Дешевле
              -- всего» (adversarial round 2, G4).
              (${here}) as nearby
            from ${expenses}
            join ${trips} on ${trips.id} = ${expenses.tripId}
            join ${places} on ${places.id} = ${trips.placeId}
            where ${inArray(expenses.itemId, known)}
              -- A removed trip is no observation, one's own or anyone else's (MOL-76).
              and ${trips.deletedAt} is null
              -- An observation without a price or without a quantity says nothing about a
              -- unit price, so it is skipped by an explicit condition rather than silently.
              and ${expenses.amountMinor} is not null
              and ${expenses.qtyMilli} is not null
              and (${visible})${except}
          ),
          -- A grouped count rather than a window: Postgres has no DISTINCT inside one.
          -- Currency and unit stay part of the key here as everywhere else, and they are
          -- never null in these rows — the pairing CHECKs tie them to the amount and the
          -- quantity the filter above has already demanded.
          buyers as (
            select item_id, place_id, currency, unit, count(distinct actor_id) as place_buyers
            from visible
            group by item_id, place_id, currency, unit
          )
          select visible.*, buyers.place_buyers,
            row_number() over (
              partition by visible.item_id, visible.place_id, visible.actor_id
              order by ${latestFirst(zone)}
            ) = 1 as place_last,
            bool_or(visible.mine) over (
              partition by visible.item_id, visible.place_id
            ) as mine_here
          from visible
          join buyers
            on buyers.item_id = visible.item_id
           and buyers.place_id = visible.place_id
           and buyers.currency = visible.currency
           and buyers.unit = visible.unit
        ) priced
        where mine or place_buyers >= ${query.minBuyers}`,
      // The default follows the question: so many places per item asked about. A flat cap
      // would be right for one item and wrong for two hundred, and it would run out on the
      // items the ordering leaves last rather than trimming everyone evenly.
      limit: sql`limit ${rowLimit(query.limit ?? known.length * PLACES_PER_ITEM)}`,
    }
  }

  return {
    async add(actorId, input) {
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          // The foreign key only asks whether the trip exists, never whose it is, so the
          // owner is checked here. A stranger's trip and a trip that was never there give
          // the same answer on purpose.
          const [trip] = await tx
            .select({ id: trips.id })
            .from(trips)
            .where(
              and(eq(trips.id, input.tripId), eq(trips.actorId, actorId), isNull(trips.deletedAt)),
            )
            .limit(1)
          if (!trip) throw new DomainError(ERROR.NOT_FOUND)

          const quantity = quantityTo(input.quantity)
          const amount = moneyTo(input.amount)
          const [row] = await tx
            .insert(expenses)
            .values({
              id: input.id,
              tripId: input.tripId,
              itemId: input.itemId,
              qtyMilli: quantity.milli,
              qtyUnit: quantity.unit,
              amountMinor: amount.minor,
              amountCurrency: amount.currency,
            })
            .onConflictDoNothing({ target: expenses.id })
            .returning()
          if (row) return { expense: toExpense(row), created: true }

          // Nothing was written, so the identifier is taken. Read back under the owner's trip
          // rather than by the identifier alone: `DO NOTHING` says only that *some* row holds
          // it, and returning that row as ours would hand out a stranger's purchase.
          const [existing] = await tx
            .select()
            .from(expenses)
            .where(
              and(
                eq(expenses.id, input.id),
                eq(expenses.tripId, input.tripId),
                eq(expenses.itemId, input.itemId),
              ),
            )
            .limit(1)
          if (!existing) throw new DomainError(ERROR.CONFLICT)
          return { expense: toExpense(existing), created: false }
        }),
      )
    },

    async forTrip(tripId, actorId) {
      if (idOrNull(tripId) === null || idOrNull(actorId) === null) return []

      const rows = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.tripId, tripId), ownedByActor(actorId)))
        // The screen lists them in the order they were added, and `created_at` is what says
        // so — it defaults to `clock_timestamp()`, which advances between statements even
        // inside one transaction. The earlier note here claimed `id` settles rows written in
        // the same millisecond «which a fast thumb at the shelf produces»; that was wrong
        // twice over. A thumb cannot produce it — `timestamptz` is microsecond — and the case
        // that did, several rows in one transaction, was settled by a random uuid, so the
        // list came back in an order unrelated to entry and stayed that way.
        .orderBy(asc(expenses.createdAt), asc(expenses.id))
      return rows.map(toExpense)
    },

    async update(id, tripId, actorId, patch) {
      if (idOrNull(id) === null || idOrNull(tripId) === null || idOrNull(actorId) === null) {
        return null
      }

      // `undefined` means «not mentioned» and `null` means «cleared», and the two must not
      // collapse: the sheet leaves a price empty as often as it fills one in.
      const set: Partial<typeof expenses.$inferInsert> = {}
      if (patch.quantity !== undefined) {
        const quantity = quantityTo(patch.quantity)
        set.qtyMilli = quantity.milli
        set.qtyUnit = quantity.unit
      }
      if (patch.amount !== undefined) {
        const amount = moneyTo(patch.amount)
        set.amountMinor = amount.minor
        set.amountCurrency = amount.currency
      }

      // A parsed patch is never empty — `expensePatchSchema` refuses one, because it would
      // only bump `updated_at` — so an empty one here means a caller went around the domain.
      // Left as a defect on purpose (Р-11), but said out loud: drizzle answers «No values to
      // set», which names neither the table nor the caller.
      if (Object.keys(set).length === 0) {
        throw new Error('an expense patch with no fields reached the repository')
      }

      const [row] = await db
        .update(expenses)
        .set(set)
        .where(and(eq(expenses.id, id), eq(expenses.tripId, tripId), ownedByActor(actorId)))
        .returning()
      return row ? toExpense(row) : null
    },

    async remove(id, tripId, actorId) {
      if (idOrNull(id) === null || idOrNull(tripId) === null || idOrNull(actorId) === null) {
        return false
      }

      const removed = await db
        .delete(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.tripId, tripId), ownedByActor(actorId)))
        .returning({ id: expenses.id })
      return removed.length > 0
    },

    async unratedFor(actorId, limit) {
      if (idOrNull(actorId) === null) return []

      const rows = await db
        .select({ expense: expenses })
        .from(expenses)
        .innerJoin(
          trips,
          and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId), isNull(trips.deletedAt)),
        )
        .innerJoin(items, eq(items.id, expenses.itemId))
        .where(noLiveVerdict(actorId))
        .orderBy(desc(expenses.createdAt), desc(expenses.id))
        .limit(rowLimit(limit))
      return rows.map((row) => toExpense(row.expense))
    },

    async pendingVerdictsFor(actorId, limit, bought) {
      if (idOrNull(actorId) === null) return { items: [], total: 0 }

      // `least` passes over a null: an open trip has no end, and the entry stands.
      const boughtAt = sql<Date>`least(${expenses.createdAt}, ${trips.finishedAt})`.mapWith(
        expenses.createdAt,
      )
      const inWindow = bought
        ? and(
            sql`${boughtAt} >= ${bought.from.toISOString()}::timestamptz`,
            sql`${boughtAt} < ${bought.to.toISOString()}::timestamptz`,
            notExists(
              db
                .select({ one: sql`1` })
                .from(verdicts)
                .where(
                  and(
                    eq(verdicts.actorId, actorId),
                    eq(verdicts.itemId, expenses.itemId),
                    sql`${verdicts.deletedAt} > ${boughtAt}`,
                  ),
                ),
            ),
          )
        : undefined
      const latest = db
        .selectDistinctOn([expenses.itemId], {
          itemId: expenses.itemId,
          // Aliased: both names are `name`, and a subquery keeps only the bare column name.
          name: sql<string>`${items.name}`.as('item_name'),
          placeName: sql<string>`${places.name}`.as('place_name'),
          boughtAt: boughtAt.as('bought_at'),
          // Inside one trip every purchase has its day, so the order of entry breaks the tie.
          enteredAt: sql<Date>`${expenses.createdAt}`.as('entered_at'),
        })
        .from(expenses)
        .innerJoin(
          trips,
          and(eq(trips.id, expenses.tripId), eq(trips.actorId, actorId), isNull(trips.deletedAt)),
        )
        .innerJoin(items, and(eq(items.id, expenses.itemId), eq(items.kind, 'product')))
        .innerJoin(places, eq(places.id, trips.placeId))
        .where(and(noLiveVerdict(actorId), inWindow))
        .orderBy(expenses.itemId, desc(boughtAt), desc(expenses.createdAt), desc(expenses.id))
        .as('latest')

      // The total is counted by a window over the same rows, before the limit applies: a
      // second statement could see a purchase the first did not, and the counter would
      // disagree with the page it came with.
      const rows = await db
        .select({
          itemId: latest.itemId,
          name: latest.name,
          placeName: latest.placeName,
          boughtAt: latest.boughtAt,
          total: sql<number>`count(*) over ()`.mapWith(Number),
        })
        .from(latest)
        .orderBy(desc(latest.boughtAt), desc(latest.enteredAt), desc(latest.itemId))
        .limit(rowLimit(limit))

      return {
        items: rows.map(({ itemId, name, placeName, boughtAt }) => ({
          itemId,
          name,
          placeName,
          boughtAt,
        })),
        total: rows[0]?.total ?? 0,
      }
    },

    async placePricesFor(query) {
      const zone = await zoneFor(query.zone)
      const priced = pricedRows(query, zone)
      // «Today» is the phone's where the request names it (MOL-121); else the server's, in its zone.
      const today =
        query.today === undefined
          ? sql`(now() at time zone ${zone})::date`
          : sql`${query.today}::date`
      if (!priced) return []

      const found = await db.execute<PlacePriceShape>(sql`
        select "itemId", "placeId", "placeName", currency, unit, price::text as "scaledMinor",
               observations::text, "latestVisitAt", "pairObservations"::text, "pairLatestVisitAt",
               nearby, recent
        from (
          -- What a pair weighs is every purchase of the item in it, in every place — counted
          -- before the places a pair does not name are left out (adversarial Д, owner's decision):
          -- weighed by what remained, one pack in a shop bought by the kilo for ten weeks turned
          -- the whole row to pieces and hid the market where the kilo is cheaper.
          select places.*,
            sum(observations) over pair as "pairObservations",
            max(visited) over pair as "pairLatestVisitAt"
          from (
          select
            item_id as "itemId",
            place_id as "placeId",
            place_name as "placeName",
            currency,
            unit,
            -- One's own last purchase in the place, wherever one bought; otherwise the place was
            -- opened by other people, and its price is the lower median of each buyer's last there
            -- — \`percentile_disc\`, a price someone paid, as the threshold of «только если дёшево»
            -- is (MOL-166, В-1) — of those bought within the window (adversarial Б).
            coalesce(
              min(unit_price) filter (where mine and place_last),
              percentile_disc(0.5) within group (order by unit_price)
                filter (where place_last and fresh)
            ) as price,
            count(*) as observations,
            -- A place of one's own is as fresh as one's own last purchase there, as its price is
            -- (adversarial М, owner's decision): other people's visits made a two-year-old price
            -- of mine head the row of someone with access, and hid a pack of mine fresher than it.
            case when bool_or(mine_here) then max(bought_at) filter (where mine)
                 else max(bought_at) end as "latestVisitAt",
            max(bought_at) as visited,
            bool_or(nearby) as nearby,
            -- Whether the place's last purchase is within the window — what a place of a pair
            -- other than the row's first must be to stand on the row (adversarial И); one's own
            -- by one's own purchase (М).
            bool_or(place_last and fresh and (mine or not mine_here)) as recent,
            -- A pair is the place's only where its last purchase was made in it (adversarial А):
            -- an August kilo is not what a shop charges once packs were bought there since. Where
            -- this person bought, that is their own last purchase, and nobody else's figure stands
            -- in for it; elsewhere, three buyers whose last purchase there is recent and in this
            -- pair.
            bool_or(mine and place_last)
              or (not bool_or(mine_here)
                  and count(distinct actor_id) filter (where place_last and fresh)
                      >= ${query.minBuyers}) as named
          from (
            -- By the day of the record, as «last» is: a purchase of \`freshDays\` days ago counts.
            select *,
              coalesce(started_on, (bought_at at time zone ${zone})::date::text)::date
                >= ${today} - ${query.freshDays}::int as fresh
            ${priced.rows}
          ) showable
          group by item_id, place_id, place_name, currency, unit
          ) places
          window pair as (partition by "itemId", currency, unit)
        ) weighed
        where named
        -- Ordered here rather than after, and by the price itself: the screen shows the
        -- places of one item cheapest first, and a second sort in JavaScript would compare
        -- names by another alphabet than the one that ordered the rows of the answer (F7).
        -- Currency and unit are part of the key, so they belong in the order as well:
        -- without them two rows of one place are tied, and a tie is an order the planner is
        -- free to change between two loads of the same screen.
        -- This person's own city first (Р-26). «Cheaper» across a city means «elsewhere»
        -- rather than «cheaper», which is the whole reason Р-10 exists; since the shared mode
        -- shows «mine or my city», without this a Gyumri resident's own Erevan receipt stood
        -- above a Gyumri place and took the superlative with it (adversarial round 2, G4).
        order by "itemId", nearby desc, price,
                 "placeName" collate "und-x-icu", currency, unit, "placeId"
        ${priced.limit}
      `)

      return found.flatMap((row) => {
        // The pairing CHECKs make these non-null wherever the amount and the quantity are,
        // but the column types do not say so.
        if (row.currency === null || row.unit === null || row.scaledMinor === null) return []
        return [
          {
            itemId: row.itemId,
            placeId: row.placeId,
            placeName: row.placeName,
            currency: row.currency,
            unit: row.unit,
            scaledMinor: BigInt(row.scaledMinor),
            observations: Number(row.observations),
            latestVisitAt: asDate(row.latestVisitAt),
            pairObservations: Number(row.pairObservations),
            pairLatestVisitAt: asDate(row.pairLatestVisitAt),
            nearby: row.nearby,
            recent: row.recent,
          },
        ]
      })
    },

    async medianPriceFor(query) {
      const priced = pricedRows(query)
      if (!priced) return []

      const found = await db.execute<PriceMedianShape>(sql`
        select
          item_id as "itemId",
          currency,
          unit,
          percentile_disc(0.5) within group (order by unit_price)::text as "scaledMinor",
          count(*)::text as observations
        ${priced.rows}
        group by item_id, currency, unit
        order by item_id, currency, unit
        ${priced.limit}
      `)

      return found.flatMap((row) => {
        if (row.currency === null || row.unit === null || row.scaledMinor === null) return []
        return [
          {
            itemId: row.itemId,
            currency: row.currency,
            unit: row.unit,
            scaledMinor: BigInt(row.scaledMinor),
            observations: Number(row.observations),
          },
        ]
      })
    },

    async ownLatestFor(query) {
      const priced = pricedRows({ ...query, scope: 'own', minBuyers: 1 }, await zoneFor(query.zone))
      if (!priced) return []

      const found = await db.execute<OwnLatestShape>(sql`
        select * from (
          select
            item_id as "itemId",
            place_id as "placeId",
            place_name as "placeName",
            currency,
            unit,
            unit_price::text as "scaledMinor",
            qty_milli::text as "quantityMilli",
            -- Counted before the last purchase is kept: a window is computed before \`where\`.
            (count(*) over (partition by item_id, place_id, currency, unit))::text as observations,
            started_on as "startedOn",
            bought_at as "startedAt",
            place_last
          -- In the own mode every row is the person's own, so \`priced\` holds them all; the city
          -- is a condition of its own (В-4), outside the privacy rule's \`or\`.
          from (select * ${priced.rows}) own
          where nearby
        ) counted
        -- One row a place: its last purchase, in whatever currency and unit it was made — the rule
        -- «Что брать» names the place by (MOL-166, adversarial А). The sheet compares the price
        -- typed only with places whose last purchase is in its own pair.
        where place_last
        -- Cheapest last price first, inside a currency and unit; names by the collation the
        -- places of «Что брать» are ordered by, so a tie reads the same on both.
        order by "itemId", currency, unit, "scaledMinor"::numeric,
                 "placeName" collate "und-x-icu", "placeId"
        ${priced.limit}
      `)

      return found.flatMap((row) => {
        if (
          row.currency === null ||
          row.unit === null ||
          row.scaledMinor === null ||
          row.quantityMilli === null
        ) {
          return []
        }
        return [
          {
            itemId: row.itemId,
            placeId: row.placeId,
            placeName: row.placeName,
            currency: row.currency,
            unit: row.unit,
            scaledMinor: BigInt(row.scaledMinor),
            quantityMilli: BigInt(row.quantityMilli),
            observations: Number(row.observations),
            startedOn: row.startedOn,
            startedAt: asDate(row.startedAt),
          },
        ]
      })
    },

    async ownItemsOfKind({ actorId, kind, notItem, country, city, limit }) {
      if (idOrNull(actorId) === null || kind === '') return []
      const other = idOrNull(notItem)

      const found = await db
        .selectDistinct({ itemId: expenses.itemId })
        .from(expenses)
        .innerJoin(trips, eq(trips.id, expenses.tripId))
        .innerJoin(places, eq(places.id, trips.placeId))
        .innerJoin(items, eq(items.id, expenses.itemId))
        .where(
          and(
            eq(trips.actorId, actorId),
            isNull(trips.deletedAt),
            sql`${expenses.amountMinor} is not null`,
            sql`${expenses.qtyMilli} is not null`,
            eq(places.country, country),
            sql`${placeIdentity(places.city)} = ${identityOf(city)}`,
            // A dish is the venue's own (MOL-28): «cheaper in another restaurant» is another dish.
            eq(items.kind, 'product'),
            other === null ? undefined : sql`${items.id} <> ${other}::uuid`,
            sql`split_part(${items.searchKey}, ' ', ${kindAt(items.name)}) = ${kind}`,
          ),
        )
        .orderBy(asc(expenses.itemId))
        .limit(rowLimit(limit))

      return found.map((row) => row.itemId)
    },
  }
}
