import { COUNTRY_TIME_ZONES } from '#model/values/geo'
import { daysBetween, localClock } from '#model/entities/reminder'

/**
 * Two years of silence (MOL-239, owner's В-2 of MOL-97): an account whose last visit
 * (`actors.last_seen_at`, MOL-238) is this many calendar years old is erased, as «Удалить мои данные»
 * erases it. Calendar years, as the privacy page says them — Postgres adds them (`make_interval`),
 * and the 29th of February goes to the 28th.
 */
export const SILENCE_YEARS = 2

/**
 * The bot warns this many days before (the page: «за 30 и за 7 дней»). A late bot sends only the
 * latest step due (Р-4): two messages in a row would be noise.
 */
export const SILENCE_WARN_DAYS = [30, 7] as const
export type SilenceStep = (typeof SILENCE_WARN_DAYS)[number]

/**
 * The second warning comes at least this long after the first: a first one sent late, a few minutes
 * before the second fell due, would have been followed by the other at once.
 */
export const SILENCE_STEP_GAP_HOURS = 24

/**
 * An account the bot can reach is never erased sooner than this after its last warning (Р-3): the
 * page promises a warning a week before, and names a blocked bot as the only way to get none. A bot
 * down for days moves the erasure, never the warning.
 */
export const SILENCE_LAST_WARNING_DAYS = 7

/** The hours of the person's own day a warning is sent in (Р-5): nobody is woken for it. */
export const SILENCE_SEND_FROM_HOUR = 10
export const SILENCE_SEND_UNTIL_HOUR = 20

/**
 * The countries whose day it is at `now`: the bot is handed warnings for people of these only. A
 * country with no zone has no day, and its people are warned nowhere — none is accepted by the
 * settings (a test of MOL-101 holds it).
 */
export function silenceSendCountries(now: Date): string[] {
  return Object.entries(COUNTRY_TIME_ZONES)
    .filter(([, zone]) => {
      const { hour } = localClock(now, zone)
      return hour >= SILENCE_SEND_FROM_HOUR && hour < SILENCE_SEND_UNTIL_HOUR
    })
    .map(([country]) => country)
}

/**
 * What the warning says: the day the account goes, in the person's zone, and how many of their days
 * are left until it — never fewer than one, since a warning is sent only well before.
 */
export function silenceCountdown(
  eraseAt: Date,
  now: Date,
  timeZone: string,
): { readonly day: string; readonly days: number } {
  const day = localClock(eraseAt, timeZone).day
  return { day, days: Math.max(1, daysBetween(localClock(now, timeZone).day, day)) }
}
