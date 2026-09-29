import { z } from 'zod'
import { visibleLine } from '#model/support/text'

export const countrySchema = z.string().regex(/^[A-Z]{2}$/)

export const citySchema = visibleLine(120)

/**
 * The time zone a person's day is read in, by the country they live in (MOL-101): the rating
 * reminder comes at seven in the evening of *their* day, and «yesterday» is their yesterday.
 * By country rather than by city, because every city the settings offer shares its country's
 * zone. Georgia (`Asia/Tbilisi`) and Serbia (`Europe/Belgrade`) come with their cities (MOL-89),
 * and a test refuses a country the settings accept without a line here.
 */
export const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = { AM: 'Asia/Yerevan' }

/** The zone of a country, or `null` for one we have no day for — such a person is not reminded. */
export function timeZoneOf(country: string): string | null {
  return Object.hasOwn(COUNTRY_TIME_ZONES, country) ? (COUNTRY_TIME_ZONES[country] ?? null) : null
}
