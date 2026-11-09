import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'
import { deviceNameSchema } from '#model/entities/session'
import { localClock } from '#model/entities/reminder'
import { personZoneOf } from '#model/values/geo'

/**
 * «В ваш аккаунт вошло новое устройство» (MOL-361, audit MOL-287 Ф-3) as the API hands it to the bot —
 * marked as handed: whose chat, which session the button ends, the device as the browser
 * named itself, and when, in the account's own zone. Nothing else of the account: the message lies on
 * Telegram's servers.
 */
export const loginNoticeSchema = z.strictObject({
  telegramUserId: telegramUserIdSchema,
  sessionId: z.uuid(),
  deviceName: deviceNameSchema.nullable(),
  day: z.iso.date(),
  /** `HH:MM`, 24 hours. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})
export type LoginNotice = z.infer<typeof loginNoticeSchema>

/** How many notices one claim hands over; the rest wait for the next minute. */
export const LOGIN_NOTICES_PER_CLAIM = 50

/** `POST /internal/logins/claim`. */
export const dueLoginNoticesSchema = z.strictObject({
  notices: z.array(loginNoticeSchema).max(LOGIN_NOTICES_PER_CLAIM),
})
export type DueLoginNotices = z.infer<typeof dueLoginNoticesSchema>

/** The body of `POST /internal/sessions/:id/end`: whose press it was, Telegram's word (`ctx.from.id`). */
export const endSessionFromBotSchema = z.strictObject({ telegramUserId: telegramUserIdSchema })
export type EndSessionFromBot = z.infer<typeof endSessionFromBotSchema>

/**
 * The longest a notice given back waits (adversarial Б2): Telegram may ask hours of the whole bot, and
 * the bot gives back no later than this — tried again then, and given back again if still refused.
 */
export const LOGIN_NOTICE_BACK_MAX_SECONDS = 3_600

/**
 * The bot's word on a claim (`POST /internal/logins/told`, MOL-361, adversarial А1): what went — sent,
 * the bot blocked, refused for good — and is let go, and what did not, given back. A notice tried and
 * refused for now (Telegram's 429 of that chat, the network) comes back `afterSeconds` on, behind the
 * ones not tried yet, its account's other notices with it (adversarial Б1); one not tried (`null`)
 * keeps its place. A notice the bot never speaks of is let go after `LOGIN_NOTICE_LEASE_SECONDS`,
 * unsent: at most once, as the task asks.
 */
export const loginNoticesToldSchema = z.strictObject({
  told: z.array(z.uuid()).max(LOGIN_NOTICES_PER_CLAIM),
  back: z
    .array(
      z.strictObject({
        sessionId: z.uuid(),
        afterSeconds: z.int().min(0).max(LOGIN_NOTICE_BACK_MAX_SECONDS).nullable(),
      }),
    )
    .max(LOGIN_NOTICES_PER_CLAIM),
})
export type LoginNoticesTold = z.infer<typeof loginNoticesToldSchema>

/** How long a notice handed to the bot waits for its word before it is let go, unsent. */
export const LOGIN_NOTICE_LEASE_SECONDS = 300

/**
 * When a sign-in happened, as the person's own clock shows it: the day and `HH:MM` in their country's
 * zone (Р-3, `personZoneOf`). Absolute rather than «минуту назад», since the message stays in the chat.
 */
export function signedInClock(at: Date, country: string): { day: string; time: string } {
  const { day, hour, minute } = localClock(at, personZoneOf(country))
  return {
    day,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}
