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
