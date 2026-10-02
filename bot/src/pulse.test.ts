import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import type { MolviaBotClient } from '@molvia/client'
import { startBot } from './assemble'
import { HEARD_WITHIN_MS, PULSE_EVERY_MS, createPulse, hearTelegram } from './pulse'
import { startReminders } from './remind'

const PING = 'https://hc-ping.com/0f1e2d3c-secret'
const MINUTE = 60_000

/** A clock the test moves by hand, and a fetch that answers what it is told to. */
function rig(
  answer: () => Promise<Response> = async () => Promise.resolve(new Response('OK')),
  listening: () => boolean = () => true,
) {
  let time = 1_000_000
  const fetch = vi.fn<typeof globalThis.fetch>(answer)
  const beat = createPulse(PING, { fetch, now: () => time, listening })
  return {
    beat,
    fetch,
    later: (ms: number) => {
      time += ms
    },
  }
}

/** A bot whose `getUpdates` answers by `telegram()`: a long poll of thirty seconds, or a refusal. */
function botOf(telegram: () => 'up' | 502 | 409) {
  const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
  const transformer: Transformer = (_prev, method) => {
    if (method !== 'getUpdates') return Promise.resolve({ ok: true, result: true }) as never
    const state = telegram()
    if (state !== 'up') {
      return Promise.resolve({ ok: false, error_code: state, description: 'refused' }) as never
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ ok: true, result: [] })
      }, 30_000)
    }) as never
  }
  bot.api.config.use(transformer)
  return bot
}

/** The wiring of `index.ts`: the listener, the runner, the reminders beating the pulse. */
function wire(bot: Bot, fetch: typeof globalThis.fetch) {
  const pulse = createPulse(PING, { fetch, listening: hearTelegram(bot) })
  const runner = startBot(bot)
  const claiming = { claimReminders: vi.fn(async () => Promise.resolve({ reminders: [] })) }
  const stop = startReminders(
    claiming as unknown as MolviaBotClient,
    bot.api,
    'https://molvia.test',
    MINUTE,
    () => {
      void pulse()
    },
  )
  return { runner, stop }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('пульс бота (MOL-142)', () => {
  it('без URL — ни одного запроса', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    for (const url of [undefined, '']) {
      const beat = createPulse(url, { fetch, now: () => 0 })
      await beat()
      await beat()
    }

    expect(fetch).not.toHaveBeenCalled()
  })

  it('первый удар — не раньше пяти минут жизни процесса, и на тот самый URL', async () => {
    // A process in a crash loop never lives that long, so it never says «alive» (adversarial А2).
    const { beat, fetch, later } = rig()

    await beat()
    later(PULSE_EVERY_MS - 1)
    await beat()
    expect(fetch).not.toHaveBeenCalled()

    later(1)
    await beat()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe(PING)
  })

  it('не чаще раза в пять минут: без миллисекунды — нет, ровно пять — да', async () => {
    const { beat, fetch, later } = rig()
    later(PULSE_EVERY_MS)

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
    later(PULSE_EVERY_MS)

    for (let minute = 0; minute < 5; minute += 1) {
      await expect(beat()).resolves.toBeUndefined()
      later(MINUTE)
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

    for (const refusal of refusals) {
      const { beat, later } = rig(refusal)
      later(PULSE_EVERY_MS)
      await beat()
    }

    expect(error).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret')
  })

  it('пока пинг идёт, второго нет', async () => {
    let release: (response: Response) => void = () => undefined
    const { beat, fetch, later } = rig(
      async () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    later(PULSE_EVERY_MS)

    const first = beat()
    const second = beat()
    release(new Response('OK'))
    await Promise.all([first, second])

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('бот не слышит Telegram — удара нет и он не засчитан; услышал — бьёт сразу', async () => {
    let hears = false
    const { beat, fetch, later } = rig(undefined, () => hears)
    later(PULSE_EVERY_MS)

    await beat()
    expect(fetch).not.toHaveBeenCalled()

    hears = true
    await beat()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('часы монотонные: шаг стенных часов назад пульс не глушит (адверсариал А3)', async () => {
    let mono = 0
    vi.spyOn(performance, 'now').mockImplementation(() => mono)
    const wall = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 2, 19, 0))
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Promise.resolve(new Response('OK')))
    const beat = createPulse(PING, { fetch })

    mono += PULSE_EVERY_MS
    await beat()
    wall.mockReturnValue(Date.UTC(2026, 9, 2, 18, 0))
    mono += PULSE_EVERY_MS
    await beat()

    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('слух Telegram (MOL-142)', () => {
  it('слышит, пока удачный getUpdates был не дольше двух минут назад; отказ не в счёт', async () => {
    let time = 0
    let up = false
    const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
    const telegram: Transformer = () =>
      (up
        ? Promise.resolve({ ok: true, result: [] })
        : Promise.resolve({ ok: false, error_code: 502, description: 'Bad Gateway' })) as never
    bot.api.config.use(telegram)
    // Installed last, so it wraps Telegram — as in `index.ts`, where Telegram is the network.
    const heard = hearTelegram(bot, () => time)

    expect(heard()).toBe(false)
    await bot.api.getUpdates().catch(() => undefined)
    expect(heard()).toBe(false)

    up = true
    await bot.api.getUpdates()
    expect(heard()).toBe(true)

    time += HEARD_WITHIN_MS - 1
    expect(heard()).toBe(true)
    time += 1
    expect(heard()).toBe(false)
  })

  it('Telegram лежит полчаса — пульса нет; вернулся — слышен за секунды, пульс бьётся (адверсариал А1)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let telegram: 'up' | 502 = 502
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Promise.resolve(new Response('OK')))
    const { runner, stop } = wire(
      botOf(() => telegram),
      fetch,
    )

    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(fetch).not.toHaveBeenCalled()
    expect(runner.isRunning()).toBe(true)

    // The pause the runner grew in half an hour is some twenty seconds, not the default's ~27
    // minutes: within two minutes of Telegram's return the bot hears it and the pulse beats.
    telegram = 'up'
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(fetch).toHaveBeenCalledTimes(1)

    await stop()
    const stopped = runner.stop()
    await vi.advanceTimersByTimeAsync(30_000)
    await stopped
  })

  it('409 — раннер упал, и ни одного пульса из этого запуска (адверсариал А2)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Promise.resolve(new Response('OK')))
    const { runner, stop } = wire(
      botOf(() => 409),
      fetch,
    )

    const died = runner.task()?.then(
      () => false,
      () => true,
    )
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    await stop()

    expect(await died).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})
