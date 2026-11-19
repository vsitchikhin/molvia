import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCK_PATH,
  PAUSE_MS,
  PING_TRIES,
  REQUEST_TIMEOUT_MS,
  settingsOf,
  watch,
  watchLock,
} from '@/watch'
import type { Io } from '@/watch'
import worker from '@/worker'

const PING = 'https://hc-ping.com/0f1e2d3c-secret'
/** Two checks by their UUIDs, as the lock's round takes them (MOL-399). */
const UP = 'https://hc-ping.com/0f1e2d3c-4b5a-4c6d-8e7f-a0b1c2d3e4f5'
const LOCK = 'https://hc-ping.com/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const SETTINGS = { pingUrl: PING, domain: 'molvia.net' }
const HEALTHY = '{"status":"ok","version":"v0.1.3-45-gfebb22c8","database":"up"}'

type Site = 'well' | 'api down' | 'unreachable'

const urlOf = (input: Parameters<typeof globalThis.fetch>[0]): string =>
  input instanceof Request ? input.url : input.toString()

/**
 * A Worker's `io` whose requests `answer` serves, and a healthchecks.io behind `pingUrl` that answers
 * `pings` in turn. Every request is recorded, the pauses and the log too.
 */
function fakeIo(
  pingUrl: string,
  answer: (url: string) => Response,
  pings: readonly (number | 'network')[] = [200],
) {
  let ping = -1
  const waits: number[] = []
  const logged: string[] = []
  const reports: { url: string; method: string; body: string }[] = []
  // A thrown answer is a rejected fetch, as the network's failure is.
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
    Promise.resolve().then(() => {
      const url = urlOf(input)
      if (!url.startsWith(pingUrl)) return answer(url)
      ping += 1
      const body = typeof init?.body === 'string' ? init.body : ''
      reports.push({ url, method: init?.method ?? 'GET', body })
      const status = pings[Math.min(ping, pings.length - 1)] ?? 200
      if (status === 'network') throw new TypeError('fetch failed')
      return new Response('OK', { status })
    }),
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
  return { io, fetch, waits, reports, logged }
}

/** A site that answers each try as `tries` says — the last state holds. */
function rig(tries: readonly Site[], pings: readonly (number | 'network')[] = [200]) {
  let attempt = -1
  const fake = fakeIo(
    PING,
    (url) => {
      if (url.endsWith('/api/health')) attempt += 1
      const site = tries[Math.min(attempt, tries.length - 1)]
      if (site === 'unreachable') throw new TypeError('fetch failed')
      if (url.endsWith('/api/health')) {
        return site === 'well'
          ? new Response(HEALTHY)
          : new Response('{"status":"degraded","database":"down"}', { status: 503 })
      }
      return new Response('<!doctype html>')
    },
    pings,
  )
  return { ...fake, tries: () => attempt + 1 }
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

  it('tries a ping not taken again — rate limited is not «no check» (R4-1)', async () => {
    let answer = 0
    const answers = ['OK (rate limited)', 'OK']
    const rigged: Io = {
      ...io('unused'),
      fetch: (input) =>
        Promise.resolve().then(() =>
          urlOf(input).startsWith(PING)
            ? new Response(answers[Math.min((answer += 1) - 1, answers.length - 1)])
            : new Response(urlOf(input).endsWith('/api/health') ? HEALTHY : '<!doctype html>'),
        ),
    }
    await expect(watch(SETTINGS, rigged)).resolves.toBeDefined()
    expect(answer).toBe(2)
  })

  it('fails by its words when no try was taken, never as «no check»', async () => {
    const rigged = io('OK (rate limited)')
    await expect(watch(SETTINGS, rigged)).rejects.toThrow(
      'the ping to healthchecks.io did not go: «OK (rate limited)»',
    )
    expect(rigged.pings()).toBe(PING_TRIES)
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

describe('the lock of Grafana (MOL-399)', () => {
  const LOCKED = { ...SETTINGS, pingUrl: UP, lockUrl: LOCK }
  const SIGN_IN = 'https://molvia.cloudflareaccess.com/cdn-cgi/access/login/grafana.molvia.net'

  type Door = 'access' | 'grafana' | 'challenge' | 'unreachable'

  /** Grafana's address answering each try as `doors` says — the last state holds. */
  function door(doors: readonly Door[]) {
    let attempt = -1
    return fakeIo(LOCK, () => {
      attempt += 1
      const state = doors[Math.min(attempt, doors.length - 1)]
      if (state === 'unreachable') throw new TypeError('fetch failed')
      if (state === 'challenge') return new Response(null, { status: 403 })
      // Access switched off: Grafana serves a shared dashboard's page for any link, a known one or not.
      if (state === 'grafana') return new Response('<!doctype html>')
      return new Response(null, { status: 302, headers: { location: SIGN_IN } })
    })
  }

  it('asks a path the tunnel passes, with no pass, never following the redirect, and pings its own check', async () => {
    const { io, fetch, waits, reports, logged } = door(['access'])
    const round = await watchLock(LOCKED, io)
    expect(round.verdict).toEqual({ up: true })
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toEqual([
      'https://grafana.molvia.net/public-dashboards/watch',
      LOCK,
    ])
    expect(LOCK_PATH).toMatch(/^\/public-dashboards\//)
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual')
    expect(fetch.mock.calls[0]?.[1]?.headers).toBeUndefined()
    expect(waits).toEqual([])
    expect(reports).toEqual([{ url: LOCK, method: 'GET', body: '' }])
    expect(logged).toEqual(['log: grafana.molvia.net is well'])
  })

  it('reports /fail «grafana open» at three answers of Grafana’s own in four — Access off', async () => {
    const { io, reports } = door(['grafana', 'grafana', 'access', 'grafana'])
    const round = await watchLock(LOCKED, io)
    expect(round.attempts).toEqual([
      ['grafana open 200'],
      ['grafana open 200'],
      [],
      ['grafana open 200'],
    ])
    expect(reports).toEqual([{ url: `${LOCK}/fail`, method: 'POST', body: 'grafana open 200' }])
  })

  it('still pings at two of four — a rollout of the tunnel', async () => {
    const { io, reports } = door(['grafana', 'unreachable', 'access'])
    expect((await watchLock(LOCKED, io)).verdict).toEqual({ up: true })
    expect(reports.map((report) => report.url)).toEqual([LOCK])
  })

  it('asks the domain it is given', async () => {
    const { io, fetch } = door(['access'])
    await watchLock({ ...LOCKED, domain: 'molvia.invalid' }, io)
    expect(urlOf(fetch.mock.calls[0]?.[0] ?? '')).toBe(
      'https://grafana.molvia.invalid/public-dashboards/watch',
    )
  })

  it('refuses a missing or malformed secret by its name, never its value, and asks nothing', async () => {
    for (const lockUrl of [
      undefined,
      '',
      'http://hc-ping.com/abc',
      `${LOCK}?x=1`,
      `${LOCK}/fail`,
    ]) {
      const { io, fetch } = door(['access'])
      const failure = await watchLock(
        { ...SETTINGS, ...(lockUrl === undefined ? {} : { lockUrl }) },
        io,
      ).catch((error: unknown) => error)
      expect((failure as Error).message, lockUrl).toMatch(/^HC_LOCK_URL is not/)
      expect((failure as Error).message).not.toContain('hc-ping')
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('never takes a 403 for the lock — a challenge a browser passes to the Grafana behind (adversarial А5)', async () => {
    const { io, reports } = door(['challenge'])
    const round = await watchLock(LOCKED, io)
    expect(round.attempts).toEqual(Array(4).fill(['grafana 403']))
    expect(reports).toEqual([{ url: `${LOCK}/fail`, method: 'POST', body: 'grafana 403' }])
  })

  it('refuses the site’s own check, and asks nothing (adversarial А4)', async () => {
    const { io, fetch } = door(['access'])
    await expect(watchLock({ ...LOCKED, lockUrl: UP }, io)).rejects.toThrow(
      'HC_LOCK_URL is the same check as HC_UP_URL — the lock needs a check of its own',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('tells the checks apart by UUIDs alone, naming the secret not by one (adversarial Б2, review №14)', async () => {
    const SLUG_UP = 'https://hc-ping.com/pk/molvia-up'
    for (const [pingUrl, lockUrl, said] of [
      [UP, 'https://hc-ping.com/pk/molvia-up', 'HC_LOCK_URL is'],
      [SLUG_UP, LOCK, 'HC_UP_URL is'],
      [SLUG_UP, 'https://hc-ping.com/pk/molvia-grafana-lock', 'HC_UP_URL and HC_LOCK_URL are'],
    ] as const) {
      const { io, fetch } = door(['access'])
      await expect(watchLock({ ...SETTINGS, pingUrl, lockUrl }, io), lockUrl).rejects.toThrow(
        `${said} not a check’s UUID URL — the lock’s round tells checks by their UUIDs`,
      )
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('takes one UUID under another host for the same check (adversarial Б3, review №13)', async () => {
    const uuid = UP.slice('https://hc-ping.com/'.length)
    for (const lockUrl of [`https://hchk.io/${uuid}`, `https://hc-ping.com./${uuid}`]) {
      const { io, fetch } = door(['access'])
      await expect(watchLock({ ...SETTINGS, pingUrl: UP, lockUrl }, io), lockUrl).rejects.toThrow(
        'HC_LOCK_URL is the same check as HC_UP_URL — the lock needs a check of its own',
      )
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('is read as set: the site’s settings never refuse over it', () => {
    expect(settingsOf({ HC_UP_URL: PING, HC_LOCK_URL: 'not a url' })).toEqual({
      ...SETTINGS,
      lockUrl: 'not a url',
    })
    expect(settingsOf({ HC_UP_URL: PING })).toEqual(SETTINGS)
  })
})

describe('the Worker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws rather than stay silent without the secret, and asks nothing', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(worker.scheduled(undefined, {})).rejects.toThrow(/HC_UP_URL/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('tells of the site, then fails the round for the lock’s secret missing (MOL-399)', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) =>
        Promise.resolve(
          new Response(
            urlOf(input).endsWith('/api/health') ? HEALTHY : urlOf(input) === PING ? 'OK' : '',
          ),
        ),
      )
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(worker.scheduled(undefined, { HC_UP_URL: PING })).rejects.toThrow(
      /^HC_LOCK_URL is not/,
    )
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toContain(PING)
  })

  it('names both rounds when both fail (review №1)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        new Response(
          urlOf(input).endsWith('/api/health')
            ? HEALTHY
            : urlOf(input) === PING
              ? 'OK (not found)'
              : '',
        ),
      ),
    )
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(worker.scheduled(undefined, { HC_UP_URL: PING })).rejects.toThrow(
      /^the ping to healthchecks\.io reached no check: «OK \(not found\)»; HC_LOCK_URL is not an https URL/,
    )
  })

  it('runs both rounds and fails for neither when both are told', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = urlOf(input)
      if (url === 'https://grafana.molvia.net/public-dashboards/watch')
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://molvia.cloudflareaccess.com/cdn-cgi/access/login/x' },
          }),
        )
      return Promise.resolve(
        new Response(
          url.endsWith('/api/health') ? HEALTHY : url.startsWith('https://hc-ping') ? 'OK' : '',
        ),
      )
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await worker.scheduled(undefined, { HC_UP_URL: UP, HC_LOCK_URL: LOCK })
    expect(
      sorted(
        fetch.mock.calls
          .map(([input]) => urlOf(input))
          .filter((url) => url.startsWith('https://hc-ping')),
      ),
    ).toEqual(sorted([LOCK, UP]))
  })
})

const sorted = (values: string[]): string[] => values.toSorted()
