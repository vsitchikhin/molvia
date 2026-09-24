import { z } from 'zod'
import { botApiSecretSchema } from '@molvia/model'

export interface LoginConfiguration {
  readonly username: string
  readonly botSecret: string
}

const loginEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    TELEGRAM_BOT_USERNAME: z
      .union([z.literal(''), z.string().regex(/^[A-Za-z0-9_]{5,32}$/)])
      .default(''),
    BOT_API_SECRET: z.union([z.literal(''), botApiSecretSchema]).default(''),
  })
  .refine(
    (value) =>
      value.NODE_ENV !== 'production' ||
      (value.TELEGRAM_BOT_USERNAME !== '' && value.BOT_API_SECRET !== ''),
    {
      message: 'Production requires TELEGRAM_BOT_USERNAME and BOT_API_SECRET',
    },
  )

export function loginConfiguration(environment: unknown): LoginConfiguration | null {
  const value = loginEnvironmentSchema.parse(environment)
  return value.TELEGRAM_BOT_USERNAME && value.BOT_API_SECRET
    ? { username: value.TELEGRAM_BOT_USERNAME, botSecret: value.BOT_API_SECRET }
    : null
}
