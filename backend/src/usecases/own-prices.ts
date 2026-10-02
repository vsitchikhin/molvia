import { z } from 'zod'
import {
  ADVICE_WARNINGS_RESERVED,
  AGGREGATE_MIN_CONTRIBUTIONS,
  DomainError,
  ERROR,
  NEVER_BELOW_TENTHS,
  OWN_ALTERNATIVES_MAX,
  averageScore,
  kindKey,
  ownPricesResponseSchema,
  verdictLevel,
} from '@molvia/model'
import type {
  OwnAlternative,
  OwnPlacePrice,
  OwnPrices,
  OwnPricesQuery,
  OwnPricesResponse,
  SettingsGeography,
} from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { ExpenseRepository, OwnLatestPrice } from '@/db/expenses-repository'
import type { ItemRepository } from '@/db/items-repository'
import type { PlaceRepository } from '@/db/places-repository'
import type { TripRepository } from '@/db/trips-repository'
import type { VerdictRepository } from '@/db/verdicts-repository'
import { dayOfMoment } from '@/usecases/today'
import type { Today } from '@/usecases/today'

export interface OwnPricesDeps {
  readonly actors: ActorRepository
  readonly verdicts: VerdictRepository
  readonly expenses: ExpenseRepository
  readonly items: ItemRepository
  readonly trips: TripRepository
  readonly places: PlaceRepository
}

/**
 * How many products of one kind a person may have bought in one city before an arbitrary few, by
 * id, are not asked about. Far above a shelf: the seed holds 24 cheeses in all.
 */
const KIND_CANDIDATES = 200

/**
 * «Тут дешевле» on the sheet of a purchase (MOL-92): the person's own last prices of the item in
 * the record's city, and the other items of its kind they bought there with the rating they see
 * for each on «Что брать». Which line the sheet says is `cheaperHint`'s — it knows what is typed.
 *
 * **Only one's own purchases and one's own verdicts** (Т-1; owner's decision on adversarial Д,
 * 02.10.2026): with access or without, the same answer. «Что брать» with access shows an average of
 * three people; read here, strangers' «1» hid the person's own prices of an item they rated «5», and
 * strangers' «5» offered an item the person never rated. The level and the ratings come from the same
 * statement as «Что брать»'s, `adviceRowsFor` and `describe`, in its own mode.
 *
 * **«Не брать нигде» is never asked about**: its prices are not filtered out of the answer, they
 * are not read (Т-3). A dish has no hint (Р-1), and an item the catalogue does not hold has none
 * either — the same empty answer, so a guessed id learns nothing.
 *
 * It writes nothing (Т-6): no visit, no pick — the person looks at their own prices.
 */
export async function ownPrices(
  { actors, verdicts, expenses, items, trips, places }: OwnPricesDeps,
  owner: Today & { readonly actorId: string },
  query: OwnPricesQuery,
): Promise<OwnPricesResponse> {
  const actor = await actors.byId(owner.actorId)
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)

  const item = await items.byId(query.item)
  const where = await geographyOf(trips, places, actor.id, query)
  // Answered in lower case whatever the case it was asked in (`resource.ts`, MOL-25).
  const nothing: OwnPrices = {
    itemId: item?.id ?? query.item.toLowerCase(),
    level: 'unrated',
    places: [],
    alternatives: [],
  }
  if (item?.kind !== 'product' || where === null) return { where, prices: nothing }

  const mine = { actorId: actor.id, country: where.country, city: where.city }
  const candidates = await expenses.ownItemsOfKind({
    ...mine,
    kind: kindKey(item.name),
    notItem: item.id,
    limit: KIND_CANDIDATES,
  })

  const asked = [item.id, ...candidates]
  const { rows } = await verdicts.adviceRowsFor({
    actorId: actor.id,
    // The person's own verdicts, with access or without (owner's decision on adversarial Д): the
    // hint is one's own history, and an average of strangers is 0.3's.
    scope: 'own',
    minContributions: AGGREGATE_MIN_CONTRIBUTIONS,
    neverBelowTenths: NEVER_BELOW_TENTHS,
    warningsReserved: ADVICE_WARNINGS_RESERVED,
    limit: asked.length,
    itemIds: asked,
  })
  const rated = rows.map((row) => ({
    row,
    level: verdictLevel(row.sum, row.count),
    rating: averageScore(row.sum, row.count),
  }))

  const own = rated.find((entry) => entry.row.itemId === item.id)
  if (own?.level === 'never') return { where, prices: { itemId: item.id, level: 'never' } }

  // Only what is rated and not «не брать нигде» may be an alternative (Р-11): «оценено лучше или
  // так же» cannot be checked without a rating. Best rated first, so the cut keeps the ones the
  // sheet would name (В-9).
  const others = rated
    .filter((entry) => entry.row.itemId !== item.id && entry.level !== 'never')
    .sort((a, b) => Number(b.rating) - Number(a.rating) || (a.row.itemId < b.row.itemId ? -1 : 1))
    .slice(0, OWN_ALTERNATIVES_MAX)

  const prices = await expenses.ownLatestFor({
    ...mine,
    itemIds: [item.id, ...others.map((entry) => entry.row.itemId)],
    ...(query.except === undefined ? {} : { except: query.except }),
    ...(owner.zone === undefined ? {} : { zone: owner.zone }),
  })
  const placesOf = (itemId: string): OwnPlacePrice[] =>
    prices.filter((price) => price.itemId === itemId).map((price) => placeOf(owner, price))

  const alternatives: OwnAlternative[] = others.flatMap(({ row, level, rating }) => {
    const places = placesOf(row.itemId)
    if (places.length === 0 || level === 'never') return []
    return [{ itemId: row.itemId, name: row.name, level, rating, places }]
  })

  const priced = { itemId: item.id, places: placesOf(item.id), alternatives }
  const answer: OwnPricesResponse = {
    where,
    prices: own
      ? { ...priced, level: own.level, rating: own.rating }
      : { ...priced, level: 'unrated' },
  }

  // Encoded here, as `advice` does: an answer the wire cannot carry fails beside its data.
  z.encode(ownPricesResponseSchema, answer)
  return answer
}

/**
 * The country and city of the record (Т-4, review №1): off the place of a record the person holds,
 * as the server knows it — the phone knows a record's city only while its start is still queued.
 * A record not theirs, removed or missing is `null`, and its answer is empty: a guessed id learns
 * nothing it could tell from a missing one.
 */
async function geographyOf(
  trips: TripRepository,
  places: PlaceRepository,
  actorId: string,
  query: OwnPricesQuery,
): Promise<SettingsGeography | null> {
  if (!('trip' in query)) return { country: query.country, city: query.city }
  const trip = await trips.byId(query.trip, actorId)
  const place = trip ? await places.byId(trip.placeId) : null
  return place ? { country: place.country, city: place.city } : null
}

/**
 * The day printed beside a price: the record's own, as the phone named it (MOL-121), else the day
 * its moment fell on where the phone is now.
 */
function placeOf(owner: Today, price: OwnLatestPrice): OwnPlacePrice {
  return {
    placeId: price.placeId,
    name: price.placeName,
    unitPrice: { scaledMinor: price.scaledMinor, currency: price.currency, unit: price.unit },
    quantity: { milli: price.quantityMilli, unit: price.unit },
    day: price.startedOn ?? dayOfMoment(owner, price.startedAt),
    observations: price.observations,
  }
}
