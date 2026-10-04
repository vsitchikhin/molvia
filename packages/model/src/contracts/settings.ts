import { z } from 'zod'
import { countrySchema, citySchema, COUNTRY_TIME_ZONES } from '#model/values/geo'
import { currencySchema } from '#model/values/money'
import { ISSUE } from '#model/support/errors'
import { placeNameIdentity } from '#model/values/place-identity'

/**
 * The countries a person may choose, and the cities of each (MOL-89, MOL-109): Armenia from 0.1,
 * Georgia and Serbia from 0.2. A city is its Russian name — the key of a place and of the words a
 * screen prints it with. The first city of a country is the one a change of country lands on, and
 * the one a newcomer whose phone lives in that country starts in.
 */
export const SETTINGS_COUNTRIES = ['AM', 'GE', 'RS'] as const
export type SettingsCountry = (typeof SETTINGS_COUNTRIES)[number]

export const COUNTRY_CITIES = {
  AM: ['Гюмри', 'Ереван'],
  GE: ['Тбилиси', 'Батуми'],
  RS: ['Белград', 'Нови-Сад'],
} as const satisfies Readonly<Record<SettingsCountry, readonly [string, ...string[]]>>
export type SettingsCity = (typeof COUNTRY_CITIES)[SettingsCountry][number]

/** Every city of every country, in the order of the countries. */
export const SETTINGS_CITIES: readonly SettingsCity[] = SETTINGS_COUNTRIES.flatMap(
  (country) => COUNTRY_CITIES[country],
)

export function isSettingsCountry(country: string): country is SettingsCountry {
  return SETTINGS_COUNTRIES.some((known) => known === country)
}

/** The cities a country offers, or none for a country the settings do not. */
export function citiesOf(country: string): readonly SettingsCity[] {
  return isSettingsCountry(country) ? COUNTRY_CITIES[country] : []
}

/**
 * The city of the settings a stored spelling is (MOL-120, adversarial А2), or `null` for one the
 * settings do not offer. A place keeps its city as it was first written (`ensure`), so a row of
 * «гюмри» is Gyumri to the index over `places` and to `cityWhereNameRepeats` — and must be Gyumri
 * to the words a screen or the bot prints it with, which are keyed by the settings' spelling.
 */
export function settingsCityOf(city: string): SettingsCity | null {
  const folded = placeNameIdentity(city)
  return SETTINGS_CITIES.find((known) => placeNameIdentity(known) === folded) ?? null
}

/** Also reads historical settings outside today's choices. */
export const actorSettingsSchema = z.strictObject({
  country: countrySchema,
  city: citySchema,
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
})
export const settingsGeographySchema = actorSettingsSchema.pick({ country: true, city: true })
export type SettingsGeography = z.infer<typeof settingsGeographySchema>

export type ActorSettings = z.infer<typeof actorSettingsSchema>

export function settingsOf(value: ActorSettings): ActorSettings {
  return {
    country: value.country,
    city: value.city,
    spendCurrency: value.spendCurrency,
    incomeCurrency: value.incomeCurrency,
  }
}

export function sameSettings(a: ActorSettings, b: ActorSettings): boolean {
  return (
    a.country === b.country &&
    a.city === b.city &&
    a.spendCurrency === b.spendCurrency &&
    a.incomeCurrency === b.incomeCurrency
  )
}

/**
 * Where a newcomer starts (MOL-109, В-3): the country their phone's time zone lives in, at its first
 * city, else Gyumri — as every account began before Georgia and Serbia. A guess, never asked about:
 * the settings change it in one tap, and it beats landing a person from Belgrade in Gyumri, where
 * their first trip would write a shop.
 */
export function firstGeography(zone: string | undefined): SettingsGeography {
  const country =
    SETTINGS_COUNTRIES.find((known) => zone !== undefined && COUNTRY_TIME_ZONES[known] === zone) ??
    'AM'
  return { country, city: COUNTRY_CITIES[country][0] }
}

export function geographyKey(value: Pick<ActorSettings, 'country' | 'city'>): string {
  return JSON.stringify([value.country, value.city])
}

/**
 * Whether a geography may be written down at all: a city of its own country, or exactly the
 * one the person already has — a historical row from before the form existed stays usable,
 * and so does an offline trip that carries the settings of the day it was started.
 *
 * One predicate for both write paths on purpose (MOL-65, review 1). While the trip's
 * geography came from `actors`, «the country is fixed as Armenia» was held by the form alone;
 * with a trip naming its own, a second rule here would mean `PUT /actors/me/settings` refusing
 * what `POST /trips` writes into `places` — the table everyone shares.
 */
export function geographyAllowed(
  value: Pick<ActorSettings, 'country' | 'city'>,
  held: Pick<ActorSettings, 'country' | 'city'>,
): boolean {
  return (
    (value.country === held.country && value.city === held.city) ||
    citiesOf(value.country).some((city) => city === value.city)
  )
}

export const settingsUpdateSchema = z
  .strictObject({
    previous: actorSettingsSchema,
    settings: actorSettingsSchema,
  })
  .refine(({ previous, settings }) => geographyAllowed(settings, previous), {
    error: ISSUE.BODY_INVALID,
  })
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>
