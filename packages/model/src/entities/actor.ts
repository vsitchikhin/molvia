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

/**
 * The four settings a person arrives with. No `id` here on purpose: the server issues it
 * (MOL-8, Р-1), so a client cannot name its own identifier — or someone else's. That
 * matters more here than anywhere: with no registration, the identifier *is* the proof of
 * identity. Strict for the reason the patch is strict: `createdAt` and `updatedAt`
 * belong to the server, and a shape that merely ignored them would accept the attempt.
 */
export const newActorSchema = z.strictObject({
  country: countrySchema,
  city: citySchema,
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
})
export type NewActor = z.infer<typeof newActorSchema>

const actorPatchFields = z.strictObject({
  country: countrySchema.optional(),
  city: citySchema.optional(),
  spendCurrency: currencySchema.optional(),
  incomeCurrency: currencySchema.optional(),
})

export const actorPatchSchema = actorPatchFields.refine(changesSomething, PATCH_EMPTY)
export type ActorPatch = z.infer<typeof actorPatchSchema>
