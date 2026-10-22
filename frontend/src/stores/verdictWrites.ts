import { ApiError } from '@molvia/client'
import type { SavedVerdict } from '@/components/rating'

/**
 * How a write of the verdict sheet ended: the server's answer — `null` once withdrawn — a refusal in
 * the API's own words, after which the row is right, or no answer at all: cut off by the client's
 * timeout, the connection lost, a portal's page. That last is not a refusal: the write may have
 * landed, and nobody knows which score is the person's (adversarial Ж1).
 */
export type WriteOutcome =
  | { readonly kind: 'written'; readonly verdict: SavedVerdict | null }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unknown' }

export function outcomeOf(error: unknown): WriteOutcome {
  return error instanceof ApiError && error.answered && error.fromApi
    ? { kind: 'refused' }
    : { kind: 'unknown' }
}

interface InFlight {
  readonly outcome: Promise<WriteOutcome>
  /** «Снять оценку» rather than a score: the sheet that waits says the work by its own word (Ж2). */
  readonly withdrawal: boolean
}

/**
 * The writes of the verdict sheet still on their way, by owner and item (MOL-202, adversarial Е1).
 * A sheet swept away mid-write and opened again on its item waits for it and takes what it wrote as
 * its own: opened on the row's old score it said «Ваша оценка: 1» while the 5 was on its way, refused
 * the 1 back as «Ничего не изменилось», and the 5 landed after. One write of an item at a time.
 */
const writes = new Map<string, InFlight>()

export function writeInFlight(key: string): InFlight | undefined {
  return writes.get(key)
}

export function trackWrite(
  key: string,
  write: Promise<SavedVerdict | null>,
  withdrawal: boolean,
): void {
  const outcome = write.then((verdict): WriteOutcome => ({ kind: 'written', verdict }), outcomeOf)
  const entry = { outcome, withdrawal }
  writes.set(key, entry)
  void outcome.then(() => {
    if (writes.get(key) === entry) writes.delete(key)
  })
}

/** A fresh page, as a reload makes one: for the tests, which share one module between them. */
export function forgetWritesInFlight(): void {
  writes.clear()
}
