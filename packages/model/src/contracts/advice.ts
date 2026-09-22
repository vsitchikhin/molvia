import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { itemSchema } from '#model/entities/item'
import { placeSchema } from '#model/entities/place'
import { verdictFields } from '#model/entities/verdict'
import { unitPriceCodec } from '#model/values/units'

/**
 * Whose figures an answer carries (MOL-31, Р-11). One mode per answer rather than per row:
 * access is a property of the person asking, not of the item asked about, and a screen that
 * had to look at every row to learn whose numbers it shows would sooner or later show the
 * wrong word over the right number.
 *
 * Never sent by a client: the mode follows from `actors.shared_until` and nothing else, so a
 * request cannot ask to see other people's data.
 */
export const adviceScopeSchema = z.enum(['own', 'shared'])
export type AdviceScope = z.infer<typeof adviceScopeSchema>

/**
 * A place and the lowest unit price seen there for one item. `observations` is how many
 * purchases stand behind it — the same honesty the rating count carries: one purchase is a
 * number, not a history.
 */
export const advicePlaceSchema = z.strictObject({
  placeId: z.uuid(),
  name: placeSchema.shape.name,
  unitPrice: unitPriceCodec,
  observations: z.int().positive(),
})
export type AdvicePlace = z.output<typeof advicePlaceSchema>

/**
 * What every row carries whatever its verdict is.
 *
 * `rating` is a decimal string, not a number (Р-12): the same field holds one person's whole
 * score and an average over several, and «never float» has to hold for both. `ratingsCount`
 * says how much the figure is worth — one in the own mode, three or more in the shared one,
 * because below `AGGREGATE_MIN_CONTRIBUTIONS` an average gives away the other person's score.
 */
const ratedFields = {
  itemId: z.uuid(),
  name: itemSchema.shape.name,
  // The shape and the ceiling are two rules: `^[1-5]\.\d$` alone lets «5.1» through, which
  // is a number no scale of one to five has and which the screen would print as «5,1 из 5».
  rating: z
    .string()
    .regex(/^[1-5]\.\d$/)
    .refine((value) => Number(value) <= 5),
  ratingsCount: z.int().positive(),
  review: verdictFields.shape.review,
  /**
   * Whether this person has a verdict of their own behind the row (MOL-32, А2).
   *
   * In the own mode it is always true. In the shared one a row may be entirely other
   * people's, and **nothing else in the row says so**: `review` is empty there exactly as it
   * is on one's own verdict without one, and `ratingsCount` of three or more happens either
   * way. Without it the screen offered to amend an opinion the person had never given, and
   * every save came back 404 with «try again» — a refusal a repeat cannot fix.
   */
  isMine: z.boolean(),
}

/**
 * Three verdicts, three shapes of row — a discriminated union rather than one row with
 * optional fields (MOL-31, Р-8).
 *
 * «Не брать нигде» has no field for a price, a place or a threshold at all, so cheapness
 * cannot pull a bad item into a recommendation by an oversight in some later use case: the
 * type checker holds the product's core rule, the way `ScreenState` holds «offline is never
 * red». A row that grew a price fails to parse instead of reaching a screen.
 */
export const adviceRowSchema = z.discriminatedUnion('level', [
  z.strictObject({
    ...ratedFields,
    level: z.literal('take'),
    /**
     * The asker's own city first, then by ascending unit price (MOL-31, Р-26) — **not by
     * price alone**, and the difference is the screen's to carry: a cheaper receipt from
     * another city stands below a dearer place at home, because «cheaper elsewhere» is not
     * somewhere one can go. So the first place is not always the cheapest, and only a screen
     * that compares the prices may call it so (MOL-32, А1). Empty when the item was rated but
     * never bought.
     */
    places: z.array(advicePlaceSchema),
  }),
  z.strictObject({
    ...ratedFields,
    level: z.literal('if_cheap'),
    /** The asker's city first, then by price — as with «take» above. */
    places: z.array(advicePlaceSchema),
    /**
     * «Стоит брать дешевле …»: the lower median of the unit prices seen (MOL-31, Р-2, and
     * the answer to MOL-33). `null` while fewer than `PRICE_MEDIAN_MIN_OBSERVATIONS` stand
     * behind it — on two purchases a median is a number with nothing under it.
     */
    threshold: unitPriceCodec.nullable(),
  }),
  z.strictObject({ ...ratedFields, level: z.literal('never') }),
])
export type AdviceRow = z.output<typeof adviceRowSchema>

/**
 * How many purchases a threshold needs before it is shown (MOL-31, Р-2). Three, the same
 * number and the same reason as everywhere else in this project: with two, the median is
 * their mean and one odd price moves it as far as it likes.
 */
export const PRICE_MEDIAN_MIN_OBSERVATIONS = 3

/**
 * How many rows one answer carries. It bounds the answer, not the screen: in the own mode a
 * person has as many rows as they have ratings, and in the shared one the list is everything
 * anyone has rated (Р-14), so this stops being generous as soon as there are many people —
 * and that is when the screen needs a search of its own, not a bigger number here.
 */
export const ADVICE_LIMIT = 200

/**
 * How many of those rows are held for other people's «не брать нигде» (MOL-31, Р-25).
 *
 * Р-23 keeps this person's own rows and every warning from the cut, and it kept them in that
 * order: «own» ranked above «warning», so once someone had `ADVICE_LIMIT` rows of their own,
 * a stranger's warning was the first thing dropped — the one thing on the screen they could
 * not have learnt for themselves, and the thing they opened access for (adversarial round 2,
 * G2).
 *
 * A reserve rather than a reordering, because putting warnings first is worse than the
 * defect: in the shared mode there is no bound on how many of them exist, and measured on a
 * shelf of 250 the page came back as 200 warnings and not one recommendation. Twenty of two
 * hundred is a tenth — enough to carry the warnings a person actually meets, cheap enough
 * that it costs twenty of their own rows only when they have two hundred. Below that it
 * never binds: warnings reach the page on their rating like anything else.
 */
export const ADVICE_WARNINGS_RESERVED = 20

/**
 * `GET /advice`. An object rather than a bare list, so a field beside the rows does not break
 * a client, and `scope` is that field: it is the one thing the screen cannot work out itself.
 */
export const adviceResponseSchema = z
  .strictObject({
    scope: adviceScopeSchema,
    rows: z.array(adviceRowSchema).max(ADVICE_LIMIT),
    /**
     * How many rated items there are in all, so a truncated list can say so (MOL-31, Р-23).
     * Without it the screen could not tell a short list from a cut one, and the cut is not
     * hypothetical: in the shared mode the list is everything anyone has rated.
     */
    total: z.int().nonnegative(),
  })
  .refine((answer) => answer.total >= answer.rows.length, { error: ISSUE.RESPONSE_INVALID })
export type AdviceResponse = z.output<typeof adviceResponseSchema>
