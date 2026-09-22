import type { AdvicePlace, AdviceRow } from '@molvia/model'

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
 * The server returns the places sorted by unit price, own city first, and nothing else: a
 * field like `sole: true` would be a fact derivable from the list itself, and a superlative
 * should be named only by whoever has something to compare. How many places there are is
 * visible to the screen alone, so the word is the screen's.
 *
 * - `none` — rated but never bought: the card has no price block at all, rather than an empty one;
 * - `sole` — «Брали здесь: Рынок в Гюмри». Honest, and it does not pretend to be a comparison;
 * - `cheapest` — «Дешевле всего: …» plus «Ещё: …» for the rest.
 *
 * In a module of its own rather than in the component: an SFC exports a component, and a type
 * exported beside it is read as `any` by everything that is not the Vue compiler (as `tripRow.ts`).
 */
export type PlacesView =
  | { readonly kind: 'none' }
  | { readonly kind: 'sole' | 'cheapest'; readonly best: AdvicePlace; readonly rest: AdvicePlace[] }

export function placesView(places: readonly AdvicePlace[]): PlacesView {
  const [best, ...rest] = places
  if (!best) return { kind: 'none' }
  return { kind: rest.length === 0 ? 'sole' : 'cheapest', best, rest }
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
