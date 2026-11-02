import { z } from 'zod'

/**
 * The 0.3 threshold is measured separately for products and venues, so the subject is not
 * optional detail — it is the axis the whole gate splits on.
 */
export const catalogueSubjectSchema = z.enum(['product', 'venue'])
export type CatalogueSubject = z.infer<typeof catalogueSubjectSchema>

/**
 * Gate 0.2 asks whether strangers fill the base: the share of people who gave this many
 * verdicts within `GATE_RATINGS_WINDOW_HOURS` of appearing. Stop below 20%.
 */
export const GATE_RATINGS = 5

/**
 * Two weeks, in hours rather than days, for the reason gate 0.3 counts its weeks in hours: a
 * calendar day is 23 or 25 hours across a daylight-saving change, and depends on a `timezone`
 * someone may set later.
 */
export const GATE_RATINGS_WINDOW_HOURS = 14 * 24

/**
 * The stop lines of the gates table in `CLAUDE.md`: gate 0.2 stops below this share of people
 * reaching `GATE_RATINGS`, gate 0.3 below this share coming back in their fourth week — each half
 * of it on its own. Percent, since that is how the plan states them and how they are printed.
 */
export const GATE_RATINGS_STOP_PERCENT = 20
export const GATE_RETURN_STOP_PERCENT = 15

/**
 * The login's line (MOL-68, owner's decision В-2, 29.09.2026): when this share of the people who
 * began a login through the bot never came in, a second way in is filed — an e-mail code typed in
 * the same window, beside the bot and never instead of it. A trigger rather than a stop: the plan's
 * risk «Вход только через Telegram» leaves the number to MOL-68, and the gates print it the same way,
 * beside its `n` and with no verdict.
 */
export const LOGIN_SECOND_WAY_PERCENT = 25

/**
 * The receipt scanner's line (MOL-222, owner's decision 04.10.2026, epic MOL-113): when after four weeks
 * people put right more than this share of the lines read, the question of the reader comes back — a
 * cloud or a video card, each a decision of its own. A third, printed in percent like the others,
 * beside its `n` and with no verdict.
 */
export const RECEIPT_EDITS_STOP_PERCENT = 33.3

/**
 * The measure of the search's memory (MOL-330, the threshold of MOL-47's В-1): `REMEMBERED_PREFIX` is measured
 * again only once this many different pairs «query → item taken» stand among people who accepted
 * `PICKS_CONSENT_EDITION` — fewer, and one person's habit decides the constant. A trigger, not a stop: printed
 * beside its `n` under the gates, and not reached by the day gate 0.2 is decided, the task closes with «nothing to
 * measure» (owner's В-2 «а»).
 */
export const PICKS_MEASURE_MIN_PAIRS = 70

/**
 * How many of one person's pairs count towards `PICKS_MEASURE_MIN_PAIRS` (MOL-330, owner's В-1 «а» of review 1): ten,
 * so seventy means seven people at least — a contribution is a person, not a row, and sixty pairs of one newcomer and
 * one each of nine others are nineteen, not sixty-nine.
 */
export const PICKS_MEASURE_PER_PERSON = 10
