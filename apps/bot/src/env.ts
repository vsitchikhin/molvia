import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
} catch {
  // no .env in this environment — fall through to process.env
}

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3300),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
})

export const env = envSchema.parse(process.env)
