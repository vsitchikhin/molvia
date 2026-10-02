import type { OwnPlacePrice, OwnPricesResponse } from '#model/contracts/advice'
import type { Currency } from '#model/values/money'
import { compareUnitPrice } from '#model/values/units'
import type { BaseUnit, UnitPrice } from '#model/values/units'

/**
 * What «Тут дешевле» says of the item on the sheet (MOL-92), by the price typed against the
 * cheapest last price of the person's own places:
 *
 * - `best` — nothing typed yet: where it was cheapest, said plainly (В-1);
 * - `there` — typed dearer: where it was cheaper;
 * - `same` — typed at that very price (В-2);
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
  readonly answer: OwnPricesResponse
  /**
   * The currency and the unit chosen on the sheet: the one group prices are compared in while
   * nothing is typed (Р-4 of MOL-31). The sheet always has both — the unit from the item, the
   * currency from the record.
   */
  readonly currency: Currency
  readonly unit: BaseUnit
  /** The unit price of what is typed, or `null` while there is none; its own pair is the group. */
  readonly typed: UnitPrice | null
  /** The record's place, when the phone knows it; a record started offline has none yet. */
  readonly here: string | null
}

const NOTHING: CheaperHint = { item: null, alternative: null }

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

function kindOf(typed: UnitPrice | null, best: OwnPlacePrice): ItemHint['kind'] {
  if (typed === null) return 'best'
  const order = compareUnitPrice(typed, best.unitPrice)
  if (order < 0) return 'cheaper'
  return order === 0 ? 'same' : 'there'
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
  if (answer.level === 'never') return NOTHING
  // What is typed names its own pair, so the two can never be compared across one.
  const { currency, unit } = typed ?? input

  const best = cheapestIn(answer.places, currency, unit)
  const item: ItemHint | null = best && {
    kind: kindOf(typed, best),
    place: best,
    here: here !== null && best.placeId === here.toLowerCase(),
  }

  const reference = typed ?? best?.unitPrice ?? null
  if (reference === null) return { item, alternative: null }

  const floor = answer.level === 'unrated' ? null : tenths(answer.rating)
  let alternative: AlternativeHint | null = null
  for (const other of answer.alternatives) {
    if (floor === null ? other.level !== 'take' : tenths(other.rating) < floor) continue
    const place = cheapestIn(other.places, currency, unit)
    if (!place || compareUnitPrice(place.unitPrice, reference) >= 0) continue
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
