import { z } from 'zod'
import { actorCodec } from './actor'
import { deviceNameSchema } from '#model/entities/session'
import { telegramUserIdSchema } from '#model/entities/actor'

export const LOGIN_COOKIE = '__Host-molvia_login'
export const LOGIN_HEADER = 'X-Molvia-Login'
export const LOGIN_LIFETIME_SECONDS = 5 * 60
export const LOGIN_WINDOW_SECONDS = 60
export const LOGIN_WINDOW_LIMIT = 30

/**
 * What the internal channel's secret looks like: 32 random bytes in base64url (MOL-54, Р-5).
 * It is not the Telegram token, and it is generated once per copy by `bin/init-env.sh`.
 *
 * Here rather than three times over, and the third copy is what forced it (MOL-55, З-3): the
 * API's configuration, the client that carries the secret and the bot's own environment each
 * spelled the rule out for themselves. That is the shape `INVISIBLE`, `resource.ts` and
 * `secret.ts` were all in before a copy disagreed with its twin — and each of those cost a 500
 * to find out. Nothing about it belongs to one side of the wire, so it belongs to the contract.
 */
export const botApiSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

const dateCodec = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (value) => value.toISOString(),
})

export const loginStartedCodec = z.strictObject({
  id: z.uuid(),
  url: z.url({ protocol: /^https$/ }).refine((value) => new URL(value).hostname === 't.me'),
  expiresAt: dateCodec,
})
export type LoginStarted = z.infer<typeof loginStartedCodec>

export const loginPollCodec = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('pending'), expiresAt: dateCodec }),
  z.strictObject({ status: z.literal('authenticated'), actor: actorCodec }),
])
export type LoginPoll = z.infer<typeof loginPollCodec>

export const loginPreviewCodec = z.strictObject({
  deviceName: deviceNameSchema.nullable(),
  createdAt: dateCodec,
  expiresAt: dateCodec,
  /**
   * Whether somebody has already said «yes» to this request — **not who** (Р-11: the Telegram
   * id does not leave the server).
   *
   * It exists because of what a lost answer used to look like (MOL-55, О-2): the API had
   * written the confirmation, the reply never arrived, and the bot told the person it had not
   * worked. Doing as told — opening the link again — then met «this link no longer works»,
   * while the browser was collecting the session. Both sentences were false. With this, the
   * bot can say the one true thing: it is confirmed, go back to the app.
   */
  confirmed: z.boolean(),
})
export type LoginPreview = z.infer<typeof loginPreviewCodec>

export const confirmLoginSchema = z.strictObject({ telegramUserId: telegramUserIdSchema })
