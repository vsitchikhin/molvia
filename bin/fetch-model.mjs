// Puts the embedding model of catalogue search (MOL-105) into a directory, checked file by file.
//
//   node bin/fetch-model.mjs [dir]      # default: .models/<name> of this copy
//
// The files come from Hugging Face at the revision `backend/src/embeddings/model.json` pins, and
// each is checked against the sha256 written there: a model replaced upstream fails here rather
// than answering searches differently in silence. A file already there and matching is kept, so
// a second run downloads nothing — the copies of one machine share `.models` (`bin/link-shared.sh`)
// and CI caches it by the specification.
//
// Used by `make model`, by CI and by the API's image, which carries the model inside it.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const spec = JSON.parse(await readFile(join(root, 'backend/src/embeddings/model.json'), 'utf8'))
const dir = process.argv[2] ?? join(root, '.models', spec.name)

// The Gemma Terms of Use ask that a copy passed on carries this notice (В-2 of MOL-105): the
// API's image is one.
const NOTICE = `${spec.name}: ${spec.repository} at ${spec.revision}.
Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms
`

async function sha256(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function present(path, expected) {
  try {
    await stat(path)
  } catch {
    return false
  }
  return (await sha256(path)) === expected
}

for (const [file, expected] of Object.entries(spec.files)) {
  const path = join(dir, file)
  if (await present(path, expected)) {
    console.log(`  ok      ${file}`)
    continue
  }
  await mkdir(dirname(path), { recursive: true })
  const url = `https://huggingface.co/${spec.repository}/resolve/${spec.revision}/${file}`
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    console.error(`  failed  ${file}: ${response.status}`)
    process.exit(1)
  }
  const partial = `${path}.partial`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  const actual = await sha256(partial)
  if (actual !== expected) {
    await rm(partial)
    console.error(`  failed  ${file}: sha256 ${actual}, expected ${expected}`)
    process.exit(1)
  }
  await rename(partial, path)
  console.log(`  fetched ${file}`)
}
await writeFile(join(dir, 'NOTICE'), NOTICE)
console.log(`model: ${dir}`)
