import { z } from 'zod'
import { citySchema, countrySchema } from '#model/values/geo'
import { currencySchema } from '#model/values/money'
import { PATCH_EMPTY, changesSomething } from '#model/support/patch'

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

const actorPatchFields = z.strictObject({
  country: countrySchema.optional(),
  city: citySchema.optional(),
  spendCurrency: currencySchema.optional(),
  incomeCurrency: currencySchema.optional(),
})

export const actorPatchSchema = actorPatchFields.refine(changesSomething, PATCH_EMPTY)
export type ActorPatch = z.infer<typeof actorPatchSchema>
