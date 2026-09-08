import { z } from 'zod'
import { DomainError, ERROR } from './errors'

const reviewSchema = z.string().trim().min(1).max(500)

/**
 * The rare half of the product, and the core of it. The key is the item, not the pair
 * «item + place»: «Ашхар» is the same milk in every shop, only the price differs, which
 * is why the «Что брать» card shows one badge over several places. It is also why a
 * verdict survives moving — ratings travel with the person, prices stay with the city.
 *
 * placeId is here all the same and is null for a product. A dish in 0.3 fills it in, and
 * no migration is needed. For MOL-6 that means UNIQUE NULLS NOT DISTINCT on the triple:
 * without it two nulls would count as different and let duplicates through.
 */
export const verdictSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  itemId: z.uuid(),
  placeId: z.uuid().nullable(),
  /** Whole. Not 3.5 and not a float: there is no half star on screen, and an average is computed above this. */
  score: z.int().min(1).max(5),
  /** One line of "why". Optional — a rating takes a second, a sentence does not always follow. */
  review: reviewSchema.nullable(),
  ratedAt: z.date(),
  /** Re-rating is ordinary: a different batch, a changed recipe. */
  updatedAt: z.date(),
})
export type Verdict = z.infer<typeof verdictSchema>

export const newVerdictSchema = z.strictObject({
  itemId: z.uuid(),
  placeId: z.uuid().optional(),
  score: z.int().min(1).max(5),
  review: reviewSchema.optional(),
})
export type NewVerdict = z.infer<typeof newVerdictSchema>

export const verdictPatchSchema = z
  .strictObject({
    score: z.int().min(1).max(5).optional(),
    /** null deletes the sentence and keeps the rating; absent leaves it alone. */
    review: reviewSchema.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'at least one field must be present',
  })
export type VerdictPatch = z.infer<typeof verdictPatchSchema>

export const VERDICT_LEVEL = {
  TAKE: 'take',
  IF_CHEAP: 'if_cheap',
  NEVER: 'never',
} as const
export type VerdictLevel = (typeof VERDICT_LEVEL)[keyof typeof VERDICT_LEVEL]

/**
 * What the card says about an item, from the ratings behind it.
 *
 * The thresholds 4.0 and 2.5 come from the handoff and both include their boundary. The
 * comparison is integer on purpose: in 0.1 count is 1, in 0.3 an average arrives, and a
 * float must not reach a product decision at any step — 2.5 is exactly the value a binary
 * float cannot be trusted to land on.
 */
export function verdictLevel(sum: number, count: number): VerdictLevel {
  if (!Number.isInteger(sum) || !Number.isInteger(count)) {
    throw new DomainError(ERROR.INVALID_SCORE, `${String(sum)}/${String(count)}`)
  }
  if (count <= 0) {
    throw new DomainError(ERROR.INVALID_SCORE, 'count must be positive')
  }
  if (sum >= 4 * count) return VERDICT_LEVEL.TAKE
  if (2 * sum < 5 * count) return VERDICT_LEVEL.NEVER
  return VERDICT_LEVEL.IF_CHEAP
}
