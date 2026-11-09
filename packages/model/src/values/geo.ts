import { z } from 'zod'
import { visibleLine } from '#model/support/text'

export const countrySchema = z.string().regex(/^[A-Z]{2}$/)

export const citySchema = visibleLine(120)

/**
 * The time zone a person's day is read in, by the country they live in (MOL-101): the rating
 * reminder comes at seven in the evening of *their* day, and «yesterday» is their yesterday.
 * By country rather than by city, because every city the settings offer shares its country's
 * zone; a test refuses a country the settings accept without a line here. Belgrade keeps summer
 * time, which the zone's name carries — never an offset.
 */
export const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = {
  AM: 'Asia/Yerevan',
  GE: 'Asia/Tbilisi',
  RS: 'Europe/Belgrade',
}

/** The zone of a country, or `null` for one we have no day for — such a person is not reminded. */
export function timeZoneOf(country: string): string | null {
  return Object.hasOwn(COUNTRY_TIME_ZONES, country) ? (COUNTRY_TIME_ZONES[country] ?? null) : null
}

/**
 * The zone a person's day is read in where a message must reach them all the same — a warning before
 * an erasure (MOL-239), the notice of a sign-in (MOL-361): their country's, else the first market's.
 * No country of the settings is without a zone, but a row older than them may be, and such a person
 * left out would be warned of nothing.
 */
export const PERSON_DEFAULT_ZONE = 'Asia/Yerevan'

export function personZoneOf(country: string): string {
  return timeZoneOf(country) ?? PERSON_DEFAULT_ZONE
}
