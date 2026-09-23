import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type { LoginPreview } from '@molvia/model'
import { loginComposer } from './login'

/**
 * A bot that never reaches Telegram: `botInfo` spares it the `getMe` call at start, and a
 * transformer answers every outgoing method itself. Nothing here touches the network, and the
 * API is a fake — the real client is MOL-54's and tested there.
 */
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

const CODE = 'a'.repeat(43)
const APP_URL = 'https://molvia.test'
const PREVIEW: LoginPreview = {
  deviceName: 'iPhone · Safari',
  createdAt: new Date('2026-09-23T12:00:00Z'),
  expiresAt: new Date('2026-09-23T12:05:00Z'),
}

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

function harness(
  api: Partial<MolviaBotClient> = {},
  options: { readonly failing?: readonly string[] } = {},
): { bot: Bot; calls: Call[] } {
  const calls: Call[] = []
  const bot = new Bot('42:TEST', { botInfo: BOT_INFO })
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload: payload })
    if (options.failing?.includes(method)) {
      return Promise.resolve({
        ok: false,
        error_code: 400,
        description: 'Bad Request: message is not modified',
      }) as never
    }
    return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
  }
  bot.api.config.use(transformer)
  bot.use(loginComposer({ api: api as MolviaBotClient, appUrl: APP_URL }))
  return { bot, calls }
}

const FROM = { id: 777, is_bot: false, first_name: 'Вова' }
const CHAT = { id: 777, type: 'private' as const, first_name: 'Вова' }

function message(text: string, over: Record<string, unknown> = {}): Update {
  const command = text.startsWith('/')
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 0,
      chat: CHAT,
      from: FROM,
      text,
      ...(command
        ? {
            entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]?.length ?? 0 }],
          }
        : {}),
      ...over,
    },
  }
}

function press(data: string, over: Record<string, unknown> = {}): Update {
  return {
    update_id: 2,
    callback_query: {
      id: 'cb1',
      from: FROM,
      chat_instance: 'ci',
      data,
      message: { message_id: 10, date: 0, chat: CHAT, from: { ...FROM, id: 42, is_bot: true } },
      ...over,
    },
  }
}

const sent = (calls: Call[], method: string): Record<string, unknown> | undefined =>
  calls.find((call) => call.method === method)?.payload

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('/start с кодом', () => {
  it('называет устройство, время и даёт две кнопки', async () => {
    const previewLogin = vi.fn().mockResolvedValue(PREVIEW)
    const { bot, calls } = harness({ previewLogin })

    await bot.handleUpdate(message(`/start ${CODE}`))

    expect(previewLogin).toHaveBeenCalledExactlyOnceWith(CODE)
    const payload = sent(calls, 'sendMessage')
    expect(payload?.text).toContain('iPhone · Safari')
    expect(payload?.text).toContain('назад')
    expect(payload?.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Войти', callback_data: `login:ok:${CODE}` },
          { text: 'Это не я', callback_data: `login:no:${CODE}` },
        ],
      ],
    })
  })

  it('просмотр ничего не подтверждает', async () => {
    const confirmLogin = vi.fn()
    const { bot } = harness({ previewLogin: vi.fn().mockResolvedValue(PREVIEW), confirmLogin })

    await bot.handleUpdate(message(`/start ${CODE}`))

    expect(confirmLogin).not.toHaveBeenCalled()
  })

  it('запрос без устройства называется своими словами, а не пустотой', async () => {
    const preview = { ...PREVIEW, deviceName: null }
    const { bot, calls } = harness({ previewLogin: vi.fn().mockResolvedValue(preview) })

    await bot.handleUpdate(message(`/start ${CODE}`))

    expect(sent(calls, 'sendMessage')?.text).toContain('неизвестное устройство')
  })

  it('мёртвый и мусорный код — один и тот же ответ', async () => {
    // Истёкший, погашенный, отклонённый и неизвестный приходят как `login_unavailable` от API;
    // код, которого не могло быть ни в одной строке, до сети не доходит вовсе — его режет сам
    // клиент, и человеку это та же мёртвая ссылка.
    const dead = harness({
      previewLogin: vi.fn().mockRejectedValue(new ApiError(ERROR.LOGIN_UNAVAILABLE)),
    })
    await dead.bot.handleUpdate(message(`/start ${CODE}`))

    const junk = harness({
      previewLogin: vi.fn().mockRejectedValue(new ApiError(ISSUE.PATH_INVALID, 'code')),
    })
    await junk.bot.handleUpdate(message('/start ../health'))

    const text = 'Ссылка больше не действует. Начните вход заново в приложении.'
    expect(sent(dead.calls, 'sendMessage')?.text).toBe(text)
    expect(sent(junk.calls, 'sendMessage')?.text).toBe(text)
  })

  it('код, который не поместится на кнопку, не уходит даже в API', async () => {
    // Схема допускает 64 символа, кнопка Telegram — 64 байта вместе с префиксом. Показать
    // приглашение без кнопок нельзя: кнопка и есть смысл этой задачи.
    const previewLogin = vi.fn()
    const { bot, calls } = harness({ previewLogin })

    await bot.handleUpdate(message(`/start ${'b'.repeat(60)}`))

    expect(previewLogin).not.toHaveBeenCalled()
    expect(sent(calls, 'sendMessage')?.text).toContain('больше не действует')
  })

  it('упавший API — не мёртвая ссылка, и в логе нет апдейта', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness({
      previewLogin: vi.fn().mockRejectedValue(new ApiError(ERROR.INTERNAL, 'fetch failed', false)),
    })

    await bot.handleUpdate(message(`/start ${CODE}`))

    expect(sent(calls, 'sendMessage')?.text).toBe('Не получилось. Попробуйте ещё раз через минуту.')
    expect(log).toHaveBeenCalledExactlyOnceWith('[molvia] preview login: error.internal')
    for (const [line] of log.mock.calls) {
      expect(String(line)).not.toContain(CODE)
      expect(String(line)).not.toContain('Вова')
    }
  })
})

describe('кнопки', () => {
  it('«Войти» подтверждает аккаунтом Telegram и снимает кнопки', async () => {
    const confirmLogin = vi.fn().mockResolvedValue(undefined)
    const { bot, calls } = harness({ confirmLogin })

    await bot.handleUpdate(press(`login:ok:${CODE}`))

    expect(confirmLogin).toHaveBeenCalledExactlyOnceWith(CODE, FROM.id)
    const edit = sent(calls, 'editMessageText')
    expect(edit?.text).toContain('Вход подтверждён')
    expect(edit?.reply_markup).toBeUndefined()
    expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true)
  })

  it('«Это не я» гасит запрос', async () => {
    const declineLogin = vi.fn().mockResolvedValue(undefined)
    const confirmLogin = vi.fn()
    const { bot, calls } = harness({ declineLogin, confirmLogin })

    await bot.handleUpdate(press(`login:no:${CODE}`))

    expect(declineLogin).toHaveBeenCalledExactlyOnceWith(CODE)
    expect(confirmLogin).not.toHaveBeenCalled()
    expect(sent(calls, 'editMessageText')?.text).toContain('Вход отклонён')
  })

  it('нажатая второй раз кнопка второго входа не выдаёт', async () => {
    // Держит это API: `confirm` берёт строку, только пока она ждёт ответа. Бот обязан
    // показать это мёртвой ссылкой, а не «готово» второй раз.
    const confirmLogin = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(ERROR.LOGIN_UNAVAILABLE))
    const { bot, calls } = harness({ confirmLogin })

    await bot.handleUpdate(press(`login:ok:${CODE}`))
    await bot.handleUpdate(press(`login:ok:${CODE}`))

    expect(confirmLogin).toHaveBeenCalledTimes(2)
    const edits = calls.filter((call) => call.method === 'editMessageText')
    expect(String(edits[0]?.payload.text)).toContain('Вход подтверждён')
    expect(String(edits[1]?.payload.text)).toContain('больше не действует')
  })

  it('часик на кнопке гасится и тогда, когда ответить не удалось вовсе', async () => {
    // Ни переписать, ни прислать заново — то есть Telegram отказывает на обоих путях. Ответ
    // человек потеряет, но крутящийся часик под пальцем остаётся навсегда, поэтому гашение
    // стоит в `finally`, а не следом за удачей.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness(
      { confirmLogin: vi.fn().mockRejectedValue(new ApiError(ERROR.INTERNAL, 'down', false)) },
      { failing: ['editMessageText', 'sendMessage'] },
    )

    await expect(bot.handleUpdate(press(`login:ok:${CODE}`))).rejects.toThrow()

    expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true)
  })

  it('сообщение, которое нельзя переписать, отвечается новым', async () => {
    const { bot, calls } = harness(
      { declineLogin: vi.fn().mockResolvedValue(undefined) },
      { failing: ['editMessageText'] },
    )

    await bot.handleUpdate(press(`login:no:${CODE}`))

    expect(sent(calls, 'sendMessage')?.text).toContain('Вход отклонён')
  })
})

describe('чужой чат и прочие сообщения', () => {
  it('в группе бот не отвечает и ничего не подтверждает', async () => {
    const confirmLogin = vi.fn()
    const previewLogin = vi.fn()
    const group = { id: -100, type: 'supergroup' as const, title: 'Соседи' }
    const { bot, calls } = harness({ confirmLogin, previewLogin })

    await bot.handleUpdate(message(`/start ${CODE}`, { chat: group }))
    await bot.handleUpdate(
      press(`login:ok:${CODE}`, { message: { message_id: 10, date: 0, chat: group } }),
    )

    expect(previewLogin).not.toHaveBeenCalled()
    expect(confirmLogin).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('/start без кода и любой другой текст — приветствие со ссылкой', async () => {
    const { bot, calls } = harness()

    await bot.handleUpdate(message('/start'))
    await bot.handleUpdate(message('удалите мои данные'))

    const texts = calls
      .filter((call) => call.method === 'sendMessage')
      .map((call) => call.payload.text)
    expect(texts).toHaveLength(2)
    for (const text of texts) expect(String(text)).toContain(APP_URL)
  })

  it('язык человека — из его профиля', async () => {
    const { bot, calls } = harness({ previewLogin: vi.fn().mockResolvedValue(PREVIEW) })

    await bot.handleUpdate(message(`/start ${CODE}`, { from: { ...FROM, language_code: 'en-GB' } }))

    const payload = sent(calls, 'sendMessage')
    expect(payload?.text).toContain('Device: iPhone · Safari')
    expect(payload?.reply_markup).toMatchObject({
      inline_keyboard: [[{ text: 'Sign in' }, { text: 'Not me' }]],
    })
  })
})
