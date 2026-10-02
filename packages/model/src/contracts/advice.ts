import { z } from 'zod'
import { settingsGeographySchema } from './settings'
import { ISSUE } from '#model/support/errors'
import { itemSchema } from '#model/entities/item'
import { placeSchema } from '#model/entities/place'
import { verdictFields } from '#model/entities/verdict'
import { isCalendarDay } from '#model/values/rates'
import { quantityCodec, unitPriceCodec } from '#model/values/units'

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
 * A place and what it charges for one item — its last unit price, not the lowest ever seen
 * (MOL-166): one's own last purchase there, or the lower median of each buyer's last. It does not
 * stand on `observations`, which is how many purchases there are in the place, in this currency
 * and unit — what the server weighs to choose one «currency + unit» per item (Р-4).
 */
export const advicePlaceSchema = z.strictObject({
  placeId: z.uuid(),
  name: placeSchema.shape.name,
  unitPrice: unitPriceCodec,
  observations: z.int().positive(),
})
export type AdvicePlace = z.output<typeof advicePlaceSchema>

// The shape and the ceiling are two rules: `^[1-5]\.\d$` alone lets «5.1» through, which is a
// number no scale of one to five has and which the screen would print as «5,1 из 5».
const ratingSchema = z
  .string()
  .regex(/^[1-5]\.\d$/)
  .refine((value) => Number(value) <= 5)

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
  rating: ratingSchema,
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
 * How long another person's last purchase in a place still says what the place charges (MOL-166,
 * the owner's decision on adversarial Б). Older, it is no longer counted towards a place opened by
 * other people: two who bought at a discount in August and never came back held the place at the
 * discount, while the one who still shops there saw today's price on the same screen. One's own
 * last purchase has no such window — it is what the sheet compares with, dated (MOL-166, В-1).
 */
export const SHARED_PRICE_FRESH_DAYS = 90

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
    geography: settingsGeographySchema,
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

/**
 * One item the search on «Что брать» found, and its row of «Что брать» — or `null`, «ещё не
 * оценивали» (MOL-128, В-1). The row is built by the same use case and to the same rules as the
 * list's: the mode, the threshold of three, no price on «не брать нигде». So an item nobody may
 * yet be shown a verdict for — a stranger's lone one below the threshold — reads as not rated,
 * exactly as the list leaves it out.
 *
 * Only the id and the name of the item: what a row and the verdict sheet need, an allowlist for
 * the reason `catalogueEntrySchema` is one.
 */
export const adviceFoundSchema = z
  .strictObject({
    itemId: z.uuid(),
    name: itemSchema.shape.name,
    advice: adviceRowSchema.nullable(),
  })
  .refine((found) => found.advice === null || found.advice.itemId === found.itemId, {
    error: ISSUE.RESPONSE_INVALID,
  })
export type AdviceFound = z.output<typeof adviceFoundSchema>

/**
 * `GET /advice/search?q=` (MOL-128, В-1). The catalogue searched the way «Что взяли?» searches
 * it — transliteration, typos, synonyms — and each item found answered with its advice by the
 * server, never glued to the list on the phone: the list is cut at `ADVICE_LIMIT`, and an item
 * past the cut would read «ещё не оценивали» over a verdict it has.
 *
 * In the order of the search; the screen lays the items out by group and keeps that order inside
 * each. `near` as the catalogue's answer has it (MOL-46). It records no visit: `GET /advice`
 * does, and the screen asks for it whenever it opens (В-2).
 */
export const adviceSearchResponseSchema = z.strictObject({
  scope: adviceScopeSchema,
  geography: settingsGeographySchema,
  near: z.boolean(),
  items: z.array(adviceFoundSchema),
})
export type AdviceSearchResponse = z.output<typeof adviceSearchResponseSchema>

/**
 * `GET /advice/prices` — «Тут дешевле» on the sheet of a purchase (MOL-92): the item, and the record
 * it is bought into. **The city is the record's, never the settings'** (Т-4): a Gyumri resident in an
 * Erevan shop compares with Erevan. A record the server holds is named by `trip`, and the server
 * reads the city off its place; a record still in the phone's queue the server has never seen, so
 * the phone names the country and the city its start carries. `except` is the purchase the sheet
 * amends, so a row is never compared with itself (Т-9).
 */
export const ownPricesQuerySchema = z.union([
  z.strictObject({ item: z.uuid(), trip: z.uuid(), except: z.uuid().optional() }),
  z.strictObject({
    item: z.uuid(),
    country: settingsGeographySchema.shape.country,
    city: settingsGeographySchema.shape.city,
    except: z.uuid().optional(),
  }),
])
export type OwnPricesQuery = z.output<typeof ownPricesQuerySchema>

/**
 * A place and the price **last** paid there for one item, by the person asking (MOL-92, В-3: «цены
 * в магазинах подниматься могут, а вот спускаются редко»). `day` is the day of that purchase — the
 * day of its record as the phone named it (MOL-121) — and what the sheet prints beside the price.
 * `observations` is how many purchases there are in the place, in this currency and unit.
 */
export const ownPlacePriceSchema = z.strictObject({
  placeId: z.uuid(),
  name: placeSchema.shape.name,
  unitPrice: unitPriceCodec,
  /**
   * How much that purchase was (adversarial Г′): the till rounds a sum to a dram, so the less was
   * bought the more the price per unit wobbles — the sheet allows for it when it says «как в …».
   */
  quantity: quantityCodec,
  day: z.string().refine(isCalendarDay, { error: ISSUE.RESPONSE_INVALID }),
  observations: z.int().positive(),
})
export type OwnPlacePrice = z.output<typeof ownPlacePriceSchema>

/**
 * At most so many other items of the same kind travel with an answer (MOL-92, В-9). Which one the
 * sheet names depends on the price typed, so the server cannot pick it; it sends the best rated
 * first, and the one the sheet would pick is among them unless a person has bought more than this
 * many rated kinds of one thing in one city.
 */
export const OWN_ALTERNATIVES_MAX = 20

/**
 * Another item of the same kind (`kindKey`, MOL-45, В-7) the person has bought in this city, with
 * their own rating of it — never an average, with access or without (adversarial Д). Only what they
 * rated and not «не брать нигде» comes:
 * «оценено лучше или так же» cannot be checked without a rating (Р-11).
 */
export const ownAlternativeSchema = z.strictObject({
  itemId: z.uuid(),
  name: itemSchema.shape.name,
  level: z.enum(['take', 'if_cheap']),
  rating: ratingSchema,
  places: z.array(ownPlacePriceSchema).min(1),
})
export type OwnAlternative = z.output<typeof ownAlternativeSchema>

const ownPricedFields = {
  itemId: z.uuid(),
  /** The person's own places in the record's city, cheapest last price first in each currency and unit. */
  places: z.array(ownPlacePriceSchema),
  alternatives: z.array(ownAlternativeSchema).max(OWN_ALTERNATIVES_MAX),
}

/**
 * The prices of `GET /advice/prices` (MOL-92): a union on the level of the person's own verdict,
 * as `adviceRowSchema` is on «Что брать». **«Не брать нигде» has no field for a price, a place or an
 * alternative** (Т-3): the product's core rule held by the type checker, not by the sheet. An item
 * not rated is `unrated` and still has its prices: the hint is the person's own history.
 */
export const ownPricesSchema = z.discriminatedUnion('level', [
  z.strictObject({ itemId: z.uuid(), level: z.literal('never') }),
  z.strictObject({ ...ownPricedFields, level: z.literal('take'), rating: ratingSchema }),
  z.strictObject({ ...ownPricedFields, level: z.literal('if_cheap'), rating: ratingSchema }),
  z.strictObject({ ...ownPricedFields, level: z.literal('unrated') }),
])
export type OwnPrices = z.output<typeof ownPricesSchema>

/**
 * The answer of `GET /advice/prices`: the prices, and the country and city they were counted in —
 * `null` for a record the person does not hold, whose answer is empty. The phone keeps the city a
 * record was answered in, so with no signal it knows which remembered answer is that record's.
 */
export const ownPricesResponseSchema = z.strictObject({
  where: settingsGeographySchema.nullable(),
  prices: ownPricesSchema,
})
export type OwnPricesResponse = z.output<typeof ownPricesResponseSchema>
