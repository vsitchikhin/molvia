import type { Rating } from '@molvia/model'

/** What a verdict is worth, 1 to 5 — the domain's own bound, not a number chosen here. */
export type Score = Rating['score']

/**
 * The keys of the scale, in the order they are drawn. In a module of its own because two
 * components need them — the card of «Оценки» and the scale it hands the sheet of «Что брать»
 * — and an SFC exports a component, not a list.
 */
export const SCORES = [1, 2, 3, 4, 5] as const satisfies readonly Score[]
