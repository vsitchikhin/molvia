import { z } from 'zod'
import { catalogueSubjectSchema } from '#model/values/gate'

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
 * The payload is tied to the type, not merely allowed alongside it. An optional subject
 * let `catalogue_viewed` be recorded without the axis the gate splits on, and the log is
 * append-only: one forgotten branch and the gate measures less than happened, silently
 * and with no way to backfill.
 */
export const eventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(EVENT.SESSION_STARTED) }),
  z.strictObject({
    type: z.literal(EVENT.CATALOGUE_VIEWED),
    payload: z.strictObject({ subject: catalogueSubjectSchema }),
  }),
])
export type EventInput = z.infer<typeof eventSchema>
export type EventPayload = Extract<EventInput, { payload: unknown }>['payload']
