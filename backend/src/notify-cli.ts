import process from 'node:process'
import { buffer } from 'node:stream/consumers'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import { createBroadcastRepository } from '@/db/broadcasts-repository'
import * as schema from '@/db/schema'
import { notify } from '@/notify'

// Bundled beside the API (`dist/notify.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec -T backend node dist/notify.js [--yes] < notice.txt`. A terminal on standard
// input is no message: it is not read, so a command typed without a file does not wait for one.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await notify(
    process.argv.slice(2),
    createBroadcastRepository(drizzle(client, { schema })),
    async () => (process.stdin.isTTY ? null : buffer(process.stdin)),
    env.OWNER_TELEGRAM_ID ?? null,
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
