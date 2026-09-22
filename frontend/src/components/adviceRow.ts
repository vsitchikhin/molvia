import { formatUnitPrice } from '@molvia/model'
import type { AdvicePlace, AdviceRow, AdviceScope, UnitPrice } from '@molvia/model'
import { SCORES } from '@/components/rating'
import type { Score } from '@/components/rating'

/**
 * The three shapes of row, each named on its own: a component takes the one it draws, so a
 * card that looks for a price cannot be handed a row that has none (MOL-31, Р-8).
 */
export type TakeRow = Extract<AdviceRow, { level: 'take' }>
export type CheapRow = Extract<AdviceRow, { level: 'if_cheap' }>
export type NeverRow = Extract<AdviceRow, { level: 'never' }>

/**
 * How a row's places read, and it is the **only** thing the screen decides about the data
 * (MOL-32, Р-2; the answer to MOL-34).
 *
 * The server returns the places **own city first, then by price** (MOL-31, Р-26), not by price
 * alone: a cheaper receipt from another city stands below a dearer place at home, because
 * «cheaper elsewhere» is not somewhere one can go. So the first place is the one to name — and
 * it is not always the cheapest.
 *
 * `cheapest` says whether it happens to be. **The superlative is said only when it is true**
 * (MOL-32, А1): «Дешевле всего: Рынок в Гюмри — 4 000 ֏/кг» over a line reading «Ещё: SAS
 * Ереван 3 000 ֏/кг» is a lie the screen was printing, and the price it points at is the one
 * the person decides by. Otherwise the place is named without a claim: «Брали здесь».
 *
 * In a module of its own rather than in the component: an SFC exports a component, and a type
 * exported beside it is read as `any` by everything that is not the Vue compiler (as `tripRow.ts`).
 */
export type PlacesView =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'places'
      readonly best: AdvicePlace
      readonly rest: readonly AdvicePlace[]
      readonly cheapest: boolean
    }

export function placesView(places: readonly AdvicePlace[]): PlacesView {
  const [best, ...rest] = places
  if (!best) return { kind: 'none' }
  return {
    kind: 'places',
    best,
    rest,
    // One place is no comparison at all, so there is nothing to be cheapest among. Prices of
    // two currencies or two units are no comparison either — the server sends one pair per
    // item (Р-4), and if that ever stops being true the word goes rather than the screen.
    cheapest: rest.length > 0 && rest.every((place) => dearer(place, best)),
  }
}

function dearer(place: AdvicePlace, best: AdvicePlace): boolean {
  const [a, b] = [place.unitPrice, best.unitPrice]
  return a.currency === b.currency && a.unit === b.unit && a.scaledMinor >= b.scaledMinor
}

/** The key of the word over the named place: a superlative only where it is the truth. */
export const whereKey = (view: PlacesView): string =>
  view.kind === 'places' && view.cheapest ? 'advice.cheapest_at' : 'advice.bought_at'

/** What a translator has to be able to do for the helpers here — `useI18n().t`, and nothing more. */
type Translate = (key: string, named: Record<string, unknown>) => string

/**
 * «570,00 ֏/л» — a unit price as this screen prints it. One copy for both forms of row that
 * show one: the card and the line say the same number the same way, or the eye catches the
 * difference before any test does.
 */
export function unitPriceText(price: UnitPrice, t: Translate, locale: string): string {
  return t('item.unit_price_value', {
    amount: formatUnitPrice(price, locale),
    unit: t(`item.unit_${price.unit}`, {}),
  })
}

/**
 * «4.3» → «4,3»: the rating as the screen prints it, in the app's language.
 *
 * The figure crosses the wire as a decimal string, because one person's whole five and an
 * average over many share the field (MOL-31, Р-12). It has exactly one decimal by contract,
 * so the round trip through a number is exact — and a rating is not money in any case: the
 * rule that forbids floats is about amounts, and this is a score out of five.
 */
export function formatRating(rating: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(rating))
}

/**
 * The person's own score behind a row, when the row carries it — and `null` when it does not.
 *
 * In the shared mode the figure is an average over several people (MOL-31, Р-13), and their
 * average is not this person's opinion: offered pre-chosen in the sheet, a save would write it
 * down as one. In the own mode the row is a single verdict, so the figure is a whole number
 * and it is theirs. Checked rather than assumed: a fraction means the row is not one person's.
 */
export function ownScore(rating: string, scope: AdviceScope): Score | null {
  if (scope !== 'own') return null
  const value = Number(rating)
  return SCORES.find((score) => score === value) ?? null
}
