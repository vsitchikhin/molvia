import type { AdvicePlace } from '@molvia/model'

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
