import { z } from 'zod'
import {
  ERROR,
  ISSUE,
  botApiSecretSchema,
  confirmLoginSchema,
  eraseMeSchema,
  loginCodeSchema,
  loginPreviewCodec,
} from '@molvia/model'
import type { LoginPreview, TelegramUserId } from '@molvia/model'
import { ApiError, createTransport } from './transport'
import type { ClientOptions } from './transport'

export interface BotClientOptions extends Omit<ClientOptions, 'credentials'> {
  readonly secret: string
}
export interface MolviaBotClient {
  previewLogin(code: string): Promise<LoginPreview>
  confirmLogin(code: string, telegramUserId: TelegramUserId): Promise<void>
  declineLogin(code: string): Promise<void>
  /** Everything about this Telegram account, gone (MOL-58). Repeats answer the same. */
  eraseMe(telegramUserId: TelegramUserId): Promise<void>
}

/** An internal client has no session and cannot attach its secret to an arbitrary API path. */
export function createBotClient({ secret, ...options }: BotClientOptions): MolviaBotClient {
  if (!botApiSecretSchema.safeParse(secret).success) throw new ApiError(ERROR.BOT_UNAUTHORIZED)
  const { request } = createTransport({ ...options, credentials: 'omit', botSecret: secret })
  function path(code: string): string {
    if (!loginCodeSchema.safeParse(code).success) throw new ApiError(ISSUE.PATH_INVALID, 'code')
    return `/internal/auth/login/${code}`
  }
  return {
    previewLogin: async (code) => request(path(code), loginPreviewCodec),
    confirmLogin: async (code, telegramUserId) => {
      const body = confirmLoginSchema.safeParse({ telegramUserId })
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'telegramUserId')
      await request(`${path(code)}/confirm`, z.undefined(), { method: 'POST', body: body.data })
    },
    declineLogin: async (code) => {
      await request(`${path(code)}/decline`, z.undefined(), { method: 'POST' })
    },
    eraseMe: async (telegramUserId) => {
      const body = eraseMeSchema.safeParse({ telegramUserId })
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'telegramUserId')
      await request('/internal/actors/erase', z.undefined(), { method: 'POST', body: body.data })
    },
  }
}
