import { z } from 'zod'
import { citySchema, countrySchema } from './geo'
import { currencySchema } from './money'
import { PATCH_EMPTY, changesSomething } from './patch'

/**
 * Whoever the records belong to. Identity and settings are one entity rather than two:
 * the relation is strictly one-to-one, settings are created with the person and cannot
 * exist without them. Splitting that is worth it only when the halves live under
 * different access rules or one of them is optional, and neither holds here.
 *
 * How a device comes by its id — and what happens when the device changes — is MOL-8.
 * The type exists here so that no table has to carry an actor_id pointing at nothing.
 */
export const actorSchema = z.object({
  id: z.uuid(),
  country: countrySchema,
  city: citySchema,
  /**
   * What the person spends in, defaulted from the country and changeable afterwards:
   * moving again is an ordinary scenario, not an exception. A trip copies this value
   * rather than pointing at it, so a move never rewrites the currency of past trips.
   */
  spendCurrency: currencySchema,
  /** What a trip total is converted into. Without it a conversion has no addressee. */
  incomeCurrency: currencySchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Actor = z.infer<typeof actorSchema>

/**
 * There is no newActor: the server creates one on first contact with defaults, and from
 * then on it is only edited. Strict, so a client cannot smuggle in an id or a timestamp.
 */
export const actorPatchSchema = z
  .strictObject({
    country: countrySchema.optional(),
    city: citySchema.optional(),
    spendCurrency: currencySchema.optional(),
    incomeCurrency: currencySchema.optional(),
  })
  .refine(changesSomething, PATCH_EMPTY)
export type ActorPatch = z.infer<typeof actorPatchSchema>
