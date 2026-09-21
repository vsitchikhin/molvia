import { z } from 'zod'
import { decimalFromScaled, divideRounded } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import type { ItemKind } from './item'
import { PATCH_EMPTY, changesSomething } from '#model/support/patch'
import { visibleText } from '#model/support/text'

// A textarea on the screen, so a review may run to more than one line (MOL-27).
const reviewSchema = visibleText(500)

/**
 * Keyed on the item, not on «item + place»: the same milk in every shop, only the price
 * differs. placeId is null for a product and filled for a dish in 0.3, so MOL-6 needs
 * UNIQUE NULLS NOT DISTINCT — without it two nulls count as different and let duplicates in.
 */
export const verdictFields = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  itemId: z.uuid(),
  placeId: z.uuid().nullable(),
  score: z.int().min(1).max(5),
  review: reviewSchema.nullable(),
  ratedAt: z.date(),
  updatedAt: z.date(),
})

export const verdictSchema = verdictFields.refine(
  (verdict) => verdict.updatedAt >= verdict.ratedAt,
  {
    error: ISSUE.VERDICT_UPDATED_BEFORE_RATED,
  },
)
export type Verdict = z.infer<typeof verdictSchema>

/**
 * Shape only: whether a place belongs here depends on the kind of the item, which is not in
 * the input and cannot be — the client must not be the one to say it. A use case that has
 * loaded the item parses with `newVerdictSchemaFor(kind)` instead; this schema alone will
 * take both shapes, and the database will then refuse one of them.
 */
export const newVerdictSchema = z.strictObject({
  itemId: z.uuid(),
  placeId: z.uuid().optional(),
  score: z.int().min(1).max(5),
  review: reviewSchema.optional(),
})
export type NewVerdict = z.infer<typeof newVerdictSchema>

const verdictPatchFields = z.strictObject({
  score: z.int().min(1).max(5).optional(),
  review: reviewSchema.nullable().optional(),
})

export const verdictPatchSchema = verdictPatchFields.refine(changesSomething, PATCH_EMPTY)
export type VerdictPatch = z.infer<typeof verdictPatchSchema>

/**
 * A product is rated as itself — the same milk in every shop, only the price differs — and
 * a dish only where it is served. Two verdicts of one person on one product, one with a
 * place and one without, are one opinion counted twice, and the uniqueness cannot see it:
 * the rows differ in `place_id`.
 *
 * The database holds this since MOL-6; the rule lives here because the input alone cannot
 * answer it — the kind belongs to the item, not to the verdict — and a use case that loads
 * the item has to refuse before the insert does, or a form error arrives as a 500.
 */
export function placeMatchesKind(kind: ItemKind, placeId: string | null): boolean {
  return (kind === 'product') === (placeId === null)
}

/** The input schema of a verdict, once the kind of the item it points at is known. */
export function newVerdictSchemaFor(kind: ItemKind): z.ZodType<NewVerdict> {
  return newVerdictSchema.refine((input) => placeMatchesKind(kind, input.placeId ?? null), {
    error: ISSUE.VERDICT_PLACE_NOT_FOR_KIND,
    path: ['placeId'],
  })
}

export const VERDICT_LEVEL = {
  TAKE: 'take',
  IF_CHEAP: 'if_cheap',
  NEVER: 'never',
} as const
export type VerdictLevel = (typeof VERDICT_LEVEL)[keyof typeof VERDICT_LEVEL]

/**
 * The scale in tenths, which is the number the screen prints and therefore the number the
 * groups are decided by (MOL-31, Р-22). «Брать» from 4.0, «не брать нигде» below 2.5, both
 * boundaries inclusive on the side they name.
 *
 * Deciding on the exact fraction instead put «4,0 из 5» in «только если дёшево»: 79 over 20
 * is 3.95, which prints as «4.0» and grouped one floor below, and two rows with the same
 * number stood in different groups with nothing to explain it (adversarial round 1, F6).
 * The person reasons with the printed number, so the printed number decides.
 */
export const TAKE_FROM_TENTHS = 40
export const NEVER_BELOW_TENTHS = 25

/** The average in tenths, rounded half away from zero — exactly what `averageScore` prints. */
function tenthsOf(sum: number, count: number): number {
  const details = `${String(sum)}/${String(count)}`
  if (!Number.isSafeInteger(sum) || !Number.isSafeInteger(count) || count <= 0) {
    throw new DomainError(ERROR.INVALID_SCORE, details)
  }
  // A sum outside [count, 5*count] is a broken aggregate — a join that multiplied rows, a
  // NULL counted as zero — and it used to come back as a confident verdict instead of an error.
  if (sum < count || sum > 5 * count) {
    throw new DomainError(ERROR.INVALID_SCORE, details)
  }
  return Number(divideRounded(BigInt(sum) * 10n, BigInt(count)))
}

/**
 * Which of the three groups an item falls into, from the sum of its scores and how many
 * people gave them. Integers throughout, so a product decision never rests on how two
 * doubles compare.
 */
export function verdictLevel(sum: number, count: number): VerdictLevel {
  const tenths = tenthsOf(sum, count)
  if (tenths >= TAKE_FROM_TENTHS) return VERDICT_LEVEL.TAKE
  if (tenths < NEVER_BELOW_TENTHS) return VERDICT_LEVEL.NEVER
  return VERDICT_LEVEL.IF_CHEAP
}

/**
 * How many people must have rated an item before their average may be shown (MOL-31, Р-13).
 *
 * Three, not two, and the reason is arithmetic rather than taste: with two, whoever knows
 * their own score gets the other one by subtraction — «4,5 из 5 · 2 оценки» beside a five of
 * one's own is a four someone never shared. The same number, for the same kind of reason, as
 * `RATE_JUMP_MIN_HISTORY`: below it there is no judgement to make.
 *
 * A contribution is a person, not a row: three purchases by one person are one contribution.
 */
export const AGGREGATE_MIN_CONTRIBUTIONS = 3

/**
 * The average of `sum` scores over `count` of them, as a decimal with one tenth — «5.0»,
 * «4.3». A string rather than a number on purpose (MOL-31, Р-12): the same field carries one
 * person's own whole score and an average over many, and «never float» holds for both. Rounded
 * half away from zero, the way every other ratio in this package is.
 */
export function averageScore(sum: number, count: number): `${number}` {
  return decimalFromScaled(BigInt(tenthsOf(sum, count)), 1)
}
