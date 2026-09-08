import { z } from 'zod'
import { DomainError, ERROR, ISSUE } from './errors'
import { PATCH_EMPTY, changesSomething } from './patch'
import { visibleLine } from './text'

const reviewSchema = visibleLine(500)

/**
 * Keyed on the item, not on «item + place»: the same milk in every shop, only the price
 * differs. placeId is null for a product and filled for a dish in 0.3, so MOL-6 needs
 * UNIQUE NULLS NOT DISTINCT — without it two nulls count as different and let duplicates in.
 */
export const verdictSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    itemId: z.uuid(),
    placeId: z.uuid().nullable(),
    score: z.int().min(1).max(5),
    review: reviewSchema.nullable(),
    ratedAt: z.date(),
    updatedAt: z.date(),
  })
  .refine((verdict) => verdict.updatedAt >= verdict.ratedAt, {
    error: ISSUE.VERDICT_UPDATED_BEFORE_RATED,
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
    review: reviewSchema.nullable().optional(),
  })
  .refine(changesSomething, PATCH_EMPTY)
export type VerdictPatch = z.infer<typeof verdictPatchSchema>

export const VERDICT_LEVEL = {
  TAKE: 'take',
  IF_CHEAP: 'if_cheap',
  NEVER: 'never',
} as const
export type VerdictLevel = (typeof VERDICT_LEVEL)[keyof typeof VERDICT_LEVEL]

/**
 * Thresholds 4.0 and 2.5, both inclusive, compared as integers so an average in 0.3 never
 * puts a float in a product decision. A sum outside [count, 5*count] is a broken aggregate.
 */
export function verdictLevel(sum: number, count: number): VerdictLevel {
  const details = `${String(sum)}/${String(count)}`
  if (!Number.isSafeInteger(sum) || !Number.isSafeInteger(count)) {
    throw new DomainError(ERROR.INVALID_SCORE, details)
  }
  if (count <= 0) {
    throw new DomainError(ERROR.INVALID_SCORE, details)
  }
  if (sum < count || sum > 5 * count) {
    throw new DomainError(ERROR.INVALID_SCORE, details)
  }
  if (sum >= 4 * count) return VERDICT_LEVEL.TAKE
  if (2 * sum < 5 * count) return VERDICT_LEVEL.NEVER
  return VERDICT_LEVEL.IF_CHEAP
}
