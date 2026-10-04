import { describe, expect, it, vi } from 'vitest'
import { PAUSE_MS, PING_TRIES, settingsOf, watch } from './watch'
import type { Io } from './watch'
import worker from './worker'

const PING = 'https://hc-ping.com/0f1e2d3c-secret'
const SETTINGS = { pingUrl: PING, domain: 'molvia.net' }
const HEALTHY = '{"status":"ok","version":"v0.1.3-45-gfebb22c8","database":"up"}'

type Site = 'well' | 'api down' | 'unreachable'

const urlOf = (input: Parameters<typeof globalThis.fetch>[0]): string =>
  input instanceof Request ? input.url : input.toString()

/**
 * A site that answers each try as `tries` says — the last state holds — and a healthchecks.io that
 * answers `pings` in turn. Every request is recorded, the pauses too.
 */
function rig(tries: readonly Site[], pings: readonly (number | 'network')[] = [200]) {
  let attempt = -1
  let ping = -1
  const waits: number[] = []
  const reports: { url: string; method: string; body: string }[] = []
  const answer = (url: string, init: RequestInit | undefined): Response => {
    if (url.startsWith(PING)) {
      ping += 1
      const body = typeof init?.body === 'string' ? init.body : ''
      reports.push({ url, method: init?.method ?? 'GET', body })
      const status = pings[Math.min(ping, pings.length - 1)] ?? 200
      if (status === 'network') throw new TypeError('fetch failed')
      return new Response('OK', { status })
    }
    if (url.endsWith('/api/health')) attempt += 1
    const site = tries[Math.min(attempt, tries.length - 1)]
    if (site === 'unreachable') throw new TypeError('fetch failed')
    if (url.endsWith('/api/health')) {
      return site === 'well'
        ? new Response(HEALTHY)
        : new Response('{"status":"degraded","database":"down"}', { status: 503 })
    }
    return new Response('<!doctype html>')
  }
  // A thrown answer is a rejected fetch, as the network's failure is.
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
    Promise.resolve().then(() => answer(urlOf(input), init)),
  )
  const io: Io = {
    fetch,
    wait: async (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
  }
  return { io, fetch, waits, reports, tries: () => attempt + 1 }
}

describe('watch', () => {
  it('pings at once when the site is well, with no pause', async () => {
    const { io, waits, reports, tries } = rig(['well'])
    const round = await watch(SETTINGS, io)
    expect(round.verdict).toEqual({ up: true })
    expect(tries()).toBe(1)
    expect(waits).toEqual([])
    expect(reports).toEqual([{ url: PING, method: 'GET', body: '' }])
  })

  it('asks the API and the page of the domain it is given', async () => {
    const { io, fetch } = rig(['well'])
    await watch({ pingUrl: PING, domain: 'molvia.invalid' }, io)
    const asked = fetch.mock.calls.map(([input]) => urlOf(input))
    expect(asked.slice(0, 2)).toEqual([
      'https://molvia.invalid/api/health',
      'https://molvia.invalid/',
    ])
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })

  it('makes four tries half a minute apart after one failure, and pings when the rest are well', async () => {
    const { io, waits, reports, tries } = rig(['api down', 'well'])
    const round = await watch(SETTINGS, io)
    expect(tries()).toBe(4)
    expect(waits).toEqual([PAUSE_MS, PAUSE_MS, PAUSE_MS])
    expect(round.verdict).toEqual({ up: true })
    expect(round.attempts).toEqual([['health 503'], [], [], []])
    expect(reports).toEqual([{ url: PING, method: 'GET', body: '' }])
  })

  it('still pings at two failures of four', async () => {
    const { io, reports } = rig(['api down', 'api down', 'well'])
    expect((await watch(SETTINGS, io)).verdict).toEqual({ up: true })
    expect(reports.map((r) => r.url)).toEqual([PING])
  })

  it('reports /fail at three failures of four, saying what the last one saw', async () => {
    const { io, reports } = rig(['api down', 'api down', 'unreachable', 'well'])
    const round = await watch(SETTINGS, io)
    expect(round.verdict).toEqual({ up: false, said: 'health 000\npwa 000' })
    expect(reports).toEqual([{ url: `${PING}/fail`, method: 'POST', body: 'health 000\npwa 000' }])
  })

  it('reports /fail when the site is down all four tries', async () => {
    const { io, reports } = rig(['api down'])
    await watch(SETTINGS, io)
    expect(reports).toEqual([{ url: `${PING}/fail`, method: 'POST', body: 'health 503' }])
  })

  it('tries a ping that failed again, with a growing pause', async () => {
    const { io, waits, reports } = rig(['well'], [503, 'network', 200])
    await watch(SETTINGS, io)
    expect(reports).toHaveLength(3)
    expect(waits).toEqual([1_000, 2_000])
  })

  it('fails the round when no ping went, naming its kind and never the URL', async () => {
    const { io, reports } = rig(['well'], ['network', 'network', 'network', 502])
    const failure = await watch(SETTINGS, io).catch((error: unknown) => error)
    expect(reports).toHaveLength(PING_TRIES)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('the ping to healthchecks.io did not go: 502')
    expect((failure as Error).message).not.toContain('hc-ping')
  })
})

describe('settingsOf', () => {
  it('watches molvia.net unless told another domain', () => {
    expect(settingsOf({ HC_UP_URL: PING })).toEqual(SETTINGS)
    expect(settingsOf({ HC_UP_URL: PING, DOMAIN: ' ' })).toEqual(SETTINGS)
    expect(settingsOf({ HC_UP_URL: PING, DOMAIN: 'molvia.invalid' }).domain).toBe('molvia.invalid')
  })

  it('refuses a missing or plain-http secret by its name, never its value', () => {
    expect(() => settingsOf({})).toThrow(/^HC_UP_URL is not an https URL/)
    expect(() => settingsOf({ HC_UP_URL: '' })).toThrow(/HC_UP_URL/)
    expect(() => settingsOf({ HC_UP_URL: 'http://hc-ping.com/abc' })).toThrow(/^HC_UP_URL/)
    try {
      settingsOf({ HC_UP_URL: 'http://hc-ping.com/abc' })
    } catch (error) {
      expect((error as Error).message).not.toContain('hc-ping')
    }
  })
})

describe('the Worker', () => {
  it('throws rather than stay silent without the secret, and asks nothing', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(worker.scheduled(undefined, {})).rejects.toThrow(/HC_UP_URL/)
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
})
