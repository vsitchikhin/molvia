import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'
import { FAILURE_FRAMES } from '#model/support/failure'

/**
 * Where a failure came from (MOL-143). `phone` joins with MOL-144; the bot has no build of its own
 * and is rolled out from the same commit as the API, so its failures carry the API's.
 */
export const FAILURE_SOURCES = ['api', 'bot'] as const
export type FailureSource = (typeof FAILURE_SOURCES)[number]

/** The longest kind and driver code a failure keeps: a class name and a SQLSTATE fit with room. */
export const FAILURE_NAME_MAX = 64
/** The longest place of a failure: a route's template, a handler of the bot, a job. */
export const FAILURE_ROUTE_MAX = 200
/** The longest frame kept: a function and a path. */
export const FAILURE_FRAME_MAX = 300

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
/** A frame of the stack below its header, as `describeFailure` cuts it. */
export const failureFrameSchema = z.string().min(1).max(FAILURE_FRAME_MAX)

/**
 * What the bot says about a failure of its own (MOL-143, Р-5): its kind, never its content, and
 * which handler it was in — the kind of update and the prefix of its button or command, never the
 * update, `ctx.from` or a word of the message. The API fingerprints it and stamps the build.
 */
export const botFailureSchema = z.strictObject({
  errorName: failureNameSchema,
  code: failureCodeSchema.optional(),
  frames: z.array(failureFrameSchema).max(FAILURE_FRAMES).optional(),
  handler: z.string().regex(/^[a-z_]{1,32}(?::[a-z_]{1,32})?$/),
})
export type BotFailure = z.infer<typeof botFailureSchema>

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
 * One message the API has queued for the owner (MOL-143, Р-9 of MOL-149) and handed to the bot. A
 * union by `kind`, so the feedback of MOL-148 joins as one more branch rather than a second channel.
 */
export const ownerNoticeSchema = z.discriminatedUnion('kind', [
  failureNoticeSchema,
  failureCountNoticeSchema,
])
export type OwnerNotice = z.infer<typeof ownerNoticeSchema>
export type OwnerNoticeKind = OwnerNotice['kind']
export const OWNER_NOTICE_KINDS = [
  'failure',
  'failure_count',
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
