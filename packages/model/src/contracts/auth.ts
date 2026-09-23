import { z } from 'zod'
import { actorCodec } from './actor'
import { deviceNameSchema } from '#model/entities/session'
import { telegramUserIdSchema } from '#model/entities/actor'

export const LOGIN_COOKIE = '__Host-molvia_login'
export const LOGIN_HEADER = 'X-Molvia-Login'
export const LOGIN_LIFETIME_SECONDS = 5 * 60
export const LOGIN_WINDOW_SECONDS = 60
export const LOGIN_WINDOW_LIMIT = 30

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
})
export type LoginPreview = z.infer<typeof loginPreviewCodec>

export const confirmLoginSchema = z.strictObject({ telegramUserId: telegramUserIdSchema })
