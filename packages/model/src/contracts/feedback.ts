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

/** The name of the screen the sheet was opened over, without its query or parameters. */
const routeSchema = z.string().regex(/^[a-z][a-z-]{0,39}$/)

/** What the API last refused with, as the wire names it — `error.internal` (MOL-147, В-1). */
const errorCodeSchema = z.string().regex(/^(error|issue)\.[a-z_]{1,60}$/)

/**
 * The message as the sheet sends it. Everything beside the text is what the sheet shows under it
 * before sending — «Вместе с текстом: версия · экран · платформа» (MOL-150, Р-5, Р-7) — and nothing
 * else: no screen's content, no draft, no queue. The build of the API is not here: the API stamps
 * its own.
 *
 * `clientKey` is the phone's for this content (Р-2): the same key with the same message is the same
 * message, so a double tap or a lost answer sends the owner nothing twice (MOL-150, Р-4).
 */
export const feedbackBodySchema = z
  .strictObject({
    kind: feedbackKindSchema,
    text: visibleText(FEEDBACK_TEXT_MAX),
    locale: z.enum(LOCALES),
    pageBuild: buildSchema.nullable(),
    route: routeSchema,
    platform: feedbackPlatformSchema,
    fromError: z.boolean(),
    errorCode: errorCodeSchema.nullable(),
    clientKey: deviceIdSchema,
  })
  // A code is what an error screen knew; a message from the settings has none to carry.
  .refine(({ fromError, errorCode }) => fromError || errorCode === null, {
    error: ISSUE.BODY_INVALID,
    path: ['errorCode'],
  })
export type FeedbackBody = z.infer<typeof feedbackBodySchema>

/**
 * The number the message was written under — the `#fb42` the owner sees — for the same message sent
 * again too. The screen does not show it (MOL-150, Р-13).
 */
export const feedbackSentCodec = z.strictObject({ number: z.int().positive() })
export type FeedbackSent = z.infer<typeof feedbackSentCodec>
