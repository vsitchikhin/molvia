import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * «Logs live fourteen days» (MOL-58) holds only if every container writes to the journal, where
 * the term is set. A service added without `logging` falls back to Docker's `json-file` and
 * keeps its log for good — quietly, since nothing breaks.
 *
 * Read as text rather than parsed: no YAML parser is a dependency of this repository, and the
 * shape it checks — one line per service — is the one the file is written in.
 */
const compose = readFileSync(
  fileURLToPath(new URL('../../docker-compose.prod.yml', import.meta.url)),
  'utf8',
)

function services(): Map<string, string> {
  const body = compose.split(/^services:\n/m)[1]?.split(/^\S/m)[0] ?? ''
  const blocks = new Map<string, string>()
  for (const block of body.split(/^(?= {2}[a-z][\w-]*:\n)/m)) {
    const name = /^ {2}([a-z][\w-]*):\n/.exec(block)?.[1]
    if (name) blocks.set(name, block)
  }
  return blocks
}

describe('docker-compose.prod.yml', () => {
  it('sends every service to the journal', () => {
    const found = services()
    expect([...found.keys()].sort()).toEqual(['backend', 'bot', 'frontend', 'postgres'])
    for (const [, block] of found) expect(block).toMatch(/^ {4}logging: \*logging$/m)
  })

  it('keeps DETAIL — the values of the row — out of the journal of Postgres itself', () => {
    expect(services().get('postgres')).toContain(
      `command: ['postgres', '-c', 'log_error_verbosity=terse']`,
    )
  })

  it('and the anchor is the journal unless a laptop says otherwise, never a size cap', () => {
    expect(compose).toMatch(/^x-logging: &logging\n {2}driver: \$\{LOG_DRIVER:-journald\}$/m)
  })
})
