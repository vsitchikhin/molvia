import { afterEach, describe, expect, it, vi } from 'vitest'
import { PULSE_EVERY_MS, createPulse } from './pulse'

const PING = 'https://hc-ping.com/0f1e2d3c-secret'

/** A clock the test moves by hand, and a fetch that answers what it is told to. */
function rig(answer: () => Promise<Response> = async () => Promise.resolve(new Response('OK'))) {
  let time = 1_000_000
  const fetch = vi.fn<typeof globalThis.fetch>(answer)
  const beat = createPulse(PING, { fetch, now: () => time })
  return {
    beat,
    fetch,
    later: (ms: number) => {
      time += ms
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('пульс бота (MOL-142)', () => {
  it('без URL — ни одного запроса', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    for (const url of [undefined, '']) {
      const beat = createPulse(url, { fetch })
      await beat()
      await beat()
    }

    expect(fetch).not.toHaveBeenCalled()
  })

  it('первый удар уходит сразу, на тот самый URL', async () => {
    const { beat, fetch } = rig()

    await beat()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe(PING)
  })

  it('не чаще раза в пять минут: без миллисекунды — нет, ровно пять — да', async () => {
    const { beat, fetch, later } = rig()

    await beat()
    later(PULSE_EVERY_MS - 1)
    await beat()
    expect(fetch).toHaveBeenCalledTimes(1)

    later(1)
    await beat()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('неудачный пинг не считается: следующий вызов пробует снова, и ничего не бросает', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const answers = [
      async () => Promise.reject(new TypeError('fetch failed')),
      async () => Promise.resolve(new Response('nope', { status: 500 })),
      async () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    ]
    const { beat, fetch, later } = rig(
      async () => answers.shift()?.() ?? Promise.resolve(new Response('OK')),
    )

    for (let minute = 0; minute < 5; minute += 1) {
      await expect(beat()).resolves.toBeUndefined()
      later(60_000)
    }

    // Three failures a minute apart, the fourth minute a success, and the fifth quiet after it.
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual([
      '[molvia] pulse: network',
      '[molvia] pulse: 500',
      '[molvia] pulse: timeout',
    ])
  })

  it('URL не попадает в лог ни при каком отказе', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const refusals = [
      async () => Promise.reject(new TypeError(`fetch failed: ${PING}`)),
      async () => Promise.resolve(new Response(PING, { status: 404, statusText: PING })),
      async () => Promise.reject(new DOMException(`timed out: ${PING}`, 'TimeoutError')),
    ]

    for (const refusal of refusals) await rig(refusal).beat()

    expect(error).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret')
  })

  it('пока пинг идёт, второго нет', async () => {
    let release: (response: Response) => void = () => undefined
    const { beat, fetch } = rig(
      async () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )

    const first = beat()
    const second = beat()
    release(new Response('OK'))
    await Promise.all([first, second])

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
