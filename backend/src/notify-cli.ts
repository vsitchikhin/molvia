import process from 'node:process'
import type { Readable } from 'node:stream'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import { createBroadcastRepository } from '@/db/broadcasts-repository'
import * as schema from '@/db/schema'
import { notify } from '@/notify'

/**
 * How long the first bytes of the message are waited for. A file given with `<` is there at once;
 * over `ssh … exec -T` with the file forgotten, the input is an open pipe that never ends, and the
 * command waited in silence for a Ctrl-D (adversarial А4).
 */
const FIRST_BYTES_MS = 2_000

/** The message on standard input, or `null` when none comes — a terminal, or nothing in time. */
function messageOn(input: Readable): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const none = setTimeout(() => {
      input.destroy()
      resolve(null)
    }, FIRST_BYTES_MS)
    input.on('data', (chunk: Buffer) => {
      clearTimeout(none)
      chunks.push(chunk)
    })
    input.on('end', () => {
      clearTimeout(none)
      resolve(Buffer.concat(chunks))
    })
    input.on('error', (error) => {
      clearTimeout(none)
      reject(error)
    })
  })
}

// Bundled beside the API (`dist/notify.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec -T backend node dist/notify.js [--yes] < notice.txt`. A terminal on standard
// input is no message: it is not read, so a command typed without a file does not wait for one.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  process.exitCode = await notify(
    process.argv.slice(2),
    createBroadcastRepository(drizzle(client, { schema })),
    async () => (process.stdin.isTTY ? null : messageOn(process.stdin)),
    env.OWNER_TELEGRAM_ID ?? null,
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
