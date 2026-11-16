import { describe, expect, it } from 'vitest'
import { judge, readLock, readSite } from '@/site'

const OK = { status: 200, body: '{"status":"ok","version":"v0.1.3-45-gfebb22c8","database":"up"}' }
const PAGE = { status: 200, body: '' }

describe('readSite', () => {
  it('finds nothing wrong with a healthy API and page', () => {
    expect(readSite(OK, PAGE)).toEqual([])
  })

  it('names a health that is not 200, the database down included', () => {
    const degraded = { status: 503, body: '{"status":"degraded","version":"v","database":"down"}' }
    expect(readSite(degraded, PAGE)).toEqual(['health 503'])
  })

  it('does not take a 200 that does not say ok for health', () => {
    expect(readSite({ status: 200, body: '<html>maintenance</html>' }, PAGE)).toEqual([
      'health 200',
    ])
    expect(readSite({ status: 200, body: '{"status":"degraded"}' }, PAGE)).toEqual(['health 200'])
  })

  it('prints no answer as curl did, 000', () => {
    expect(readSite({ status: 0, body: '' }, { status: 0, body: '' })).toEqual([
      'health 000',
      'pwa 000',
    ])
  })

  it("takes Cloudflare's own code for a request it could not complete as a failure", () => {
    expect(readSite({ status: 530, body: 'error code: 1016' }, { status: 530, body: '' })).toEqual([
      'health 530',
      'pwa 530',
    ])
  })

  it('names a page that is not 200 — a redirect too', () => {
    expect(readSite(OK, { status: 502, body: '' })).toEqual(['pwa 502'])
    expect(readSite(OK, { status: 301, body: '' })).toEqual(['pwa 301'])
  })
})

describe('judge', () => {
  const down = ['health 503']

  it('is up when the first try was well', () => {
    expect(judge([[]])).toEqual({ up: true })
  })

  it('is up when one or two tries of four failed — a rollout', () => {
    expect(judge([down, [], [], []])).toEqual({ up: true })
    expect(judge([down, down, [], []])).toEqual({ up: true })
    expect(judge([down, [], down, []])).toEqual({ up: true })
  })

  it('is down at three failures of four, saying what the last of them saw', () => {
    expect(judge([down, down, [], ['pwa 000']])).toEqual({ up: false, said: 'pwa 000' })
    expect(judge([down, down, ['health 000', 'pwa 000'], []])).toEqual({
      up: false,
      said: 'health 000\npwa 000',
    })
  })

  it('is down when all four failed', () => {
    expect(judge([down, down, down, down])).toEqual({ up: false, said: 'health 503' })
  })
})

describe('readLock', () => {
  const SIGN_IN =
    'https://molvia.cloudflareaccess.com/cdn-cgi/access/login/grafana.molvia.net?kid=abc&redirect_url=%2F'

  it('finds the lock shut when Access sends the request to its sign-in', () => {
    for (const status of [302, 303, 307])
      expect(readLock({ status, location: SIGN_IN })).toEqual([])
  })

  it('finds it shut when Access refuses the request outright', () => {
    expect(readLock({ status: 401, location: '' })).toEqual([])
    expect(readLock({ status: 403, location: '' })).toEqual([])
  })

  it('names Grafana answering by itself — its page or its own login — the lock open', () => {
    expect(readLock({ status: 200, location: '' })).toEqual(['grafana open 200'])
    expect(readLock({ status: 302, location: '/login' })).toEqual(['grafana open 302'])
    expect(readLock({ status: 302, location: 'https://grafana.molvia.net/login' })).toEqual([
      'grafana open 302',
    ])
  })

  it('takes no sign-in but Access’s own, over https', () => {
    for (const location of [
      'http://molvia.cloudflareaccess.com/cdn-cgi/access/login/x',
      'https://cloudflareaccess.com.evil.test/cdn-cgi/access/login/x',
      'https://evil.test/molvia.cloudflareaccess.com',
      'molvia.cloudflareaccess.com/cdn-cgi/access/login/x',
    ])
      expect(readLock({ status: 302, location }), location).toEqual(['grafana open 302'])
  })

  it('names no answer, or Cloudflare’s own error, by its code — no Access in front either', () => {
    expect(readLock({ status: 0, location: '' })).toEqual(['grafana 000'])
    expect(readLock({ status: 530, location: '' })).toEqual(['grafana 530'])
    expect(readLock({ status: 502, location: '' })).toEqual(['grafana 502'])
  })
})
