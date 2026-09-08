import { z } from 'zod'
import { currencySchema } from './money'

/** ISO 3166-1 alpha-2. The country is part of the key from the start, not "we'll add it later". */
export const countrySchema = z.string().regex(/^[A-Z]{2}$/)

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
  city: z.string().trim().min(1),
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
    city: z.string().trim().min(1).optional(),
    spendCurrency: currencySchema.optional(),
    incomeCurrency: currencySchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    // An empty patch is a bug on the caller's side, not a no-op worth committing: it would
    // still bump updatedAt and look like a change in any history built on that column.
    error: 'at least one field must be present',
  })
export type ActorPatch = z.infer<typeof actorPatchSchema>
