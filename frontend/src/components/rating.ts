import type { Rating, VerdictCard } from '@molvia/model'

/** What a verdict is worth, 1 to 5 — the domain's own bound, not a number chosen here. */
export type Score = Rating['score']

/**
 * A verdict as the server answered a write with it — what the sheet of «Что брать» opens on next,
 * until the rows are asked for again (MOL-202, А1).
 */
export type SavedVerdict = Pick<VerdictCard, 'score' | 'review'>

/**
 * What the screen keeps of a write until the rows are asked for again: the server's answer, `null`
 * once withdrawn — or `unknown`, a write that got no answer and may have landed (MOL-202, Ж1, З1–З4).
 */
export type WrittenVerdict = SavedVerdict | null | 'unknown'

/**
 * The keys of the scale, in the order they are drawn. In a module of its own because two
 * components need them — the card of «Оценки» and the scale it hands the sheet of «Что брать»
 * — and an SFC exports a component, not a list.
 */
export const SCORES = [1, 2, 3, 4, 5] as const satisfies readonly Score[]
