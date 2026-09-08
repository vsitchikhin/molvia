import { z } from 'zod'
import { citySchema, countrySchema } from '#model/values/geo'
import { visibleLine } from '#model/support/text'

// 'venue' for the same reason as an item's 'dish': the 0.3 gate is measured separately.
export const placeKindSchema = z.enum(['store', 'venue'])
export type PlaceKind = z.infer<typeof placeKindSchema>

const nameSchema = visibleLine(200)

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
