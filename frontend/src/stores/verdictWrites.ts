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
  // The API's `2xx` the contract could not read is no refusal either: written, in words this build
  // cannot read (adversarial З3).
  return error instanceof ApiError && error.answered && error.fromApi && !error.offContract
    ? { kind: 'refused' }
    : { kind: 'unknown' }
}

interface InFlight {
  readonly outcome: Promise<WriteOutcome>
  /** «Снять оценку» rather than a score: the sheet that waits says the work by its own word (Ж2). */
  readonly withdrawal: boolean
  /**
   * The half of a write in two that landed — the score by `PUT`, the review still on its way: a review
   * refused after it leaves the score written, for the sheet that waits too (review №7).
   */
  landed?: SavedVerdict
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
  const entry: InFlight = {
    outcome: write.then(
      (verdict): WriteOutcome => ({ kind: 'written', verdict }),
      (error: unknown): WriteOutcome => {
        const outcome = outcomeOf(error)
        return outcome.kind === 'refused' && entry.landed
          ? { kind: 'written', verdict: entry.landed }
          : outcome
      },
    ),
    withdrawal,
  }
  writes.set(key, entry)
  void entry.outcome.then(() => {
    if (writes.get(key) === entry) writes.delete(key)
  })
}

/** The first half of the item's write in two landed (review №7). */
export function landedHalf(key: string, verdict: SavedVerdict): void {
  const entry = writes.get(key)
  if (entry) entry.landed = verdict
}

/** A fresh page, as a reload makes one: for the tests, which share one module between them. */
export function forgetWritesInFlight(): void {
  writes.clear()
}
