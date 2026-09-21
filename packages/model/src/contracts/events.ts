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
  /**
   * Someone opened «Что брать» and was shown other people's figures (MOL-31, Р-15). This is
   * the event the 0.3 gate counts, and it exists because `catalogue_viewed` could no longer
   * answer what that gate asks. The catalogue search wrote that one while nothing on any
   * screen came from anyone else, so «came back» meant «came back to enter a purchase»; from
   * the moment a screen shows other people's ratings, the two have to be different rows, and
   * an append-only log cannot be told apart afterwards.
   */
  ADVICE_VIEWED: 'advice_viewed',
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
  // The same axis, because the gate splits on it either way: products and venues are counted
  // apart, and «Что брать» shows one or the other.
  z.strictObject({
    type: z.literal(EVENT.ADVICE_VIEWED),
    payload: z.strictObject({ subject: catalogueSubjectSchema }),
  }),
])
export type EventInput = z.infer<typeof eventSchema>
export type EventPayload = Extract<EventInput, { payload: unknown }>['payload']
