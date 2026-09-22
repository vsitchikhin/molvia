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

export const settingsUpdateSchema = z
  .strictObject({
    previous: actorSettingsSchema,
    settings: actorSettingsSchema,
  })
  .refine(
    ({ previous, settings }) =>
      (settings.country === previous.country && settings.city === previous.city) ||
      (settings.country === 'AM' && SETTINGS_CITIES.some((city) => city === settings.city)),
    { error: ISSUE.BODY_INVALID },
  )
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>
