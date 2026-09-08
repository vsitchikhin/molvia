import { z } from 'zod'
import { citySchema, countrySchema } from './geo'
import { currencySchema } from './money'
import { PATCH_EMPTY, changesSomething } from './patch'

export const actorSchema = z.object({
  id: z.uuid(),
  country: countrySchema,
  city: citySchema,
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Actor = z.infer<typeof actorSchema>

export const actorPatchSchema = z
  .strictObject({
    country: countrySchema.optional(),
    city: citySchema.optional(),
    spendCurrency: currencySchema.optional(),
    incomeCurrency: currencySchema.optional(),
  })
  .refine(changesSomething, PATCH_EMPTY)
export type ActorPatch = z.infer<typeof actorPatchSchema>
