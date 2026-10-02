import type { OwnPlacePrice, OwnPrices } from '#model/contracts/advice'
import type { Currency } from '#model/values/money'
import { minorPerMajor } from '#model/values/money'
import { UNIT_PRICE_SCALE, compareUnitPrice } from '#model/values/units'
import type { BaseUnit, Quantity, UnitPrice } from '#model/values/units'

/**
 * What «Тут дешевле» says of the item on the sheet (MOL-92), by the price typed against the
 * cheapest last price of the person's own places:
 *
 * - `best` — nothing typed yet: where it was cheapest, said plainly (В-1);
 * - `there` — typed dearer: where it was cheaper;
 * - `same` — typed at that price, within `samePrice` (В-2);
 * - `cheaper` — typed below every place: «тут дешевле» (В-2).
 *
 * `here` says the place is the record's own (Р-3): «здесь же брали по 600 ֏/л».
 */
export interface ItemHint {
  readonly kind: 'best' | 'there' | 'same' | 'cheaper'
  readonly place: OwnPlacePrice
  readonly here: boolean
}

/** Another item of the same kind, cheaper and rated no worse (MOL-92, В-3, В-7…В-9). */
export interface AlternativeHint {
  readonly itemId: string
  readonly name: string
  readonly rating: string
  readonly place: OwnPlacePrice
}

export interface CheaperHint {
  readonly item: ItemHint | null
  readonly alternative: AlternativeHint | null
}

export interface CheaperHintInput {
  readonly answer: OwnPrices
  /**
   * The currency and the unit chosen on the sheet: the one group prices are compared in while
   * nothing is typed (Р-4 of MOL-31). The sheet always has both — the unit from the item, the
   * currency from the record.
   */
  readonly currency: Currency
  readonly unit: BaseUnit
  /** The unit price of what is typed, or `null` while there is none; its own pair is the group. */
  readonly typed: UnitPrice | null
  /** How much is typed: the till's rounding of the sum wobbles a small purchase's price most (Г′). */
  readonly typedQuantity?: Quantity | null
  /** The record's place, when the phone knows it; a record started offline has none yet. */
  readonly here: string | null
}

const NOTHING: CheaperHint = { item: null, alternative: null }

/**
 * Two unit prices this close are one price, in thousandths of the earlier one (MOL-92, adversarial
 * Г): a price on a tag seen twice, under the wobble of how it was typed.
 */
export const SAME_PRICE_PERMILLE = 5n

/**
 * How far a unit price may move by the till alone: a sum is typed whole, so half a unit of the
 * currency either way, spread over what was bought (adversarial Г′). 690 ֏/кг for 0,15 kg is 103,50,
 * paid 104 — 693,33 ֏/кг; the same tag for 1,234 kg came out 689,63. The less bought, the more it
 * wobbles: half a per cent held 0,611 kg and not 0,15.
 */
function tillNoise(price: UnitPrice, quantity: Quantity): bigint {
  if (quantity.milli <= 0n) return 0n
  return (minorPerMajor(price.currency) * 1000n * UNIT_PRICE_SCALE) / (2n * quantity.milli)
}

/**
 * Whether `price`, of `quantity`, is the same as `earlier`, of `earlierQuantity` — inside one currency
 * and unit: within `SAME_PRICE_PERMILLE`, or within what the till's rounding of both sums can move.
 */
export function samePrice(
  price: UnitPrice,
  quantity: Quantity | null,
  earlier: UnitPrice,
  earlierQuantity: Quantity | null,
): boolean {
  compareUnitPrice(price, earlier)
  const gap = price.scaledMinor - earlier.scaledMinor
  const relative = (SAME_PRICE_PERMILLE * earlier.scaledMinor) / 1000n
  const rounding =
    (quantity ? tillNoise(price, quantity) : 0n) +
    (earlierQuantity ? tillNoise(earlier, earlierQuantity) : 0n)
  return (gap < 0n ? -gap : gap) <= (relative > rounding ? relative : rounding)
}

/** «4.5» → 45: the printed tenth, which decides as it decides the groups (MOL-31, Р-22). */
function tenths(rating: string): number {
  return Number(rating.replace('.', ''))
}

/** The cheapest place in the group, the server's order breaking a tie. */
function cheapestIn(
  places: readonly OwnPlacePrice[],
  currency: Currency,
  unit: BaseUnit,
): OwnPlacePrice | null {
  let best: OwnPlacePrice | null = null
  for (const place of places) {
    if (place.unitPrice.currency !== currency || place.unitPrice.unit !== unit) continue
    if (best === null || compareUnitPrice(place.unitPrice, best.unitPrice) < 0) best = place
  }
  return best
}

function kindOf(
  typed: UnitPrice | null,
  typedQuantity: Quantity | null,
  best: OwnPlacePrice,
): ItemHint['kind'] {
  if (typed === null) return 'best'
  if (samePrice(typed, typedQuantity, best.unitPrice, best.quantity)) return 'same'
  return compareUnitPrice(typed, best.unitPrice) < 0 ? 'cheaper' : 'there'
}

/**
 * The two lines of «Тут дешевле» (MOL-92). A function of the domain called by the sheet, so the
 * comparison is written once — the server sends the prices, it does not know what is being typed.
 *
 * **«Не брать нигде» says nothing** (Т-3); the answer for it has no prices to say it with.
 *
 * The alternative is compared with the price typed, or, before one is, with the item's own
 * cheapest place (Р-12) — with neither there is nothing it could be cheaper than, and it is not
 * named. It must be strictly cheaper: at the same price there is no reason to change. It must be
 * rated no worse by the printed tenth, and when the item itself is not rated, be in «Брать»
 * (В-8). Of those that qualify, the best rated is named and the cheapest breaks a tie — the
 * owner's comment to В-9: «если Марианна дешевле, но оценена ниже — показываем Анелик».
 */
export function cheaperHint(input: CheaperHintInput): CheaperHint {
  const { answer, typed, here } = input
  const typedQuantity = typed ? (input.typedQuantity ?? null) : null
  if (answer.level === 'never') return NOTHING
  // What is typed names its own pair, so the two can never be compared across one.
  const { currency, unit } = typed ?? input

  const best = cheapestIn(answer.places, currency, unit)
  const item: ItemHint | null = best && {
    kind: kindOf(typed, typedQuantity, best),
    place: best,
    here: here !== null && best.placeId === here.toLowerCase(),
  }

  const reference = typed ?? best?.unitPrice ?? null
  const referenceQuantity = typed ? typedQuantity : (best?.quantity ?? null)
  if (reference === null) return { item, alternative: null }

  const floor = answer.level === 'unrated' ? null : tenths(answer.rating)
  let alternative: AlternativeHint | null = null
  for (const other of answer.alternatives) {
    if (floor === null ? other.level !== 'take' : tenths(other.rating) < floor) continue
    const place = cheapestIn(other.places, currency, unit)
    // Cheaper by more than the noise of a scale: at one price there is no reason to change.
    if (!place || compareUnitPrice(place.unitPrice, reference) >= 0) continue
    if (samePrice(place.unitPrice, place.quantity, reference, referenceQuantity)) continue
    const better =
      alternative === null ||
      tenths(other.rating) > tenths(alternative.rating) ||
      (tenths(other.rating) === tenths(alternative.rating) &&
        compareUnitPrice(place.unitPrice, alternative.place.unitPrice) < 0)
    if (better) {
      alternative = { itemId: other.itemId, name: other.name, rating: other.rating, place }
    }
  }
  return { item, alternative }
}
