import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import { createPaymentsRepository } from '@/db/payments-repository'
import * as schema from '@/db/schema'
import { refund } from '@/refund'
import { ameriabankChannel } from '@/vpos/ameriabank'
import { vposClient } from '@/vpos/client'
import { vposConfiguration } from '@/vpos/config'

// Bundled beside the API (`dist/refund.js`), as `forget` is: the production machine has neither the source nor a
// published database port. The bank is read whether the фф is on or not — money paid while it was on is given back
// after it went off — and only for a real refund: a dry run asks nothing of it.
const wanted = process.argv.includes('--yes')
let config: ReturnType<typeof vposConfiguration> = null
try {
  config = wanted ? vposConfiguration(process.env, true) : null
} catch (error) {
  console.log(error instanceof Error ? error.message : 'the bank is not configured')
}
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await refund(
    process.argv.slice(2),
    {
      payments: createPaymentsRepository(drizzle(client, { schema })),
      channel:
        config === null
          ? null
          : ameriabankChannel({
              client: vposClient(config),
              stand: config.stand,
              appBaseUrl: config.appBaseUrl,
              strange: () => undefined,
            }),
      now: () => new Date(),
    },
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
