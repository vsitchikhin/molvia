import { z } from 'zod'
import { countrySchema, citySchema } from '#model/values/geo'
import { currencySchema } from '#model/values/money'
import { ISSUE } from '#model/support/errors'

export const SETTINGS_CITIES = ['Гюмри', 'Ереван'] as const

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

export function geographyKey(value: Pick<ActorSettings, 'country' | 'city'>): string {
  return JSON.stringify([value.country, value.city])
}

/**
 * Whether a geography may be written down at all: one of today's two cities, or exactly the
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
    (value.country === 'AM' && SETTINGS_CITIES.some((city) => city === value.city))
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
