import { z } from 'zod'
import { citySchema, countrySchema } from './geo'
import { visibleLine } from './text'

/** Same reason as an item's kind: the 0.3 gate is measured separately for the two. */
export const placeKindSchema = z.enum(['store', 'venue'])
export type PlaceKind = z.infer<typeof placeKindSchema>

const nameSchema = visibleLine(200)

/**
 * No currency here, deliberately. Money follows the person, not the shop: what someone
 * spends in comes from their own settings, and the country of a place is needed for the
 * key and for the city, not for the amounts.
 */
export const placeSchema = z.object({
  id: z.uuid(),
  kind: placeKindSchema,
  name: nameSchema,
  country: countrySchema,
  city: citySchema,
  createdAt: z.date(),
})
export type Place = z.infer<typeof placeSchema>

export const newPlaceSchema = z.strictObject({
  kind: placeKindSchema,
  name: nameSchema,
  country: countrySchema,
  city: citySchema,
})
export type NewPlace = z.infer<typeof newPlaceSchema>
