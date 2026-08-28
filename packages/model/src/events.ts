import { z } from 'zod'

/**
 * Events exist for one reason: the gates. Both thresholds ask about behaviour that leaves
 * no trace in any domain table — whether someone came back, and to look at what — so it
 * has to be recorded on purpose or the gates cannot be measured and stop being gates.
 *
 * Everything a domain table already answers is deliberately absent. The 0.2 threshold
 * ("reached five verdicts in two weeks") is a query over verdicts, not an event.
 */
export const EVENT = {
  SESSION_STARTED: 'session_started',
  CATALOGUE_VIEWED: 'catalogue_viewed',
} as const

export type EventType = (typeof EVENT)[keyof typeof EVENT]

export const eventTypeSchema = z.enum(EVENT)

/**
 * The 0.3 threshold is measured separately for products and venues, so the subject is not
 * optional detail — it is the axis the whole gate splits on.
 */
export const catalogueSubjectSchema = z.enum(['product', 'venue'])
export type CatalogueSubject = z.infer<typeof catalogueSubjectSchema>

export const eventPayloadSchema = z.object({
  subject: catalogueSubjectSchema.optional(),
})
export type EventPayload = z.infer<typeof eventPayloadSchema>
