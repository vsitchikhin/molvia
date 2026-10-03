import { z } from 'zod'
import { feedbackPlatformSchema, feedbackRouteSchema } from './feedback'
import { telegramUserIdSchema } from '#model/entities/actor'
import { FAILURE_FRAMES, PHONE_SCRIPT_PATH } from '#model/support/failure'

/**
 * Where a failure came from (MOL-143). The bot has no build of its own and is rolled out from the
 * same commit as the API, so its failures carry the API's; the phone names its own (MOL-144).
 */
export const FAILURE_SOURCES = ['api', 'bot', 'phone'] as const
export type FailureSource = (typeof FAILURE_SOURCES)[number]

/** The longest kind and driver code a failure keeps: a class name and a SQLSTATE fit with room. */
export const FAILURE_NAME_MAX = 64
/** The longest place of a failure: a route's template, a handler of the bot, a job. */
export const FAILURE_ROUTE_MAX = 200
/** The longest frame kept: a function and a path. */
export const FAILURE_FRAME_MAX = 300

/**
 * The longest frame a report may carry — longer than the kept one on purpose (adversarial Б2). The
 * API takes the fingerprint from the frame before it cuts it, so the position is stripped whole; cut
 * by the sender to the kept length first, `…index.js:48213:` reached the fingerprint and every build
 * made the failure new.
 */
export const FAILURE_WIRE_FRAME_MAX = 1000

/**
 * The counts in one build a known failure has to cross for the owner to hear of it again (MOL-143,
 * В-5): the first time says «it happened», these say «it keeps happening» — at most three more
 * messages a fingerprint a build, and silence while it does not grow.
 */
export const FAILURE_COUNT_NOTICES = [10, 100, 1000] as const

/** How long a failure is kept after it last happened (MOL-143). */
export const FAILURE_KEEP_DAYS = 30

/** A class name, as V8 and grammY name them — never a sentence. */
export const failureNameSchema = z
  .string()
  .regex(/^[\w$.-]+$/)
  .max(FAILURE_NAME_MAX)
/** A SQLSTATE or a driver's code, the shape `describeFailure` lets through. */
export const failureCodeSchema = z.string().regex(/^[\dA-Z_]{1,64}$/)
/** A frame of the stack below its header, as `describeFailure` cuts it, as kept. */
export const failureFrameSchema = z.string().min(1).max(FAILURE_FRAME_MAX)

/**
 * What the bot says about a failure of its own (MOL-143, Р-5): its kind, never its content, and
 * which handler it was in — the kind of update and the prefix of its button or command, never the
 * update, `ctx.from` or a word of the message. The API fingerprints it and stamps the build.
 */
export const botFailureSchema = z.strictObject({
  errorName: failureNameSchema,
  code: failureCodeSchema.optional(),
  frames: z.array(z.string().min(1).max(FAILURE_WIRE_FRAME_MAX)).max(FAILURE_FRAMES).optional(),
  handler: z.string().regex(/^[a-z_]{1,32}(?::[a-z_]{1,32})?$/),
})
export type BotFailure = z.infer<typeof botFailureSchema>

/**
 * Where on the phone a failure was caught (MOL-144, Р-3): Vue's handler, the window's `error` and
 * `unhandledrejection`, an error a screen showed, the barcode reader's worker, the service worker's
 * registration, and a step of the start that threw before the app was mounted (adversarial А4).
 */
export const PHONE_CATCHERS = [
  'vue',
  'window',
  'rejection',
  'screen',
  'scanner',
  'sw',
  'start',
] as const
export type PhoneCatcher = (typeof PHONE_CATCHERS)[number]

/**
 * The catchers that hear the whole page, another origin's script and an extension included: a
 * failure they hear is sent only with a frame of the app's own code (MOL-144, Р-2). The others are
 * the app's own by where they stand.
 */
export const PHONE_GLOBAL_CATCHERS: readonly PhoneCatcher[] = ['window', 'rejection']

/**
 * The screen a phone's failure happened on: a route's name (`feedbackRouteSchema`, which a test of
 * the router holds every name to), `login` behind the door of the login, `start` before the first
 * route is settled.
 */
export const phoneScreenSchema = feedbackRouteSchema

/**
 * The page's build (MOL-144, В-1): the name of its own script, `index-BTCsHrpw` — a hash of its
 * content, which changes exactly when the phone's code does — or `dev` on the development server.
 */
export const phoneBuildSchema = z.string().regex(/^(?:dev|index-[\w-]{4,24})$/)

/**
 * A frame as the phone sends it, one shape for every engine (`phoneFrame`, Р-1): an identifier or
 * `?`, and a path of the app's own origin with its line and column, or `?`. Nothing else passes — no
 * address of the page, no query, no word of text.
 */
export const phoneFrameSchema = z
  .string()
  .max(FAILURE_WIRE_FRAME_MAX)
  .regex(
    new RegExp(`^at [\\w$.<>[\\]/?]{1,100} \\((?:\\?|${PHONE_SCRIPT_PATH}:\\d{1,9}:\\d{1,9})\\)$`),
  )

/**
 * What the phone says about a failure of its own (MOL-144): its kind and frames, where it was
 * caught, on which screen, in which build and on what platform — never the message, a field, a
 * draft, the queue, storage or an answer of the API (the requirements, «не прикладывать»).
 */
export const phoneFailureSchema = z.strictObject({
  errorName: failureNameSchema,
  code: failureCodeSchema.optional(),
  /**
   * None where the browser gave none — a `DOMException` of a registration often has no frame — and
   * then not at all rather than an empty list.
   */
  frames: z.array(phoneFrameSchema).min(1).max(FAILURE_FRAMES).optional(),
  catcher: z.enum(PHONE_CATCHERS),
  screen: phoneScreenSchema,
  build: phoneBuildSchema,
  platform: feedbackPlatformSchema,
})
export type PhoneFailure = z.infer<typeof phoneFailureSchema>

/** How many failures the phone keeps until it can send them, and sends at once (MOL-144, Р-7). */
export const PHONE_FAILURES_KEPT = 20

/** The body of `POST /client-errors`: what the phone has kept, all of it at once. */
export const clientErrorsSchema = z.strictObject({
  reports: z.array(phoneFailureSchema).min(1).max(PHONE_FAILURES_KEPT),
})
export type ClientErrors = z.infer<typeof clientErrorsSchema>

/** What every notice about a failure names: where, what, and in which build. */
const failureFacts = {
  source: z.enum(FAILURE_SOURCES),
  errorName: failureNameSchema,
  code: failureCodeSchema.optional(),
  route: z.string().min(1).max(FAILURE_ROUTE_MAX).optional(),
  build: z
    .string()
    .min(1)
    .max(FAILURE_NAME_MAX * 2),
  /** The phone's platform, `ios 18 app` (MOL-144, В-2); none for the API and the bot. */
  platform: feedbackPlatformSchema.optional(),
}

/** A fingerprint seen for the first time in this build (MOL-143, В-2): the frame it was thrown at. */
export const failureNoticeSchema = z.strictObject({
  kind: z.literal('failure'),
  ...failureFacts,
  frame: failureFrameSchema.optional(),
  /** The first characters of the fingerprint, to find it in `make failures`. */
  fingerprint: z.string().regex(/^[\da-f]{6}$/),
})

/** A known fingerprint that reached 10, 100 or 1000 in this build (В-5). */
export const failureCountNoticeSchema = z.strictObject({
  kind: z.literal('failure_count'),
  ...failureFacts,
  count: z.literal(FAILURE_COUNT_NOTICES),
})

/**
 * The phone's notices held back past the hour's budget, told once the hour has room (MOL-144, review
 * №1, №7): how many, and that `make failures` has them. The table counts every one.
 */
export const failureMutedNoticeSchema = z.strictObject({
  kind: z.literal('failure_muted'),
  source: z.literal('phone'),
  count: z.int().positive(),
})

/**
 * One message the API has queued for the owner (MOL-143, Р-9 of MOL-149) and handed to the bot. A
 * union by `kind`, so the feedback of MOL-148 joins as one more branch rather than a second channel.
 */
export const ownerNoticeSchema = z.discriminatedUnion('kind', [
  failureNoticeSchema,
  failureCountNoticeSchema,
  failureMutedNoticeSchema,
])
export type OwnerNotice = z.infer<typeof ownerNoticeSchema>
export type OwnerNoticeKind = OwnerNotice['kind']
export const OWNER_NOTICE_KINDS = [
  'failure',
  'failure_count',
  'failure_muted',
] as const satisfies readonly OwnerNoticeKind[]

/** The most notices one claim hands over: a minute of them, sent one by one. */
export const OWNER_NOTICES_PER_CLAIM = 20

/**
 * What a claim hands the bot: whom to write — the owner's Telegram id, from the API's environment,
 * since the bot keeps no state — and what. `to` is `null` where no owner is set: every copy and the
 * end-to-end run, where nothing is ever queued either.
 */
export const ownerNoticesSchema = z.strictObject({
  to: telegramUserIdSchema.nullable(),
  notices: z.array(ownerNoticeSchema).max(OWNER_NOTICES_PER_CLAIM),
})
export type OwnerNotices = z.infer<typeof ownerNoticesSchema>
