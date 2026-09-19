import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { itemSchema } from '#model/entities/item'
import { placeSchema } from '#model/entities/place'
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
  // Lower case only, the spelling every identifier leaves this server in. `z.uuid()` and
  // Postgres take either case, so an upper-case address was rated and answered with a card
  // whose `itemId` was not the one sent — and a draft kept under the id it was sent with
  // would no longer match its own reply (adversarial pass, Д). One resource, one address.
  itemId: z.uuid({ error: ISSUE.PATH_INVALID }).regex(/^[\da-f-]+$/, { error: ISSUE.PATH_INVALID }),
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

/**
 * An item bought and not rated yet — one card of «Оценки» (MOL-28). One per item, not per
 * purchase: a product has one verdict per person, so three purchases of the milk are one
 * question, asked with the place and the day of the latest, the one best remembered. No price,
 * no expense id: the screen has neither, and the two streams stay apart.
 */
export const pendingVerdictSchema = z.strictObject({
  itemId: z.uuid(),
  name: itemSchema.shape.name,
  placeName: placeSchema.shape.name,
  boughtAt: z.date(),
})
export type PendingVerdict = z.infer<typeof pendingVerdictSchema>

/** One card on the wire — and in the phone's own storage, where a draft keeps it (MOL-28). */
export const pendingVerdictCodec = z.codec(
  z.strictObject({ ...pendingVerdictSchema.shape, boughtAt: z.iso.datetime() }),
  pendingVerdictSchema,
  {
    decode: (wire) => ({ ...wire, boughtAt: new Date(wire.boughtAt) }),
    encode: (card) => ({ ...card, boughtAt: card.boughtAt.toISOString() }),
  },
)

/** How many items one answer carries. The screen shows one card at a time. */
export const PENDING_VERDICTS_LIMIT = 50

/**
 * `GET /verdicts/pending`. `total` is how many items wait, the list only the first of them —
 * the counter under the title must not stop at the length of a page.
 */
export const pendingVerdictsCodec = z
  .strictObject({
    items: z.array(pendingVerdictCodec).max(PENDING_VERDICTS_LIMIT),
    total: z.int().nonnegative(),
  })
  .refine((answer) => answer.total >= answer.items.length, { error: ISSUE.RESPONSE_INVALID })
export type PendingVerdicts = z.output<typeof pendingVerdictsCodec>
