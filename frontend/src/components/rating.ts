import type { Rating, VerdictCard } from '@molvia/model'

/** What a verdict is worth, 1 to 5 — the domain's own bound, not a number chosen here. */
export type Score = Rating['score']

/**
 * A verdict as the server answered a write with it — what the sheet of «Что брать» opens on next,
 * until the rows are asked for again (MOL-202, А1).
 */
export type SavedVerdict = Pick<VerdictCard, 'score' | 'review'>

/**
 * The keys of the scale, in the order they are drawn. In a module of its own because two
 * components need them — the card of «Оценки» and the scale it hands the sheet of «Что брать»
 * — and an SFC exports a component, not a list.
 */
export const SCORES = [1, 2, 3, 4, 5] as const satisfies readonly Score[]

/**
 * The writes of the verdict sheet still on their way, by owner and item (MOL-202, adversarial Е1):
 * the answer, `null` once withdrawn, `undefined` if refused. A sheet swept away mid-write and opened
 * again on its item waits for it — «Сохраняем…» — and takes what it wrote as its own: opened on the
 * row's old score it said «Ваша оценка: 1» while the 5 was on its way, refused the 1 back as
 * «Ничего не изменилось», and the 5 landed after. One write of an item at a time, in order.
 */
const writesInFlight = new Map<string, Promise<SavedVerdict | null | undefined>>()

export function writeInFlight(key: string): Promise<SavedVerdict | null | undefined> | undefined {
  return writesInFlight.get(key)
}

export function trackWrite(key: string, write: Promise<SavedVerdict | null>): void {
  const settled = write.then(
    (verdict) => verdict,
    () => undefined,
  )
  writesInFlight.set(key, settled)
  void settled.then(() => {
    if (writesInFlight.get(key) === settled) writesInFlight.delete(key)
  })
}

/** A fresh page, as a reload makes one: for the tests, which share one module between them. */
export function forgetWritesInFlight(): void {
  writesInFlight.clear()
}
