import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { botApiSecretSchema } from '@molvia/model'

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
} catch {
  // no .env in this environment — fall through to process.env
}

/**
 * The token, read on its own and before anything else is judged.
 *
 * «A copy with no bot says one line and exits 0» is a promise about compose: `restart:
 * on-failure` would turn any other exit into a restart loop. Parsing the whole environment
 * first broke that promise for a value nobody in such a copy cares about — a hand-written
 * `APP_BASE_URL` without a scheme took down a copy that was not going to start a bot anyway
 * (adversarial О-5). What is malformed is still a failure, and still exits 1; what is simply
 * absent is not.
 */
export const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''

const environmentSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3300),
  // In production the API is a sibling container addressed by service name; locally it
  // is a port on the loopback. One variable instead of a branch on NODE_ENV.
  API_BASE_URL: z.url().optional(),
  PWA_PORT: z.coerce.number().int().positive().default(5300),
  // Where the app lives, for the greeting. Same shape as the pair above: production sets it
  // outright (`https://<domain>`), a working copy leaves it out and gets its own PWA port —
  // so there is no «no link» case to write a second greeting for.
  APP_BASE_URL: z.url().optional(),
  /**
   * The internal channel's secret, shared with the API — never the Telegram token (MOL-54, Р-5).
   *
   * Judged here rather than inside `createBotClient`, which refuses the same shape by throwing
   * `error.bot_unauthorized`: that code is about a request the API turned down, and a copy whose
   * `.env` is simply missing a line deserves to be told that instead.
   */
  BOT_API_SECRET: z.union([z.literal(''), botApiSecretSchema]).default(''),
})

export interface BotEnvironment {
  /** Empty means «this copy cannot confirm a login» — the caller decides what to do about it. */
  readonly secret: string
  readonly apiBaseUrl: string
  readonly appBaseUrl: string
}

export function readEnvironment(): BotEnvironment {
  const value = environmentSchema.parse(process.env)
  return {
    secret: value.BOT_API_SECRET,
    apiBaseUrl: value.API_BASE_URL ?? `http://127.0.0.1:${String(value.API_PORT)}`,
    appBaseUrl: value.APP_BASE_URL ?? `http://127.0.0.1:${String(value.PWA_PORT)}`,
  }
}

/**
 * Which variables an environment was refused for — **names only, never values**.
 *
 * Zod puts the offending input into its own message, and one of these variables is the
 * channel's secret. A crash printing `error.message` would write it to the log of every copy
 * that mistyped it, which is the one thing this module must never do.
 */
export function refusedNames(error: unknown): string {
  if (!(error instanceof z.ZodError)) return 'unknown'
  return [...new Set(error.issues.map((issue) => issue.path.join('.') || 'environment'))].join(', ')
}
