import { COUNTRY_TIME_ZONES, timeZoneOf } from '#model/values/geo'
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
 * The first warning falls due a day before its thirty (adversarial А2): it waits for the person's day
 * (Р-5), and a day falling due at 21:00 went at 10:00 the next morning — «через 29 дней» under a page
 * that promises thirty. Any day of twenty-four hours holds a whole window of the person's day, so sent
 * within it the first warning always leaves thirty days at least. The last needs no lead: a week from
 * its sending is the erasure's day at the soonest (Р-3).
 */
export const SILENCE_FIRST_LEAD_DAYS = 1

/**
 * The second warning comes at least this long after the first: a first one sent late, a few minutes
 * before the second fell due, would have been followed by the other at once.
 */
export const SILENCE_STEP_GAP_HOURS = 24

/**
 * No account is erased sooner than this after its last warning (Р-3): the page promises a warning a
 * week before, and the warning names its day — a bot down for days moves the erasure, never the
 * warning, and a block heard after the warning does not bring the named day forward (adversarial А3).
 */
export const SILENCE_LAST_WARNING_DAYS = 7

/** The hours of the person's own day a warning is sent in (Р-5): nobody is woken for it. */
export const SILENCE_SEND_FROM_HOUR = 10
export const SILENCE_SEND_UNTIL_HOUR = 20

/**
 * The zone a person's day is read in for a warning: their country's, else Yerevan's (self-review №4).
 * No country of the settings is without a zone, but a row older than them may be, and a person never
 * warned would never be erased either — the page's «удалится сам» silently broken for good.
 */
export const SILENCE_DEFAULT_ZONE = 'Asia/Yerevan'

export function silenceZoneOf(country: string): string {
  return timeZoneOf(country) ?? SILENCE_DEFAULT_ZONE
}

function isSendHour(now: Date, zone: string): boolean {
  const { hour } = localClock(now, zone)
  return hour >= SILENCE_SEND_FROM_HOUR && hour < SILENCE_SEND_UNTIL_HOUR
}

/**
 * Whose day it is at `now`: the countries with a zone whose hour it is, and whether it is the day of a
 * country with none — read in `SILENCE_DEFAULT_ZONE`. The bot is handed warnings for these people only.
 */
export function silenceSendDay(now: Date): {
  readonly countries: readonly string[]
  readonly elsewhere: boolean
} {
  return {
    countries: Object.entries(COUNTRY_TIME_ZONES)
      .filter(([, zone]) => isSendHour(now, zone))
      .map(([country]) => country),
    elsewhere: isSendHour(now, SILENCE_DEFAULT_ZONE),
  }
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
