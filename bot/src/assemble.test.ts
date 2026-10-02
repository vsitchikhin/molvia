import { format } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot, HttpError } from 'grammy'
import type { Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import type { MolviaBotClient } from '@molvia/client'
import type { LoginPreview } from '@molvia/model'
import { assembleBot, introduce, startBot, telegramFailure } from './assemble'

const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: 'Molvia',
  username: 'molvia_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
}

const PREVIEW: LoginPreview = {
  deviceName: 'iPhone · Safari',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 5 * 60_000),
  confirmed: false,
}

const HELD_MS = 300

function start(updateId: number, chatId: number, code: string): Update {
  const chat = { id: chatId, type: 'private' as const, first_name: 'U' }
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat,
      from: { id: chatId, is_bot: false, first_name: 'U' },
      text: `/start ${code}`,
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  }
}

/**
 * Two `/start` updates in one batch, the first of which the API holds for `HELD_MS`. Answers
 * with how much later the second reached the API than the first.
 *
 * The real `startBot` and the real wiring: what is being measured is the order these two
 * middlewares are installed in, so faking the runner would measure nothing.
 */
async function lagBetween(updates: readonly [Update, Update]): Promise<number> {
  const first = 'a'.repeat(43)
  const reached: Record<string, number> = {}
  const begun = Date.now()

  const api: Partial<MolviaBotClient> = {
    previewLogin: (code) => {
      reached[code] = Date.now() - begun
      return new Promise((resolve) =>
        setTimeout(
          () => {
            resolve(PREVIEW)
          },
          code === first ? HELD_MS : 0,
        ),
      )
    },
    // Every `/start` also says the bot is not blocked (MOL-103); not waited for, so it delays nothing.
    switchReminders: () => Promise.resolve(),
  }

  let served = false
  const bot = assembleBot(
    '42:TEST',
    { api: api as MolviaBotClient, appUrl: 'https://molvia.test' },
    { botInfo: BOT_INFO },
  )
  const transformer: Transformer = async (_prev, method) => {
    if (method === 'getUpdates') {
      if (served) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { ok: true, result: [] } as never
      }
      served = true
      return { ok: true, result: updates } as never
    }
    return { ok: true, result: { message_id: 1 } } as never
  }
  bot.api.config.use(transformer)

  const runner = startBot(bot)
  await new Promise((resolve) => setTimeout(resolve, HELD_MS + 250))
  await runner.stop()

  const second = 'b'.repeat(43)
  expect(reached[first]).toBeDefined()
  expect(reached[second]).toBeDefined()
  return (reached[second] ?? 0) - (reached[first] ?? 0)
}

describe('как бот разбирает апдейты', () => {
  it('двое людей обслуживаются одновременно, а не по очереди', async () => {
    // Через `bot.start()` запрос второго не уходил в API, пока API думал над первым: замерено
    // 290+ мс при задержке 300 (О-4). В бою это таймаут клиента, то есть до 15 секунд на
    // апдейт, и коды в хвосте очереди истекают, не дойдя до обработчика.
    const lag = await lagBetween([start(1, 1001, 'a'.repeat(43)), start(2, 1002, 'b'.repeat(43))])

    expect(lag).toBeLessThan(HELD_MS / 2)
  })

  it('а два нажатия одного человека — по порядку', async () => {
    // Вторая половина того же правила, и она тоже нужна: два подтверждения одного человека
    // в полёте разом решали бы исход тем, чей ответ вернулся первым, а не тем, что он нажал.
    const lag = await lagBetween([start(1, 1001, 'a'.repeat(43)), start(2, 1001, 'b'.repeat(43))])

    expect(lag).toBeGreaterThanOrEqual(HELD_MS - 20)
  })
})

describe('отказ getUpdates в журнале (MOL-142)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('пишется по виду, и токена бота в нём нет (адверсариал, раунд 2 Г2)', async () => {
    // grammY's network error carries the request's address, and the token is in it; the runner
    // used to print it whole on every failed try.
    const TOKEN = '123456:AAE-secret-token-of-the-bot'
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(format(...args))
    })
    // Nothing listens on port 9: every getUpdates fails at the network, as with Telegram away.
    const bot = assembleBot(TOKEN, {} as never, {
      botInfo: BOT_INFO,
      client: { apiRoot: 'http://127.0.0.1:9' },
    })
    const runner = startBot(bot)
    for (let waited = 0; lines.length < 3 && waited < 5_000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await runner.stop()

    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(new Set(lines)).toEqual(new Set(['[molvia] telegram getUpdates: network']))
    expect(lines.join('\n')).not.toContain('secret-token')
  })
})

describe('кто бот — до раннера (MOL-142)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** A bot whose `getMe` answers by `telegram()`: itself, or a refusal with a code. */
  function botAsking(telegram: () => 'up' | { code: number; retryAfter?: number }) {
    const bot = new Bot('42:TEST')
    const calls: number[] = []
    const stub: Transformer = (_prev, method) => {
      calls.push(Date.now())
      const state = telegram()
      if (method !== 'getMe' || state === 'up') {
        return Promise.resolve({ ok: true, result: BOT_INFO }) as never
      }
      return Promise.resolve({
        ok: false,
        error_code: state.code,
        description: 'refused',
        ...(state.retryAfter === undefined
          ? {}
          : { parameters: { retry_after: state.retryAfter } }),
      }) as never
    }
    bot.api.config.use(stub)
    return { bot, calls }
  }

  it('Telegram лежал полчаса со старта — после возвращения бот знакомится за секунды (адверсариал, раунд 3 Д1)', async () => {
    vi.useFakeTimers()
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(format(...args))
    })
    let down = true
    const { bot, calls } = botAsking(() => (down ? { code: 502 } : 'up'))

    const introduced = introduce(bot)
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(bot.isInited()).toBe(false)

    down = false
    const back = Date.now()
    await vi.advanceTimersByTimeAsync(30_000)
    await introduced

    expect(bot.isInited()).toBe(true)
    // grammY's own retry doubled its pause to twenty minutes; growing by a tenth of a second a
    // try, half an hour of refusals leaves it at some twenty seconds.
    expect((calls.at(-1) ?? Infinity) - back).toBeLessThan(30_000)
    expect(new Set(lines)).toEqual(new Set(['[molvia] telegram getMe: 502']))
  })

  it('429 ждёт, сколько просит Telegram', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let tries = 0
    const { bot, calls } = botAsking(() => (tries++ === 0 ? { code: 429, retryAfter: 7 } : 'up'))

    const introduced = introduce(bot)
    await vi.advanceTimersByTimeAsync(6_999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await introduced

    expect(bot.isInited()).toBe(true)
  })

  it('4xx, кроме 429, не повторяет — бросает: 401 — токен отозван, 404 — токен не того вида (раунд 4 Е1)', async () => {
    for (const code of [400, 401, 403, 404]) {
      const { bot, calls } = botAsking(() => ({ code }))

      await expect(introduce(bot)).rejects.toMatchObject({ error_code: code })
      expect(calls).toHaveLength(1)
    }
  })

  it('5xx повторяет', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const codes = [500, 503]
    const { bot, calls } = botAsking(() => {
      const code = codes.shift()
      return code === undefined ? 'up' : { code }
    })

    const introduced = introduce(bot)
    await vi.advanceTimersByTimeAsync(1_000)
    await introduced

    expect(calls).toHaveLength(3)
    expect(bot.isInited()).toBe(true)
  })

  it('остановка прерывает ожидание, и бот не представлен', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot } = botAsking(() => ({ code: 502 }))
    const stopping = new AbortController()

    const introduced = introduce(bot, stopping.signal)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    stopping.abort()
    await introduced

    expect(bot.isInited()).toBe(false)
  })

  it('отказ Telegram в журнале — по виду; токен из адреса запроса не печатается (раунд 3 Д2)', () => {
    const TOKEN = '123456:AAE-secret-token-of-the-bot'
    const network = new HttpError(
      "Network request for 'getUpdates' failed!",
      new Error(`request to https://api.telegram.org/bot${TOKEN}/getUpdates failed`),
    )

    expect(telegramFailure(network)).toBe('network')
    expect(telegramFailure(new Error(TOKEN))).toBe('unexpected')
  })
})
