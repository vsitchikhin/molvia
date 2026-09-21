import { z } from 'zod'
import {
  ADVICE_LIMIT,
  AGGREGATE_MIN_CONTRIBUTIONS,
  DomainError,
  ERROR,
  EVENT,
  NEVER_BELOW_TENTHS,
  PRICE_MEDIAN_MIN_OBSERVATIONS,
  adviceResponseSchema,
  averageScore,
  hasSharedAccess,
  verdictLevel,
} from '@molvia/model'
import type {
  AdvicePlace,
  AdviceResponse,
  AdviceRow,
  AdviceScope,
  VerdictLevel,
} from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { EventRepository } from '@/db/events-repository'
import type { ExpenseRepository, PlacePrice, PriceMedian } from '@/db/expenses-repository'
import type { AdviceVerdictRow, VerdictRepository } from '@/db/verdicts-repository'

export interface AdviceDeps {
  readonly actors: ActorRepository
  readonly verdicts: VerdictRepository
  readonly expenses: ExpenseRepository
  readonly events: EventRepository
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
    limit: ADVICE_LIMIT,
  })

  const levelled = rated.rows.map((row) => ({ row, level: verdictLevel(row.sum, row.count) }))
  const asked = (...levels: readonly VerdictLevel[]) =>
    levelled.filter((entry) => levels.includes(entry.level)).map((entry) => entry.row.itemId)

  const query = {
    actorId,
    scope,
    minBuyers: AGGREGATE_MIN_CONTRIBUTIONS,
    country: actor.country,
    city: actor.city,
  }
  // Two questions, so two lists of items. «Не брать нигде» is in neither: its price is not
  // filtered out of an answer, it is never asked for. And a threshold is only ever printed on
  // «только если дёшево», so asking for the medians of everything else was half the work of
  // every screen spent on a number nobody would read.
  const [places, medians] = await Promise.all([
    expenses.cheapestFor({ ...query, itemIds: asked('take', 'if_cheap') }),
    expenses.medianPriceFor({ ...query, itemIds: asked('if_cheap') }),
  ])

  const byItem = groupPrices(places)
  const medianOf = new Map(
    medians.map((median) => [`${median.itemId}${groupKeyOf(median)}`, median]),
  )

  const rows = levelled.map(({ row, level }) => rowOf(row, level, byItem.get(row.itemId), medianOf))

  // Encoded here rather than only in the route, the way `tripViewFor` is: an answer the wire
  // cannot carry has to fail where it was built, beside the data that made it.
  const answer = { scope, rows, total: rated.total }
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
 * Which «currency + unit» an item's prices are shown in (Р-4). The one with the most
 * observations, and the latest purchase breaks a tie: a single trip abroad must not replace
 * a year of buying the same thing at home. Two prices from different groups cannot be
 * compared without a rate, and a rate belongs to one trip and one day.
 */
function dominant(groups: Map<GroupKey, PlacePrice[]>): [GroupKey, PlacePrice[]] | undefined {
  let best: [GroupKey, PlacePrice[]] | undefined
  let bestWeight = { observations: 0, latestAt: 0 }
  for (const [key, places] of groups) {
    const observations = places.reduce((sum, place) => sum + place.observations, 0)
    const latestAt = Math.max(...places.map((place) => place.latestAt.getTime()))
    const better =
      observations > bestWeight.observations ||
      (observations === bestWeight.observations && latestAt > bestWeight.latestAt) ||
      // Both equal: the key itself decides, so two loads of one screen cannot disagree.
      (observations === bestWeight.observations &&
        latestAt === bestWeight.latestAt &&
        best !== undefined &&
        key < best[0])
    if (better) {
      best = [key, places]
      bestWeight = { observations, latestAt }
    }
  }
  return best
}

function placesOf(places: readonly PlacePrice[]): AdvicePlace[] {
  // Already cheapest first: the statement ordered them, and it ordered the rows of the answer
  // by the same collation. Sorting again here used another alphabet, so one answer came back
  // in two orders — «молоко» under «Яблоко» among the rows, over it among the places (F7).
  return places.map((place) => ({
    placeId: place.placeId,
    name: place.placeName,
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
  }
  // The rule the whole product rests on, and the only place it is written as code: «не брать
  // нигде» gets no price, no place and no threshold — the row has no field to put them in.
  if (level === 'never') return { ...rated, level }

  const chosen = groups ? dominant(groups) : undefined
  const places = placesOf(chosen?.[1] ?? [])
  if (level === 'take') return { ...rated, level, places }

  const median = chosen ? medians.get(`${row.itemId}${chosen[0]}`) : undefined
  // «Стоит брать дешевле …» needs a middle, and two purchases have none worth printing.
  const threshold =
    median && median.observations >= PRICE_MEDIAN_MIN_OBSERVATIONS
      ? { scaledMinor: median.scaledMinor, currency: median.currency, unit: median.unit }
      : null
  return { ...rated, level, places, threshold }
}
