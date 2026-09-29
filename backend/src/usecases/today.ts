import { dayIn, midnightIn, yerevanDate } from '@molvia/model'

/**
 * The owner as a use case of money takes it, with the phone's today the request came with
 * (`TODAY_HEADER`, MOL-121) — already held to the days that are today somewhere by the hook that
 * read it. Absent where nothing names it: the bot, a test, a caller inside the server.
 */
export interface Today {
  readonly today?: string
  /**
   * The phone's time zone (`ZONE_HEADER`, adversarial round 4 У, Ч): where its days begin and end,
   * for a moment the server stamped to be a day beside the days the phone names. The zone of this
   * request — a person who flew since writing a record is judged by where they are now.
   */
  readonly zone?: string
}

/** «Today» for this request: the phone's, or Yerevan's where the phone did not say. */
export function todayOf(owner: Today, now: Date): string {
  return owner.today ?? yerevanDate(now)
}

/** The day of a moment the server stamped, in the phone's zone — Yerevan's where it named none. */
export function dayOfMoment(owner: Today, instant: Date): string {
  return dayIn(instant, owner.zone)
}

/** The instant after the last of `day` in the phone's zone: the midnight that ends it. */
export function endOfDay(owner: Today, day: string): Date {
  const next = new Date(Date.parse(`${day}T00:00:00.000Z`) + 24 * 60 * 60 * 1000)
  return midnightIn(next.toISOString().slice(0, 10), owner.zone)
}
