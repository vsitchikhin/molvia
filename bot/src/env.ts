import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
} catch {
  // no .env in this environment — fall through to process.env
}

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3300),
  // In production the API is a sibling container addressed by service name; locally it
  // is a port on the loopback. One variable instead of a branch on NODE_ENV.
  API_BASE_URL: z.url().optional(),
  PWA_PORT: z.coerce.number().int().positive().default(5300),
  // Where the app lives, for the greeting. Same shape as the pair above: production sets it
  // outright (`https://<domain>`), a working copy leaves it out and gets its own PWA port —
  // so there is no «no link» case to write a second greeting for.
  APP_BASE_URL: z.url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  /**
   * The internal channel's secret, shared with the API — never the Telegram token (MOL-54, Р-5).
   *
   * Judged here rather than inside `createBotClient`, which refuses the same shape by throwing
   * `error.bot_unauthorized`: that code is about a request the API turned down, and a copy whose
   * `.env` is simply missing a line deserves to be told that instead.
   */
  BOT_API_SECRET: z.union([z.literal(''), z.string().regex(/^[A-Za-z0-9_-]{43}$/)]).default(''),
})

export const env = envSchema.parse(process.env)

export const apiBaseUrl = env.API_BASE_URL ?? `http://127.0.0.1:${String(env.API_PORT)}`
export const appBaseUrl = env.APP_BASE_URL ?? `http://127.0.0.1:${String(env.PWA_PORT)}`
