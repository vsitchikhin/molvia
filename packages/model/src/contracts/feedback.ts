import { z } from 'zod'
import { deviceIdSchema } from './trip'
import { telegramUserIdSchema } from '#model/entities/actor'
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

/**
 * The owner's reply, as long as it may be (MOL-150, Р-2): it goes to the person inside a frame, and
 * the whole must fit one Telegram message of 4096.
 */
export const FEEDBACK_REPLY_MAX = 3500

/**
 * How much of the owner's reply a «Продолжение #fb42» quotes (MOL-148, Р-10): a reply of 3500 and a
 * continuation of 2000 do not fit one Telegram message together.
 */
export const FEEDBACK_QUOTE_MAX = 200

/** The start of the owner's reply a continuation quotes, cut by characters, never a pair in half. */
export function feedbackQuote(reply: string): string {
  const characters = Array.from(reply)
  return characters.length <= FEEDBACK_QUOTE_MAX
    ? reply
    : `${characters.slice(0, FEEDBACK_QUOTE_MAX).join('')}…`
}

/** The number of a thread — its first message's — as the owner's notices tag it: `#fb42`. */
const threadNumberSchema = z.int().positive()

/**
 * A message from the app, told to the owner (MOL-148, Р-9 of MOL-150): the kind, the text, everything
 * that went with it, when, and the thread's tag. Nothing of the person — no Telegram id, no name, no
 * `actor_id`: the copy stays in the owner's chat for good (В-3).
 */
export const feedbackNoticeSchema = z.strictObject({
  kind: z.literal('feedback'),
  thread: threadNumberSchema,
  feedbackKind: feedbackKindSchema,
  text: z.string().min(1).max(FEEDBACK_TEXT_MAX),
  locale: z.enum(LOCALES),
  pageBuild: buildSchema.nullable(),
  apiBuild: buildSchema,
  route: feedbackRouteSchema.nullable(),
  platform: feedbackPlatformSchema.nullable(),
  fromError: z.boolean(),
  errorCode: feedbackErrorCodeSchema.nullable(),
  at: z.iso.datetime(),
})
export type FeedbackNotice = z.infer<typeof feedbackNoticeSchema>

/**
 * A person's answer to the owner's reply, told to the owner (MOL-148, В-1 of MOL-150): the same tag,
 * so the hashtag shows the whole thread, and the start of the reply it answers.
 */
export const feedbackContinuedNoticeSchema = z.strictObject({
  kind: z.literal('feedback_continued'),
  thread: threadNumberSchema,
  quote: z
    .string()
    .min(1)
    .max(FEEDBACK_QUOTE_MAX + 1),
  text: z.string().min(1).max(FEEDBACK_TEXT_MAX),
  at: z.iso.datetime(),
})
export type FeedbackContinuedNotice = z.infer<typeof feedbackContinuedNoticeSchema>

/** Telegram's own bound on a message's text: what the bot can be handed at all. */
export const TELEGRAM_TEXT_MAX = 4096

/** A message's id in one Telegram chat — counted per chat, so never an identity alone. */
export const telegramMessageIdSchema = z.int().positive().max(Number.MAX_SAFE_INTEGER)

/**
 * A text written to the bot as a reply to one of its own messages (MOL-148, Р-2): who wrote it —
 * `ctx.from.id`, never anything in the text — the message's id, the bot's message it answers, the
 * tag that message's first line carries, if any, and the text as typed. **What it is, the API
 * decides**: the owner's reply on a notice, a person's word on a reply they got, or nothing of ours.
 * How long it may be depends on which, so the bound here is only Telegram's.
 */
export const feedbackFromBotSchema = z.strictObject({
  telegramUserId: telegramUserIdSchema,
  messageId: telegramMessageIdSchema,
  repliedMessageId: telegramMessageIdSchema,
  thread: threadNumberSchema.nullable(),
  text: z.string().min(1).max(TELEGRAM_TEXT_MAX),
})
export type FeedbackFromBot = z.infer<typeof feedbackFromBotSchema>

/**
 * What a text written to the bot came to (MOL-148, Р-2, Р-11). `answered` — the owner's reply is
 * written, and the bot sends it to `to` in the person's `locale`, saying the `day` of the message it
 * answers in their zone; `continued` — a person's word joined their thread; `gone` — the owner's tag
 * names a thread no longer there; `too_long` and `invisible` — nothing written, the text is the
 * writer's to fix; `limited` — the person's day of messages is spent, the form's limit and this one
 * being one. A text that is nothing of ours is a `404`, and the bot lets it on to the greeting.
 */
export const feedbackFromBotAnswerSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('answered'),
    reply: z.int().positive(),
    to: telegramUserIdSchema,
    locale: z.enum(LOCALES),
    day: z.iso.date(),
  }),
  z.strictObject({ outcome: z.literal('continued') }),
  z.strictObject({ outcome: z.literal('gone'), thread: threadNumberSchema }),
  z.strictObject({ outcome: z.literal('too_long'), max: z.int().positive() }),
  z.strictObject({ outcome: z.literal('invisible') }),
  z.strictObject({ outcome: z.literal('limited') }),
])
export type FeedbackFromBotAnswer = z.infer<typeof feedbackFromBotAnswerSchema>

/**
 * What became of the owner's reply once the bot tried to send it (MOL-148, Р-4): `sent` with the
 * message it went out as in the person's chat — their answer to it finds the thread by that (В-2) —
 * or `blocked`. The bot's word, after the send; a mark lost leaves the reply «unknown».
 */
export const replyDeliveredSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    reply: z.int().positive(),
    outcome: z.literal('sent'),
    messageId: telegramMessageIdSchema,
  }),
  z.strictObject({ reply: z.int().positive(), outcome: z.literal('blocked') }),
])
export type ReplyDelivered = z.infer<typeof replyDeliveredSchema>
