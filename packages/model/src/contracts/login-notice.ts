import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'
import { deviceNameSchema } from '#model/entities/session'
import { timeZoneOf } from '#model/values/geo'

/**
 * «В ваш аккаунт вошло новое устройство» (MOL-361, audit MOL-287 Ф-3) as the API hands it to the bot —
 * already taken off the queue: whose chat, which session the button ends, the device as the browser
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

/** A country with no zone of ours — a row older than the settings — is read in the first market's. */
const LOGIN_NOTICE_DEFAULT_ZONE = 'Asia/Yerevan'

/**
 * When a sign-in happened, as the person's own clock shows it: the day and `HH:MM` in their country's
 * zone (Р-3). Absolute rather than «минуту назад», since the message stays in the chat for good.
 */
export function signedInClock(at: Date, country: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZoneOf(country) ?? LOGIN_NOTICE_DEFAULT_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((one) => one.type === type)?.value ?? ''
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}
