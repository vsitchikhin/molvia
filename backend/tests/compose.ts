import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `docker-compose.prod.yml` as text, for the tests that hold its shape. Read as text rather than
 * parsed: no YAML parser is a dependency of this repository, and the shape they check — one line per
 * setting, a block per service — is the one the file is written in.
 */
export const compose = readFileSync(
  fileURLToPath(new URL('../../docker-compose.prod.yml', import.meta.url)),
  'utf8',
)

/** Each service's block of lines, by its name. */
export function services(): Map<string, string> {
  const body = compose.split(/^services:\n/m)[1]?.split(/^\S/m)[0] ?? ''
  const blocks = new Map<string, string>()
  for (const block of body.split(/^(?= {2}[a-z][\w-]*:\n)/m)) {
    const name = /^ {2}([a-z][\w-]*):\n/.exec(block)?.[1]
    if (name) blocks.set(name, block)
  }
  return blocks
}
