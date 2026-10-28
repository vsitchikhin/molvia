import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'

/**
 * A warning before the account is erased for two years of silence (MOL-239), as the API hands it to
 * the bot — already marked as given: whose chat, the day the account goes and how many days are left,
 * both in the person's zone. Nothing of the account: the message lies on Telegram's servers.
 */
export const silenceNoticeSchema = z.strictObject({
  telegramUserId: telegramUserIdSchema,
  day: z.iso.date(),
  days: z.int().min(1).max(31),
})
export type SilenceNotice = z.infer<typeof silenceNoticeSchema>

/** How many warnings one claim hands over; the rest wait for the next minute. */
export const SILENCE_NOTICES_PER_CLAIM = 50

/** `POST /internal/silence/claim`. */
export const dueSilenceNoticesSchema = z.strictObject({
  notices: z.array(silenceNoticeSchema).max(SILENCE_NOTICES_PER_CLAIM),
})
export type DueSilenceNotices = z.infer<typeof dueSilenceNoticesSchema>

/**
 * The owner hears of it in numbers (owner's В-3 «а»): warnings handed out by a claim, or accounts
 * erased by the day's run — the first sign of a clock gone wrong comes thirty days before any
 * erasure. No id and no name.
 */
export const silenceNoticeToOwnerSchema = z.strictObject({
  kind: z.literal('silence'),
  warned30: z.int().nonnegative(),
  warned7: z.int().nonnegative(),
  erased: z.int().nonnegative(),
  /** Of them, erased with no warning: the bot was blocked (the page's one exception). */
  erasedBlocked: z.int().nonnegative(),
})
export type SilenceNoticeToOwner = z.infer<typeof silenceNoticeToOwnerSchema>
