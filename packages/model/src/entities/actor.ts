import { z } from 'zod'
import { citySchema, countrySchema } from '#model/values/geo'
import { currencySchema } from '#model/values/money'
import { PATCH_EMPTY, changesSomething } from '#model/support/patch'

/**
 * The external identity a person comes back by (MOL-52). A `number` rather than a `bigint`,
 * and the line is worth drawing: Telegram documents its user ids as fitting in 52 bits, so
 * `Number` and JSON both carry them whole. Money is `bigint` because minor units have no
 * ceiling anyone promised; here the ceiling was named by the system that issues the value.
 *
 * `z.int()` already refuses anything outside the safe range; the bound is written out anyway,
 * because it is the same bound the database CHECK holds, and a reader should find one number
 * in both places rather than a rule in one and a habit in the other.
 */
export const telegramUserIdSchema = z.int().positive().max(Number.MAX_SAFE_INTEGER)
export type TelegramUserId = z.infer<typeof telegramUserIdSchema>

export const actorSchema = z.object({
  id: z.uuid(),
  /** Never leaves the server: `actorWireSchema` takes it back off. */
  telegramUserId: telegramUserIdSchema,
  country: countrySchema,
  city: citySchema,
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  /**
   * Until when other people's data is visible to this person (MOL-31, Р-9). Absent from
   * `newActorSchema` and `actorPatchSchema` on purpose: access is granted, never requested,
   * and a field a client could send would be the release's one paywall with no wall.
   */
  sharedUntil: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Actor = z.infer<typeof actorSchema>

/**
 * Whether this person sees other people's ratings right now (MOL-31, Р-9). Empty and a past
 * date are the same answer, and the boundary is exactly «now»: a grant that ran out this
 * second is over. `now` is passed rather than read, so a use case and its test agree on when
 * they are.
 */
export function hasSharedAccess(actor: Pick<Actor, 'sharedUntil'>, now: Date): boolean {
  return actor.sharedUntil !== null && actor.sharedUntil > now
}

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
