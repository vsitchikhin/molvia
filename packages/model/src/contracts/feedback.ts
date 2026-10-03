import { z } from 'zod'
import { deviceIdSchema } from './trip'
import { ISSUE } from '#model/support/errors'
import { LOCALES } from '#model/support/locale'
import { visibleText } from '#model/support/text'

/**
 * «Написать разработчику» (MOL-147): a message to the one person who builds the app. Not a review
 * of an item — `verdicts.review` is that — so it feeds no aggregate, no «Что брать» and no event.
 */
export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const
export const feedbackKindSchema = z.enum(FEEDBACK_KINDS)
export type FeedbackKind = z.infer<typeof feedbackKindSchema>

export const FEEDBACK_TEXT_MAX = 2000

/**
 * At most this many messages a person sends in a rolling day (MOL-150, Р-3): no friend writes
 * more, and a script holding a session sends the owner no more than ten.
 */
export const FEEDBACK_DAY_LIMIT = 10

/** A thread lives this long after its last message, the person's or the owner's (MOL-150, В-4). */
export const FEEDBACK_KEPT_YEARS = 1

/**
 * What became of the owner's reply (MOL-150, Р-11): reached the person, or the bot was blocked.
 * Empty is «unknown» — the bot stopped between the send and the mark. A message gone has no reply to
 * mark: the bot is told so before anything is written (MOL-148, Р-4).
 */
export const FEEDBACK_DELIVERY = ['sent', 'blocked'] as const
export type FeedbackDelivery = (typeof FEEDBACK_DELIVERY)[number]

export const FEEDBACK_SYSTEMS = [
  'ios',
  'ipados',
  'android',
  'macos',
  'windows',
  'linux',
  'other',
] as const

/**
 * The platform as one short line the domain can check — `ios 18 app`, `android 15 browser`,
 * `macos browser` — never the User-Agent (MOL-147, Р-4). The system from a short list, its major
 * version when the platform shows one, and whether the app was opened from the home screen. A
 * line of any other shape is refused, so the phone cannot attach more than the sheet says it does.
 */
export const feedbackPlatformSchema = z
  .string()
  .regex(new RegExp(`^(${FEEDBACK_SYSTEMS.join('|')})( [1-9][0-9]{0,2})? (app|browser)$`))

/** A build as `/health` names it — `v0.1.3-20-gd90f9cee` — or a copy's own name. */
const buildSchema = z.string().regex(/^[0-9A-Za-z._+-]{1,64}$/)

/**
 * The name of the screen the sheet was opened over, without its query or parameters. Every route
 * the app names must fit it — a test of the router holds that — or the sheet could send nothing from
 * that screen at all (MOL-147, review №5).
 */
export const feedbackRouteSchema = z.string().regex(/^[a-z][a-z-]{0,39}$/)

/**
 * What the API last refused with, as the wire names it — `error.internal` (MOL-147, В-1). Every code
 * of the registry fits it; a test holds that, for the same reason as the routes.
 */
export const feedbackErrorCodeSchema = z.string().regex(/^(error|issue)\.[a-z_]{1,60}$/)

/** What goes with the text — everything the sheet shows under it — before the code's rule. */
const attachedShape = {
  locale: z.enum(LOCALES),
  pageBuild: buildSchema.nullable(),
  route: feedbackRouteSchema,
  platform: feedbackPlatformSchema,
  fromError: z.boolean(),
  errorCode: feedbackErrorCodeSchema.nullable(),
}

// A code is what an error screen knew; a message from the settings has none to carry.
function codeFromError({ fromError, errorCode }: { fromError: boolean; errorCode: string | null }) {
  return fromError || errorCode === null
}
const codeRefused = { error: ISSUE.BODY_INVALID, path: ['errorCode'] }

/**
 * The message as the sheet sends it. Everything beside the text is what the sheet shows under it
 * before sending — «Вместе с текстом: версия · экран · язык · платформа» (MOL-150, Р-5, Р-7) — and
 * nothing else: no screen's content, no draft, no queue. The build of the API is not here: the API
 * stamps its own.
 *
 * `clientKey` is the phone's for this content (Р-2): the same key with the same message is the same
 * message, so a double tap or a lost answer sends the owner nothing twice (MOL-150, Р-4).
 */
export const feedbackBodySchema = z
  .strictObject({
    kind: feedbackKindSchema,
    text: visibleText(FEEDBACK_TEXT_MAX),
    ...attachedShape,
    clientKey: deviceIdSchema,
  })
  .refine(codeFromError, codeRefused)

/**
 * What went with a text under its key, as the phone keeps it beside the draft until the content
 * changes (MOL-147, adversarial В1): sent again, the message is the same one to the last field.
 */
export const feedbackAttachedSchema = z
  .strictObject(attachedShape)
  .refine(codeFromError, codeRefused)
export type FeedbackAttached = z.infer<typeof feedbackAttachedSchema>
export type FeedbackBody = z.infer<typeof feedbackBodySchema>

/**
 * The number the message was written under — the `#fb42` the owner sees — for the same message sent
 * again too. The screen does not show it (MOL-150, Р-13).
 */
export const feedbackSentCodec = z.strictObject({ number: z.int().positive() })
export type FeedbackSent = z.infer<typeof feedbackSentCodec>
