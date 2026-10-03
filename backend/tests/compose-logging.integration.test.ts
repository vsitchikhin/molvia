import { describe, expect, it } from 'vitest'
import { compose, services } from './compose'

/**
 * «Logs live fourteen days» (MOL-58) holds only if every container writes to the journal, where
 * the term is set. A service added without `logging` falls back to Docker's `json-file` and
 * keeps its log for good — quietly, since nothing breaks.
 */
describe('docker-compose.prod.yml', () => {
  it('sends every service to the journal', () => {
    const found = services()
    expect([...found.keys()].sort()).toEqual([
      'backend',
      'bot',
      'cadvisor',
      'frontend',
      'grafana',
      'node-exporter',
      'postgres',
      'postgres-exporter',
      'receipt-reader',
      'victoria',
    ])
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
