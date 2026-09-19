import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { newVerdictSchema, verdictFields, verdictPatchSchema } from '#model/entities/verdict'
import type { Verdict } from '#model/entities/verdict'

/**
 * The address of a verdict is the item it is about, not an id of its own (MOL-27, Р-2).
 * A product has one verdict per person, so the item names it; and the verdict screen keeps a
 * draft on the phone and sends it when the network is back — the client always knows the
 * item, while an id of the verdict would exist only after the first answer, leaving an edit
 * made offline right after rating with nowhere to go.
 */
export const verdictPathSchema = z.strictObject({
  itemId: z.uuid({ error: ISSUE.PATH_INVALID }),
})
export type VerdictPath = z.infer<typeof verdictPathSchema>

/**
 * The body of `PUT /verdicts/:itemId`. Strict: `itemId` is in the path, the owner is in the
 * header, and a place is refused until 0.3 — dishes are not in the catalogue before then, and
 * a field handled halfway is worse than a refusal (the same line «Предложить товар» draws).
 */
export const ratingSchema = newVerdictSchema.pick({ score: true, review: true })
export type Rating = z.infer<typeof ratingSchema>

/** The body of `PATCH /verdicts/:itemId`: `review: null` is the one way to erase the text. */
export const verdictAmendmentSchema = verdictPatchSchema
export type VerdictAmendment = z.infer<typeof verdictAmendmentSchema>

/**
 * What the wire shows of a verdict. An allowlist, like the catalogue entry: `actorId` is the
 * device identifier, which in 0.1 is the proof of identity (MOL-8) — handed back, it would be
 * one more place it leaks from. The id is not needed, the path is the item; the place is
 * always empty before 0.3. Picked from the fields: zod refuses `pick` on the refined schema.
 */
export const verdictCardSchema = verdictFields.pick({
  itemId: true,
  score: true,
  review: true,
  ratedAt: true,
  updatedAt: true,
})
export type VerdictCard = z.infer<typeof verdictCardSchema>

/** Strict on both ends: a reply that grew a field fails to parse instead of leaking past. */
export const verdictCardCodec = z.codec(
  z.strictObject({
    ...verdictCardSchema.shape,
    ratedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
  z.strictObject(verdictCardSchema.shape),
  {
    decode: (wire) => ({
      ...wire,
      ratedAt: new Date(wire.ratedAt),
      updatedAt: new Date(wire.updatedAt),
    }),
    encode: (card) => ({
      ...card,
      ratedAt: card.ratedAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    }),
  },
)

/** The one way a verdict becomes a card — by naming what goes, not what stays. */
export function verdictCardOf(verdict: Verdict): VerdictCard {
  return {
    itemId: verdict.itemId,
    score: verdict.score,
    review: verdict.review,
    ratedAt: verdict.ratedAt,
    updatedAt: verdict.updatedAt,
  }
}
