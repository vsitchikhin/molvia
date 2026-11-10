import { describe, expect, it } from 'vitest'
import { findingsOf, summaryOf } from './scan-images.mjs'

const vulnerability = (id: string, name: string) => ({
  VulnerabilityID: id,
  PkgName: name,
  InstalledVersion: '1.0.0',
  FixedVersion: '1.0.1',
  Severity: 'HIGH',
})

// The shape of `trivy image --format json`: a result per target, its class and type beside its findings.
const report = {
  Results: [
    {
      Target: 'alpine 3.23',
      Class: 'os-pkgs',
      Type: 'alpine',
      Vulnerabilities: [vulnerability('CVE-1', 'zlib')],
    },
    {
      Target: 'app/node_modules',
      Class: 'lang-pkgs',
      Type: 'node-pkg',
      Vulnerabilities: [vulnerability('CVE-2', 'tar')],
    },
    {
      Target: 'usr/bin/caddy',
      Class: 'lang-pkgs',
      Type: 'gobinary',
      Vulnerabilities: [vulnerability('CVE-3', 'golang.org/x/net')],
    },
    { Target: 'debian 13', Class: 'os-pkgs', Type: 'debian' },
  ],
}

describe('findingsOf', () => {
  it('takes the distribution and node_modules as ours, a Go binary as another release', () => {
    expect(findingsOf('frontend', report).map(({ id, ours }) => `${id} ${String(ours)}`)).toEqual([
      'CVE-1 true',
      'CVE-2 true',
      'CVE-3 false',
    ])
  })

  it('is empty for an image with nothing found', () => {
    expect(findingsOf('bot', { Results: [] })).toEqual([])
    expect(findingsOf('bot', {})).toEqual([])
  })
})

describe('summaryOf', () => {
  it('counts both, names what was not scanned, and lists ours first', () => {
    const found = findingsOf('frontend', report)
    const summary = summaryOf(
      'sha-1a2b3c4',
      [...found.slice(2), ...found.slice(0, 2)],
      [{ image: 'grafana', reason: 'TOOMANYREQUESTS' }],
    )
    expect(summary).toContain('2 ours, 1 inside Go binaries')
    expect(summary).toContain('**grafana not scanned**: TOOMANYREQUESTS')
    const rows = summary.split('\n').filter((line) => line.startsWith('| frontend'))
    expect(rows.map((row) => row.split(' | ')[2])).toEqual(['CVE-1', 'CVE-2', 'CVE-3'])
  })
})
