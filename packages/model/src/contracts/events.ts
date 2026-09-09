import { z } from 'zod'
import type { ItemKind } from '#model/entities/item'
import type { PlaceKind } from '#model/entities/place'

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

/**
 * The payload is tied to the type, not merely allowed alongside it. An optional subject
 * let `catalogue_viewed` be recorded without the axis the gate splits on, and the log is
 * append-only: one forgotten branch and the gate measures less than happened, silently
 * and with no way to backfill.
 */
export const eventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal(EVENT.SESSION_STARTED),
    payload: z.strictObject({}).optional(),
  }),
  z.strictObject({
    type: z.literal(EVENT.CATALOGUE_VIEWED),
    payload: z.strictObject({ subject: catalogueSubjectSchema }),
  }),
])
export type EventInput = z.infer<typeof eventSchema>
export type EventPayload = NonNullable<EventInput['payload']>

/**
 * Four kinds of thing can be looked at and the gate has two halves, so the mapping has to
 * be written down: whoever writes the gate query in 0.3 would otherwise decide it from
 * memory, and the answer changes whether the gate passes.
 */
export const SUBJECT_OF_ITEM: Record<ItemKind, CatalogueSubject> = {
  product: 'product',
  dish: 'venue',
}

export const SUBJECT_OF_PLACE: Record<PlaceKind, CatalogueSubject> = {
  store: 'product',
  venue: 'venue',
}
