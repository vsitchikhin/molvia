import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The headers Caddy puts on every answer (MOL-287 Ф-6, MOL-363), read as text as `compose-logging`
 * reads its file: the page's own policy is the build's meta, and what a meta cannot say is here. A
 * header lost from this file is lost from production quietly — nothing breaks.
 */
const caddyfile = readFileSync(
  fileURLToPath(new URL('../../deploy/Caddyfile', import.meta.url)),
  'utf8',
)

/** The file with its comments taken out, so a header in a comment counts for nothing. */
const directives = caddyfile
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n')

describe('deploy/Caddyfile', () => {
  it('keeps the three headers the audit found', () => {
    expect(directives).toMatch(/^\t\tReferrer-Policy strict-origin-when-cross-origin$/m)
    expect(directives).toMatch(/^\t\tX-Content-Type-Options nosniff$/m)
    expect(directives).toMatch(
      /^\t\tPermissions-Policy "camera=\(self\), geolocation=\(\), microphone=\(\)"$/m,
    )
  })

  it('lets nobody frame the page, and says nothing else of the policy — that is the meta', () => {
    const policies = [...directives.matchAll(/Content-Security-Policy\s+"([^"]*)"/g)].map(
      ([, value]) => value,
    )
    expect(policies).toEqual(["frame-ancestors 'none'"])
  })

  it('asks for a year of https, with no preload and no subdomains', () => {
    const hsts = [...directives.matchAll(/^.*Strict-Transport-Security.*$/gm)].map(([line]) => line)
    expect(hsts).toEqual(['\theader @public Strict-Transport-Security "max-age=31536000"'])
  })

  it('and never for localhost, where it would hold every dev server of the browser', () => {
    expect(directives).toMatch(/^\t@public not host localhost$/m)
  })
})
