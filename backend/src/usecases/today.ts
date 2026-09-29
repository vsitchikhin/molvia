import { yerevanDate } from '@molvia/model'

/**
 * The owner as a use case of money takes it, with the phone's today the request came with
 * (`TODAY_HEADER`, MOL-121) — already held to the days that are today somewhere by the hook that
 * read it. Absent where nothing names it: the bot, a test, a caller inside the server.
 */
export interface Today {
  readonly today?: string
}

/** «Today» for this request: the phone's, or Yerevan's where the phone did not say. */
export function todayOf(owner: Today, now: Date): string {
  return owner.today ?? yerevanDate(now)
}
