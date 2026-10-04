import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAUSE_MS, PING_TRIES, REQUEST_TIMEOUT_MS, settingsOf, watch } from '@/watch'
import type { Io } from '@/watch'
import worker from '@/worker'

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
  const logged: string[] = []
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
    log: (line, warn) => {
      logged.push(`${warn ? 'warn' : 'log'}: ${line}`)
    },
  }
  return { io, fetch, waits, reports, logged, tries: () => attempt + 1 }
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

  it('logs what the tries saw, the site well or not', async () => {
    const well = rig(['well'])
    await watch(SETTINGS, well.io)
    expect(well.logged).toEqual(['log: molvia.net is well'])

    const down = rig(['api down', 'unreachable'])
    await watch(SETTINGS, down.io)
    expect(down.logged).toEqual([
      'warn: attempt 1: health 503',
      'warn: attempt 2: health 000; pwa 000',
      'warn: attempt 3: health 000; pwa 000',
      'warn: attempt 4: health 000; pwa 000',
      'warn: molvia.net: health 000; pwa 000',
    ])
  })

  it('has logged what the site did when the ping then does not go', async () => {
    const { io, logged } = rig(['api down'], ['network'])
    await expect(watch(SETTINGS, io)).rejects.toThrow('did not go: network')
    expect(logged.at(-1)).toBe('warn: molvia.net: health 503')
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

/** A response whose status came and whose body broke: the connection reset after the head. */
const headThenReset = (status: number): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError('connection reset'))
      },
    }),
    { status },
  )

describe('a body broken after the status', () => {
  const io = (ping: () => Response): Io & { pings: () => number } => {
    let pings = 0
    return {
      fetch: (input) =>
        Promise.resolve().then(() => {
          const url = urlOf(input)
          if (url.startsWith(PING)) {
            pings += 1
            return ping()
          }
          return url.endsWith('/api/health') ? new Response(HEALTHY) : headThenReset(200)
        }),
      wait: async () => Promise.resolve(),
      log: () => undefined,
      pings: () => pings,
    }
  }

  it('leaves a ping healthchecks.io answered 200 gone, once (adversarial А3)', async () => {
    const rigged = io(() => headThenReset(200))
    const round = await watch(SETTINGS, rigged)
    expect(rigged.pings()).toBe(1)
    expect(round.verdict).toEqual({ up: true })
  })

  it('leaves a page answered 200 a 200, not a 000', async () => {
    const round = await watch(
      SETTINGS,
      io(() => new Response('OK')),
    )
    expect(round.attempts).toEqual([[]])
  })
})

/**
 * The machine down the way a dead VPS is (adversarial А2): packets dropped, so every request hangs
 * until its own timeout. Timers and `AbortSignal.timeout` run on vitest's clock.
 */
describe('a machine that does not answer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function hanging(pingHangs: boolean) {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => {
        controller.abort(new DOMException('timed out', 'TimeoutError'))
      }, ms)
      return controller.signal
    })
    const start = Date.now()
    let failAt = -1
    const signals: boolean[] = []
    const hang = async (signal: AbortSignal | null | undefined): Promise<Response> =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(signal.reason as Error)
        })
      })
    const io: Io = {
      fetch: async (input, init) => {
        signals.push(init?.signal instanceof AbortSignal)
        if (urlOf(input).startsWith(PING)) {
          if (failAt < 0) failAt = Date.now() - start
          return pingHangs ? hang(init?.signal) : Promise.resolve(new Response('OK'))
        }
        return hang(init?.signal)
      },
      wait: async (ms) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms)
        }),
      log: () => undefined,
    }
    return { io, start, signals, failAt: () => failAt }
  }

  it('gives every request its timeout, and a request that ran out is 000', async () => {
    const { io, signals } = hanging(false)
    const round = watch(SETTINGS, io)
    await vi.runAllTimersAsync()
    expect((await round).attempts).toEqual(Array(4).fill(['health 000', 'pwa 000']))
    expect(signals).toHaveLength(9)
    expect(signals.every(Boolean)).toBe(true)
  })

  it('sends /fail 170 s into the round: four tries of two timeouts and three pauses', async () => {
    const { io, failAt } = hanging(false)
    const round = watch(SETTINGS, io)
    await vi.runAllTimersAsync()
    expect((await round).verdict.up).toBe(false)
    expect(failAt()).toBe(4 * 2 * REQUEST_TIMEOUT_MS + 3 * PAUSE_MS)
  })

  it('fails by timeout in 217 s when healthchecks.io hangs too — well inside five minutes', async () => {
    const { io, start } = hanging(true)
    const round = watch(SETTINGS, io).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(((await round) as Error).message).toBe('the ping to healthchecks.io did not go: timeout')
    expect(Date.now() - start).toBe(217_000)
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

describe('what healthchecks.io says', () => {
  const io = (said: string): Io & { pings: () => number } => {
    let pings = 0
    return {
      fetch: (input) =>
        Promise.resolve().then(() => {
          const url = urlOf(input)
          if (url.startsWith(PING)) {
            pings += 1
            return new Response(said)
          }
          return new Response(url.endsWith('/api/health') ? HEALTHY : '<!doctype html>')
        }),
      wait: async () => Promise.resolve(),
      log: () => undefined,
      pings: () => pings,
    }
  }

  it('fails the round at once when the ping reached no check (R3-2)', async () => {
    const rigged = io('OK (not found)')
    await expect(watch(SETTINGS, rigged)).rejects.toThrow(
      'the ping to healthchecks.io reached no check: «OK (not found)»',
    )
    expect(rigged.pings()).toBe(1)
  })

  it('takes a plain OK, with the line feed it may end in, for a ping delivered', async () => {
    await expect(watch(SETTINGS, io('OK\n'))).resolves.toBeDefined()
  })
})

describe('the ping URL', () => {
  it.each([
    ['a query', 'https://hc-ping.com/pk/molvia-up?create=1'],
    ['an empty query', 'https://hc-ping.com/0f1e2d3c-secret?'],
    ['a fragment', 'https://hc-ping.com/0f1e2d3c-secret#molvia-up'],
    ['a trailing slash', 'https://hc-ping.com/0f1e2d3c-secret/'],
    ['a trailing backslash, a slash to the parser (R2-1)', 'https://hc-ping.com/0f1e2d3c-secret\\'],
    ['a trailing «/.», folded to a slash (R2-1)', 'https://hc-ping.com/0f1e2d3c-secret/.'],
    ['a path the parser rewrites', 'https://hc-ping.com/pk/../0f1e2d3c-secret'],
    ['a host written in capitals', 'https://HC-PING.com/0f1e2d3c-secret'],
    ['an exit code after the check (R3-1)', 'https://hc-ping.com/0f1e2d3c-secret/0'],
    ['«start» after the check (R3-1)', 'https://hc-ping.com/0f1e2d3c-secret/start'],
    ['«log» after the check (R3-1)', 'https://hc-ping.com/0f1e2d3c-secret/log'],
    ['«fail» itself (R3-1)', 'https://hc-ping.com/0f1e2d3c-secret/fail'],
  ])('is refused with %s, which /fail cannot follow (adversarial А1)', (_, url) => {
    expect(() => settingsOf({ HC_UP_URL: url })).toThrow(/^HC_UP_URL is not the check URL/)
    try {
      settingsOf({ HC_UP_URL: url })
    } catch (error) {
      expect((error as Error).message).not.toContain('hc-ping')
    }
  })

  it('is taken by uuid or by ping key and slug', () => {
    expect(settingsOf({ HC_UP_URL: PING }).pingUrl).toBe(PING)
    const bySlug = 'https://hc-ping.com/pk/molvia-up'
    expect(settingsOf({ HC_UP_URL: bySlug }).pingUrl).toBe(bySlug)
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
