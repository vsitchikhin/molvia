import { ERROR, ISSUE } from '@molvia/model'
import type { WireCode } from '@molvia/model'
import { read, write } from '@/stores/storage'

/**
 * What every queue on the device shares (MOL-82, В-6): the trip's, the verdicts' and the
 * spendings'. Three copies of «what holds a queue» would drift the way `INVISIBLE` once did.
 */

/**
 * What stops a queue rather than dropping a write: no connection or a server that broke (both
 * arrive as INTERNAL), an answer off the contract — the captive portal of a shop's wifi answers
 * 200 with its own page — and an identity the server no longer knows, which is waited out rather
 * than refused (MOL-56). A code the API did not say itself — a portal's 404 page read as
 * `not_found` — holds it too (adversarial A3). Every other refusal would be answered the same way
 * again, and a write retried forever would hold every write behind it (MOL-24, В-10).
 */
export const HOLDS: readonly WireCode[] = [ERROR.INTERNAL, ISSUE.RESPONSE_INVALID, ERROR.NO_ACTOR]

export type Loose = Record<string, unknown>

export function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null
}

/** A kept write's own name on the phone: a window takes out only the write it sent. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Runs `work` alone across every window of the app where the browser can say so. */
export function exclusively(name: string, work: () => Promise<void>): Promise<void> {
  // The DOM types promise `navigator.locks`; older WebViews do not have it (see stores/actor.ts).
  const locks = (navigator as unknown as Record<string, unknown>).locks as LockManager | undefined
  return locks ? locks.request(name, work) : work()
}

/**
 * How long to wait before trying again after the server broke while the connection is up: a 502
 * during a deploy brings no `online` event, and the last write would otherwise wait for the next
 * time the app is opened (review Р-5). Doubling, and never longer than five minutes.
 */
export const RETRY_FIRST_MS = 15_000
export const RETRY_LAST_MS = 300_000

export interface Retry {
  /** Try again after the current pause, and make the next one twice as long. */
  later(): void
  /** A run went through: the next pause starts from the first again. */
  reset(): void
  /** Nothing is to be tried by the timer — a question is on screen, or a run has begun. */
  cancel(): void
}

/** The doubling pause of a queue, which tries only while the browser believes it is online. */
export function doublingRetry(attempt: () => void): Retry {
  let timer: ReturnType<typeof setTimeout> | undefined
  let delay = RETRY_FIRST_MS
  return {
    later() {
      if (!navigator.onLine) return
      clearTimeout(timer)
      timer = setTimeout(attempt, delay)
      delay = Math.min(delay * 2, RETRY_LAST_MS)
    },
    reset() {
      delay = RETRY_FIRST_MS
    },
    cancel() {
      clearTimeout(timer)
    },
  }
}

/**
 * A removal the server has answered, and when (MOL-151): a screen hides the row until a read set
 * out after it. Kept on the device, as the month it hides it from is: kept in memory alone, a
 * reload after a read that failed brought the removed row back from the phone's month, until some
 * read got through (adversarial Б5).
 */
export interface Landed {
  readonly id: string
  readonly at: number
}

/** Older than any month the phone keeps unread: nothing is left to hide it from. */
const LANDED_KEPT_MS = 92 * 24 * 60 * 60 * 1000

export function recallLanded(key: string): Landed[] {
  const raw = read(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const since = Date.now() - LANDED_KEPT_MS
    return parsed.flatMap((item: unknown) =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.at === 'number' &&
      item.at > since
        ? [{ id: item.id, at: item.at }]
        : [],
    )
  } catch {
    return []
  }
}

/**
 * The removal of `id` landed (`removed`) or was taken back by a «Вернуть» that landed. Written over
 * what is stored, not over this window's copy: another window's removals stay (round 5).
 */
export function landedAgain(key: string, id: string, removed: boolean): Landed[] {
  const others = recallLanded(key).filter((item) => item.id !== id)
  const next = removed ? [...others, { id, at: Date.now() }] : others
  write(key, JSON.stringify(next))
  return next
}
