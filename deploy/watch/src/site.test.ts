import { describe, expect, it } from 'vitest'
import { judge, readSite } from './site'

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
