import { z } from 'zod'
import {
  ADVICE_WARNINGS_RESERVED,
  AGGREGATE_MIN_CONTRIBUTIONS,
  DomainError,
  ERROR,
  NEVER_BELOW_TENTHS,
  OWN_ALTERNATIVES_MAX,
  averageScore,
  hasSharedAccess,
  kindKey,
  ownPricesResponseSchema,
  verdictLevel,
} from '@molvia/model'
import type {
  AdviceScope,
  OwnAlternative,
  OwnPlacePrice,
  OwnPricesQuery,
  OwnPricesResponse,
} from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { ExpenseRepository, OwnLatestPrice } from '@/db/expenses-repository'
import type { ItemRepository } from '@/db/items-repository'
import type { VerdictRepository } from '@/db/verdicts-repository'
import { dayOfMoment } from '@/usecases/today'
import type { Today } from '@/usecases/today'

export interface OwnPricesDeps {
  readonly actors: ActorRepository
  readonly verdicts: VerdictRepository
  readonly expenses: ExpenseRepository
  readonly items: ItemRepository
}

/**
 * How many products of one kind a person may have bought in one city before the oldest-named are
 * not asked about. Far above a shelf: the seed holds 24 cheeses in all.
 */
const KIND_CANDIDATES = 200

/**
 * «Тут дешевле» on the sheet of a purchase (MOL-92): the person's own last prices of the item in
 * the record's city, and the other items of its kind they bought there with the rating they see
 * for each on «Что брать». Which line the sheet says is `cheaperHint`'s — it knows what is typed.
 *
 * **Only one's own purchases** (Т-1): with access or without, the same answer — the prices of
 * other people are an aggregate, and aggregates are 0.3's hypothesis. The level, and the ratings
 * of the alternatives, are the ones «Что брать» shows this person, read by the same statement
 * (Р-6, Р-10): a screen and a sheet that disagreed on «не брать нигде» would be two products.
 *
 * **«Не брать нигде» is never asked about**: its prices are not filtered out of the answer, they
 * are not read (Т-3). A dish has no hint (Р-1), and an item the catalogue does not hold has none
 * either — the same empty answer, so a guessed id learns nothing.
 *
 * It writes nothing (Т-6): no visit, no pick — the person looks at their own prices.
 */
export async function ownPrices(
  { actors, verdicts, expenses, items }: OwnPricesDeps,
  owner: Today & { readonly actorId: string },
  query: OwnPricesQuery,
): Promise<OwnPricesResponse> {
  const actor = await actors.byId(owner.actorId)
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  const scope: AdviceScope = hasSharedAccess(actor, new Date()) ? 'shared' : 'own'

  const item = await items.byId(query.item)
  // Answered in lower case whatever the case it was asked in (`resource.ts`, MOL-25).
  const nothing: OwnPricesResponse = {
    itemId: item?.id ?? query.item.toLowerCase(),
    level: 'unrated',
    places: [],
    alternatives: [],
  }
  if (item?.kind !== 'product') return nothing

  const where = { actorId: actor.id, country: query.country, city: query.city }
  const candidates = await expenses.ownItemsOfKind({
    ...where,
    kind: kindKey(item.name),
    notItem: item.id,
    limit: KIND_CANDIDATES,
  })

  const asked = [item.id, ...candidates]
  const { rows } = await verdicts.adviceRowsFor({
    actorId: actor.id,
    scope,
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
  if (own?.level === 'never') return { itemId: item.id, level: 'never' }

  // Only what is rated and not «не брать нигде» may be an alternative (Р-11): «оценено лучше или
  // так же» cannot be checked without a rating. Best rated first, so the cut keeps the ones the
  // sheet would name (В-9).
  const others = rated
    .filter((entry) => entry.row.itemId !== item.id && entry.level !== 'never')
    .sort((a, b) => Number(b.rating) - Number(a.rating) || (a.row.itemId < b.row.itemId ? -1 : 1))
    .slice(0, OWN_ALTERNATIVES_MAX)

  const prices = await expenses.ownLatestFor({
    ...where,
    itemIds: [item.id, ...others.map((entry) => entry.row.itemId)],
    ...(query.except === undefined ? {} : { except: query.except }),
  })
  const placesOf = (itemId: string): OwnPlacePrice[] =>
    prices.filter((price) => price.itemId === itemId).map((price) => placeOf(owner, price))

  const alternatives: OwnAlternative[] = others.flatMap(({ row, level, rating }) => {
    const places = placesOf(row.itemId)
    if (places.length === 0 || level === 'never') return []
    return [{ itemId: row.itemId, name: row.name, level, rating, places }]
  })

  const priced = { itemId: item.id, places: placesOf(item.id), alternatives }
  const answer: OwnPricesResponse = own
    ? { ...priced, level: own.level, rating: own.rating }
    : { ...priced, level: 'unrated' }

  // Encoded here, as `advice` does: an answer the wire cannot carry fails beside its data.
  z.encode(ownPricesResponseSchema, answer)
  return answer
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
    day: price.startedOn ?? dayOfMoment(owner, price.startedAt),
    observations: price.observations,
  }
}
