// `make up` runs migrations on every start, and there are none until the first feature.
// Reporting that plainly keeps a fresh copy from failing on an empty migrations folder.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const journal = fileURLToPath(new URL('../drizzle/meta/_journal.json', import.meta.url))

if (!existsSync(journal)) {
  console.log('no migrations yet — the schema lands with the first feature')
  process.exit(0)
}

const result = spawnSync('npx', ['drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  cwd: fileURLToPath(new URL('..', import.meta.url)),
})
process.exit(result.status ?? 1)
