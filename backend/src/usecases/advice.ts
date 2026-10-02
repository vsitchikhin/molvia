import { z } from 'zod'
import {
  ADVICE_LIMIT,
  ADVICE_WARNINGS_RESERVED,
  AGGREGATE_MIN_CONTRIBUTIONS,
  DomainError,
  ERROR,
  EVENT,
  NEVER_BELOW_TENTHS,
  PRICE_MEDIAN_MIN_OBSERVATIONS,
  SHARED_PRICE_FRESH_DAYS,
  adviceResponseSchema,
  adviceSearchResponseSchema,
  averageScore,
  hasSharedAccess,
  verdictLevel,
} from '@molvia/model'
import type {
  AdvicePlace,
  AdviceResponse,
  AdviceRow,
  AdviceScope,
  AdviceSearchResponse,
  VerdictLevel,
} from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { EventRepository } from '@/db/events-repository'
import type { ExpenseRepository, PlacePrice, PriceMedian } from '@/db/expenses-repository'
import type { ItemRepository } from '@/db/items-repository'
import type { AdviceVerdictRow, VerdictRepository } from '@/db/verdicts-repository'
import { SEARCH_LIMIT } from '@/usecases/search-catalogue'
import type { Today } from '@/usecases/today'

export interface AdviceDeps {
  readonly actors: ActorRepository
  readonly verdicts: VerdictRepository
  readonly expenses: ExpenseRepository
  readonly events: EventRepository
}

/** The search writes nothing, so it is handed no log (В-2). */
export interface AdviceSearchDeps extends Omit<AdviceDeps, 'events'> {
  readonly items: ItemRepository
}

/**
 * The key a price belongs to: two prices only compare inside one currency and one unit. A
 * plain `|` separates them — neither a currency code nor a unit can contain one.
 */
type GroupKey = string

const groupKeyOf = (price: { currency: string; unit: string }): GroupKey =>
  `${price.currency}|${price.unit}`

/**
 * «Что брать» — the screen the whole product is for, as one answer (MOL-31).
 *
 * Three reads whatever the length of the list: the person, their rated rows, and the prices
 * of the rows that are allowed to show one. The rows of «не брать нигде» are deliberately
 * left out of the price query — not filtered out of its answer afterwards, but never asked
 * about: cheapness must not be able to reach a bad item even by accident.
 */
export async function advice(
  { actors, verdicts, expenses, events }: AdviceDeps,
  actorId: string,
  /**
   * The phone's day and zone (MOL-121): which purchase of a place is its last, as «Тут дешевле»
   * reads it, and the today other people's last purchases are counted back from.
   */
  phone: Today = {},
): Promise<AdviceResponse> {
  const actor = await actors.byId(actorId)
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)

  // Read once, here: a person whose access runs out between two of these reads would
  // otherwise get half an answer of each kind.
  const scope: AdviceScope = hasSharedAccess(actor, new Date()) ? 'shared' : 'own'

  const rated = await verdicts.adviceRowsFor({
    actorId,
    scope,
    minContributions: AGGREGATE_MIN_CONTRIBUTIONS,
    neverBelowTenths: NEVER_BELOW_TENTHS,
    warningsReserved: ADVICE_WARNINGS_RESERVED,
    limit: ADVICE_LIMIT,
  })

  const rows = await describe(expenses, actor, scope, rated.rows, phone)

  // Encoded here rather than only in the route, the way `tripViewFor` is: an answer the wire
  // cannot carry has to fail where it was built, beside the data that made it.
  const answer = {
    scope,
    rows,
    total: rated.total,
    geography: { country: actor.country, city: actor.city },
  }
  z.encode(adviceResponseSchema, answer)

  /*
   * The visit that the 0.3 gate counts (Р-15), and only in the shared mode: in the own mode
   * nothing on this screen came from anyone else, so it is not a return for other people's
   * data. Recorded after the answer is built, so a failed read is not a visit, and never
   * swallowed — a row lost here lowers the gate with nothing to backfill from.
   *
   * **The visit is counted by intent, not by catch** (Р-21, the owner's decision after
   * adversarial round 1, F3). The condition is access, not content: a person with access who
   * opens an empty screen, or one made entirely of their own figures — which the threshold of
   * three contributors will make ordinary for a long while — is counted as having come back
   * for other people's data. They did come for it; there was none. Written down here because
   * the name of the event and the wording of Р-15 both read the other way.
   *
   * `product` always: 0.1 has no venues, and the screen shows what the catalogue holds.
   */
  if (scope === 'shared') {
    await events.recordOncePerDay({
      actorId,
      type: EVENT.ADVICE_VIEWED,
      payload: { subject: 'product' },
    })
  }

  return answer
}

/**
 * How many of the catalogue's candidates the search on «Что брать» looks through for a verdict
 * (MOL-128, adversarial А). The catalogue ranks every candidate anyway (MOL-14); this only bounds
 * what comes back. Far above what one word of a shop's shelf finds — «сыр» is 24 names in the seed.
 */
export const ADVICE_SEARCH_CANDIDATES = 500

/**
 * The search on «Что брать» (MOL-128, В-1): the catalogue searched as «Что взяли?» searches it,
 * and every item found answered with its row of «Что брать» — built by `describe`, the list's own
 * rules — or `null`, «ещё не оценивали». In the order of the search.
 *
 * **What is rated is not cut** (adversarial А): the first `SEARCH_LIMIT` found, as «Что взяли?»
 * shows them, and past them every near one — each word within one edit — that has a verdict in
 * sight. Cut at twenty before the verdicts were asked, «сыр» answered twenty cheeses «ещё не
 * оценивали» and left out the one rated «не брать нигде»: the warning the screen exists for,
 * gone behind the word on the package. Far ones past the limit stay out: they are the catalogue's
 * guesses, not what was typed.
 *
 * **It records no visit** (В-2, the owner's decision): `advice` does, and the screen asks for the
 * list whenever it opens and whenever the connection comes back — the field is not shown without
 * a list. The one visit missed is a list that failed and a search that then worked, and that
 * errs towards «stop», the safe side of the gate. Nor does it record a pick: a pick teaches the
 * entry of a purchase, and here nothing was bought.
 */
export async function adviceSearch(
  { actors, verdicts, expenses, items }: AdviceSearchDeps,
  actorId: string,
  query: string,
  phone: Today = {},
): Promise<AdviceSearchResponse> {
  const actor = await actors.byId(actorId)
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  const scope: AdviceScope = hasSharedAccess(actor, new Date()) ? 'shared' : 'own'

  const found = await items.search(query, ADVICE_SEARCH_CANDIDATES, actorId)
  const close = new Set(found.nearIds)
  const first = found.items.slice(0, SEARCH_LIMIT)
  const past = found.items.slice(SEARCH_LIMIT).filter((item) => close.has(item.id))
  const itemIds = [...first, ...past].map((item) => item.id)
  const rated =
    itemIds.length === 0
      ? []
      : (
          await verdicts.adviceRowsFor({
            actorId,
            scope,
            minContributions: AGGREGATE_MIN_CONTRIBUTIONS,
            neverBelowTenths: NEVER_BELOW_TENTHS,
            warningsReserved: ADVICE_WARNINGS_RESERVED,
            limit: itemIds.length,
            itemIds,
          })
        ).rows
  const rows = await describe(expenses, actor, scope, rated, phone)
  const byItem = new Map(rows.map((row) => [row.itemId, row]))
  const answered = [...first, ...past.filter((item) => byItem.has(item.id))]

  const answer = {
    scope,
    geography: { country: actor.country, city: actor.city },
    // Whether anything shown is close (MOL-46), by the rows themselves: what is shown is not what
    // the catalogue handed on.
    near: answered.some((item) => close.has(item.id)),
    items: answered.map((item) => ({
      itemId: item.id,
      name: item.name,
      advice: byItem.get(item.id) ?? null,
    })),
  }
  z.encode(adviceSearchResponseSchema, answer)
  return answer
}

/**
 * Rated rows made into rows of «Что брать»: the level, and prices where a price is allowed. One
 * read of the places and one of the medians, whatever the number of rows. The rows of «не брать
 * нигде» are left out of the price query — not filtered out of its answer afterwards, but never
 * asked about: cheapness must not be able to reach a bad item even by accident.
 */
async function describe(
  expenses: ExpenseRepository,
  actor: { readonly id: string; readonly country: string; readonly city: string },
  scope: AdviceScope,
  rated: readonly AdviceVerdictRow[],
  { today, zone }: Today,
): Promise<AdviceRow[]> {
  const levelled = rated.map((row) => ({ row, level: verdictLevel(row.sum, row.count) }))
  const asked = (...levels: readonly VerdictLevel[]) =>
    levelled.filter((entry) => levels.includes(entry.level)).map((entry) => entry.row.itemId)

  const query = {
    actorId: actor.id,
    scope,
    minBuyers: AGGREGATE_MIN_CONTRIBUTIONS,
    freshDays: SHARED_PRICE_FRESH_DAYS,
    country: actor.country,
    city: actor.city,
  }
  // Two questions, so two lists of items. «Не брать нигде» is in neither: its price is not
  // filtered out of an answer, it is never asked for. And a threshold is only ever printed on
  // «только если дёшево», so asking for the medians of everything else was half the work of
  // every screen spent on a number nobody would read.
  const [places, medians] = await Promise.all([
    expenses.placePricesFor({
      ...query,
      itemIds: asked('take', 'if_cheap'),
      ...(today === undefined ? {} : { today }),
      ...(zone === undefined ? {} : { zone }),
    }),
    expenses.medianPriceFor({ ...query, itemIds: asked('if_cheap') }),
  ])

  const byItem = groupPrices(places)
  const medianOf = new Map(
    medians.map((median) => [`${median.itemId}${groupKeyOf(median)}`, median]),
  )

  return levelled.map(({ row, level }) => rowOf(row, level, byItem.get(row.itemId), medianOf))
}

/** Every price of one item, kept apart by the pair it may be compared inside. */
function groupPrices(places: readonly PlacePrice[]): Map<string, Map<GroupKey, PlacePrice[]>> {
  const byItem = new Map<string, Map<GroupKey, PlacePrice[]>>()
  for (const place of places) {
    const groups = byItem.get(place.itemId) ?? new Map<GroupKey, PlacePrice[]>()
    const key = groupKeyOf(place)
    groups.set(key, [...(groups.get(key) ?? []), place])
    byItem.set(place.itemId, groups)
  }
  return byItem
}

/**
 * The «currency + unit» pairs of an item, the one its row is shown in first (Р-4). The one with
 * the most observations, and the most recent visit breaks a tie — the day of the trip, never the
 * hour an offline queue delivered it: a single trip abroad must not replace a year of buying the
 * same thing at home. Two prices from different pairs cannot be compared without a rate, and a
 * rate belongs to one trip and one day: the threshold and the superlative stay inside the first.
 *
 * Weighed by every purchase in the pair, the server's `pairObservations` — not by the places the
 * pair still names (MOL-166, adversarial Д): a place is named by its last purchase alone, and one
 * pack in a shop bought by the kilo for ten weeks turned the row to pieces and hid the market.
 *
 * **The other pairs follow, not vanish** (MOL-166, adversarial Е, owner's decision): a place whose
 * last purchase is in another pair is still where one buys — weighed into kilos by its own ten
 * kilos, a shop of packs left the row naming a market bought at once a year ago, and the shop of
 * every week nowhere. Its places come after the first pair's, each with its own unit.
 *
 * **A pair with a place in the asker's own city comes before any without** (Р-26 across pairs,
 * adversarial Ж): «cheaper elsewhere» is not somewhere one can go, and weighed alone, three kilos
 * in an Erevan shop put it at the head of a Gyumri resident's row over the market of their city —
 * a place of the own city bought at within the window, as a place of another pair must be (И).
 */
function ranked(groups: Map<GroupKey, PlacePrice[]>): [GroupKey, PlacePrice[]][] {
  // The same on every row of one pair; the largest, should a caller ever hand two apart.
  const weight = (places: readonly PlacePrice[]) => ({
    // Only a place bought at within the window (review №12): one pack at home two years ago put
    // its pair over thirty kilos in Erevan, and named a price nobody has seen since.
    nearby: places.some((place) => place.nearby && place.recent) ? 1 : 0,
    observations: Math.max(...places.map((place) => place.pairObservations)),
    latestVisitAt: Math.max(...places.map((place) => place.pairLatestVisitAt.getTime())),
  })
  return [...groups].sort(([aKey, aPlaces], [bKey, bPlaces]) => {
    const [a, b] = [weight(aPlaces), weight(bPlaces)]
    // Both equal: the key itself decides, so two loads of one screen cannot disagree.
    return (
      b.nearby - a.nearby ||
      b.observations - a.observations ||
      b.latestVisitAt - a.latestVisitAt ||
      (aKey < bKey ? -1 : aKey > bKey ? 1 : 0)
    )
  })
}

/**
 * The places a row names, in the order it names them. The first is the first pair's first — own
 * city, then price (Р-26, Р-27). The rest are the rest of that pair and the places of the other
 * pairs bought at within the window (adversarial И, owner's decision: the first pair has none, В-1)
 * or no earlier than the place the row names (adversarial К of round 6, owner's decision Н): a row
 * never hides a place fresher than the one it names, **own city first across all of them** (Р-26,
 * adversarial Ж′): pairs laid end to end put an Erevan shop of the first pair over the shop next
 * door in the second. Otherwise in the order of the pairs and of the server.
 */
function rowPlaces(pairs: readonly [GroupKey, PlacePrice[]][]): PlacePrice[] {
  const [first, ...others] = pairs
  if (!first) return []
  const [head, ...tail] = first[1]
  if (!head) return []
  const shown = (place: PlacePrice) =>
    place.recent || place.latestVisitAt.getTime() >= head.latestVisitAt.getTime()
  const rest = [...tail, ...others.flatMap(([, inPair]) => inPair.filter(shown))]
  // A stable sort: only «own city or not» moves anything.
  return [head, ...rest.sort((a, b) => Number(b.nearby) - Number(a.nearby))]
}

function placesOf(places: readonly PlacePrice[]): AdvicePlace[] {
  // Already cheapest first: the statement ordered them, and it ordered the rows of the answer
  // by the same collation. Sorting again here used another alphabet, so one answer came back
  // in two orders — «молоко» under «Яблоко» among the rows, over it among the places (F7).
  return places.map((place) => ({
    placeId: place.placeId,
    name: place.placeName,
    city: place.placeCity,
    unitPrice: {
      scaledMinor: place.scaledMinor,
      currency: place.currency,
      unit: place.unit,
    },
    observations: place.observations,
  }))
}

function rowOf(
  row: AdviceVerdictRow,
  level: VerdictLevel,
  groups: Map<GroupKey, PlacePrice[]> | undefined,
  medians: Map<string, PriceMedian>,
): AdviceRow {
  const rated = {
    itemId: row.itemId,
    name: row.name,
    rating: averageScore(row.sum, row.count),
    ratingsCount: row.count,
    review: row.review,
    isMine: row.isMine,
  }
  // The rule the whole product rests on, and the only place it is written as code: «не брать
  // нигде» gets no price, no place and no threshold — the row has no field to put them in.
  if (level === 'never') return { ...rated, level }

  const pairs = groups ? ranked(groups) : []
  const chosen = pairs[0]
  const places = placesOf(rowPlaces(pairs))
  if (level === 'take') return { ...rated, level, places }

  const median = chosen ? medians.get(`${row.itemId}${chosen[0]}`) : undefined
  // «Стоит брать дешевле …» needs a middle, and two purchases have none worth printing.
  const threshold =
    median && median.observations >= PRICE_MEDIAN_MIN_OBSERVATIONS
      ? { scaledMinor: median.scaledMinor, currency: median.currency, unit: median.unit }
      : null
  return { ...rated, level, places, threshold }
}
