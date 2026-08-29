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
  TELEGRAM_BOT_TOKEN: z.string().default(''),
})

export const env = envSchema.parse(process.env)
