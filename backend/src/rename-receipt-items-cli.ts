import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from '@/db/schema'
import { createBrandSpellingRepository } from '@/db/brand-spellings-repository'
import { createItemRepository } from '@/db/items-repository'
import { createRenameRepository } from '@/db/rename-repository'
import { renameReceiptItems } from '@/rename-receipt-items'

// Bundled beside the API (`dist/rename-receipt-items.js`), for the reason `forget-cli.ts` gives:
// `docker compose exec backend node dist/rename-receipt-items.js [--yes]`.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })
try {
  const db = drizzle(client, { schema })
  const catalogue = createItemRepository(db)
  process.exitCode = await renameReceiptItems(
    process.argv.slice(2),
    {
      renamer: createRenameRepository(db),
      nodes: (language) => catalogue.nodes(language),
      spellings: createBrandSpellingRepository(db),
    },
    (line) => {
      console.log(line)
    },
  )
} finally {
  await client.end()
}
