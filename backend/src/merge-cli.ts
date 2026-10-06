import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import { createMergeRepository } from '@/db/merge-repository'
import * as schema from '@/db/schema'
import { mergeCommand } from '@/merge-command'

class DryRun extends Error {
  constructor(readonly result: unknown) {
    super('dry run')
  }
}

// Bundled beside the API (`dist/merge.js`), as `forget` is: the production machine has neither the
// source nor a published database port.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
const db = drizzle(client, { schema })
try {
  process.exitCode = await mergeCommand(
    process.argv.slice(2),
    async (dryRun, work) => {
      try {
        return await db.transaction(async (tx) => {
          const result = await work(createMergeRepository(tx))
          if (dryRun) throw new DryRun(result)
          return result
        })
      } catch (error) {
        if (error instanceof DryRun) return error.result as never
        throw error
      }
    },
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
