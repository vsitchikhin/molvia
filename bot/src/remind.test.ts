import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { Reminder } from '@molvia/model'
import { t } from './i18n'
import {
  RETRY_AFTER_CAP_SECONDS,
  SCALE_DATA,
  SWITCH_DATA,
  keyboardOf,
  readText,
  remindDue,
  reminderText,
  scale,
  startReminders,
  writeText,
} from './remind'

const APP = 'https://molvia.test'
const MILK = '5b0e7c0e-6d3e-4a53-9c4a-1f1f0b7e2a11'
const item = (name: string, daysAgo = 1, itemId = MILK) => ({
  itemId,
  name,
  placeName: 'Ереван Сити',
  daysAgo,
})

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

/**
 * Telegram, faked: every call recorded, the chats in `blocked` answering 403, and the first
 * `throttled` calls answering 429 with `retry_after`.
 */
function telegram(blocked: readonly number[] = [], throttled = 0, retryAfter = 3) {
  const calls: Call[] = []
  let limited = throttled
  const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload })
    const chat = (payload as { readonly chat_id?: number }).chat_id ?? 0
    if (limited > 0) {
      limited -= 1
      return Promise.resolve({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 3',
        parameters: { retry_after: retryAfter },
      }) as never
    }
    if (blocked.includes(chat)) {
      return Promise.resolve({
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      }) as never
    }
    return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
  }
  bot.api.config.use(transformer)
  return { api: bot.api, calls }
}

const claiming = (reminders: Reminder[]): Partial<MolviaBotClient> => ({
  claimReminders: vi.fn(() => Promise.resolve({ reminders })),
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('текст напоминания', () => {
  it('когда и где, товар и смысл шкалы — всегда по-русски', () => {
    expect(reminderText(item('Молоко Ашхар 1 л'), 0, APP)).toBe(
      'Вчера · Ереван Сити\nМолоко Ашхар 1 л — как вам?\n1 — плохо, 5 — отлично',
    )
    expect(reminderText(item('Хлеб', 2), 0, APP)).toMatch(/^Позавчера · /)
    expect(reminderText(item('Сыр', 11), 0, APP)).toMatch(/^11 дн\. назад · /)
  })

  it('город места — в предложном падеже, город не из словаря — в скобках (MOL-120)', () => {
    expect(reminderText(item('Молоко'), 0, APP, 'Ереван')).toMatch(
      /^Вчера · Ереван Сити в Ереване\n/,
    )
    expect(reminderText(item('Молоко'), 0, APP, 'Ванадзор')).toMatch(
      /^Вчера · Ереван Сити \(Ванадзор\)\n/,
    )
  })

  it('адрес приложения со слешем на конце не даёт двойного слеша', () => {
    expect(reminderText(item('Молоко'), 1, `${APP}/`)).toContain(`${APP}/verdicts`)
    expect(reminderText(item('Молоко'), 1, `${APP}/`)).not.toContain('//verdicts')
  })

  it('под последним — сколько ещё ждут в «Оценках», со ссылкой', () => {
    expect(reminderText(item('Молоко'), 2, APP)).toBe(
      `${reminderText(item('Молоко'), 0, APP)}\n\n${t(undefined, 'remind.more', {
        n: 2,
        url: `${APP}/verdicts`,
      })}`,
    )
  })
})

describe('шкала', () => {
  it('пять кнопок, в каждой только позиция и цифра', () => {
    const buttons = scale(MILK).inline_keyboard.flat()
    expect(buttons.map((button) => button.text)).toEqual(['1', '2', '3', '4', '5'])
    for (const button of buttons) {
      const data = 'callback_data' in button ? button.callback_data : ''
      expect(data).toMatch(SCALE_DATA)
      expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64)
    }
  })
})

describe('строка выключателя и итоги в тексте (MOL-103)', () => {
  it('кнопка несёт только действие', () => {
    for (const offer of ['off', 'on'] as const) {
      const [button] = scale(MILK, undefined, offer).inline_keyboard[1] ?? []
      const data = button && 'callback_data' in button ? button.callback_data : ''
      expect(data).toBe(`remind:${offer}`)
      expect(data).toMatch(SWITCH_DATA)
    }
    expect(scale(MILK).inline_keyboard).toHaveLength(1)
  })

  it('клавиатура читается обратно: позиция, нажатая цифра, предложенное действие', () => {
    expect(keyboardOf(scale(MILK, 4, 'on'))).toEqual({ itemId: MILK, pressed: 4, offer: 'on' })
    expect(keyboardOf(scale(MILK))).toEqual({ itemId: MILK })
    expect(keyboardOf(undefined)).toEqual({})
    expect(keyboardOf(scale(undefined, undefined, 'off')).offer).toBe('off')
  })

  it('итог оценки и итог выключателя не стирают друг друга, в любом порядке', () => {
    const question = reminderText(item('Хлеб'), 2, APP)
    const stopped = t('ru', 'remind.stopped')
    const rated = t('ru', 'rate.done', { score: 4 })
    const both = writeText({ question, rated, switched: stopped })

    expect(readText(both)).toEqual({ question, rated, switched: stopped })
    expect(readText(writeText({ question, switched: stopped }))).toEqual({
      question,
      switched: stopped,
    })
    expect(readText(question)).toEqual({ question })
    expect(readText(writeText({ ...readText(both), rated: '5' }))).toEqual({
      question,
      rated: '5',
      switched: stopped,
    })
    // English outcomes carry the same marks.
    expect(readText(writeText({ question, switched: t('en', 'remind.resumed') })).switched).toBe(
      t('en', 'remind.resumed'),
    )
  })
})

describe('рассылка (MOL-101)', () => {
  it('сообщение на позицию, звенит только первое, «ещё» — только под последним', async () => {
    const { api, calls } = telegram()
    const reminders = [
      {
        telegramUserId: 777,
        items: [item('Кефир'), item('Сыр'), item('Хлеб')],
        total: 5,
      },
    ]

    await remindDue(claiming(reminders) as MolviaBotClient, api, APP)

    expect(calls.map((call) => call.payload.chat_id)).toEqual([777, 777, 777])
    expect(calls.map((call) => call.payload.disable_notification)).toEqual([false, true, true])
    expect(calls.map((call) => call.payload.text)).toEqual([
      reminderText(item('Кефир'), 0, APP),
      reminderText(item('Сыр'), 0, APP),
      reminderText(item('Хлеб'), 2, APP),
    ])
    expect(calls[0]?.payload.reply_markup).toEqual(scale(MILK))
  })

  it('город — только где два места напоминания носят одно имя (MOL-120)', async () => {
    const { api, calls } = telegram()
    const at = (name: string, placeName: string, placeCity?: string) => ({
      ...item(name),
      placeName,
      ...(placeCity === undefined ? {} : { placeCity }),
    })
    const reminders = [
      {
        telegramUserId: 777,
        items: [
          at('Кефир', 'Ереван Сити', 'Ереван'),
          at('Сыр', 'SAS', 'Ереван'),
          at('Хлеб', 'Ереван Сити', 'Гюмри'),
        ],
        total: 3,
      },
      // An API before MOL-120 sends no city: the names stay as they were.
      { telegramUserId: 778, items: [at('Кефир', 'SAS'), at('Хлеб', 'SAS', 'Гюмри')], total: 2 },
    ]

    await remindDue(claiming(reminders) as MolviaBotClient, api, APP)

    expect(calls.map((call) => String(call.payload.text).split('\n')[0])).toEqual([
      'Вчера · Ереван Сити в Ереване',
      'Вчера · SAS',
      'Вчера · Ереван Сити в Гюмри',
      'Вчера · SAS',
      'Вчера · SAS',
    ])
  })

  it('«Не напоминать» — только под последним сообщением вечера (MOL-103, В-2)', async () => {
    const { api, calls } = telegram()
    const reminders = [
      { telegramUserId: 777, items: [item('Кефир'), item('Сыр'), item('Хлеб')], total: 3 },
      { telegramUserId: 888, items: [item('Молоко')], total: 1 },
    ]

    await remindDue(claiming(reminders) as MolviaBotClient, api, APP)

    expect(calls.map((call) => keyboardOf(call.payload.reply_markup as never).offer)).toEqual([
      undefined,
      undefined,
      'off',
      'off',
    ])
    expect(calls[2]?.payload.reply_markup).toEqual(scale(MILK, undefined, 'off'))
  })

  it('заблокировавший бота не останавливает остальных, ему дальше не шлём и напоминания выключаем', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram([777])
    const switchReminders = vi.fn(() => Promise.resolve())
    const reminders = [
      { telegramUserId: 777, items: [item('Кефир'), item('Сыр')], total: 2 },
      { telegramUserId: 888, items: [item('Хлеб')], total: 1 },
    ]

    await remindDue({ ...claiming(reminders), switchReminders } as MolviaBotClient, api, APP)

    expect(calls.map((call) => call.payload.chat_id)).toEqual([777, 888])
    expect(switchReminders.mock.calls).toEqual([[777, 'blocked']])
    // The code, never the chat.
    expect(error.mock.calls.flat().join(' ')).not.toContain('777')
    expect(error.mock.calls.flat().join(' ')).toContain('403')
  })

  it('API не принял выключение после 403 — в журнал по коду, остальные получают своё', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram([777])
    const switchReminders = vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    const reminders = [
      { telegramUserId: 777, items: [item('Кефир')], total: 1 },
      { telegramUserId: 888, items: [item('Хлеб')], total: 1 },
    ]

    await remindDue({ ...claiming(reminders), switchReminders } as MolviaBotClient, api, APP)

    expect(calls.map((call) => call.payload.chat_id)).toEqual([777, 888])
    expect(error.mock.calls.flat().join(' ')).toContain(`remind blocked: ${ERROR.INTERNAL}`)
    expect(error.mock.calls.flat().join(' ')).not.toContain('777')
  })

  it('другая ошибка отправки напоминания не выключает', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api } = telegram([], 1, RETRY_AFTER_CAP_SECONDS + 1)
    const switchReminders = vi.fn(() => Promise.resolve())

    await remindDue(
      {
        ...claiming([{ telegramUserId: 777, items: [item('Кефир')], total: 1 }]),
        switchReminders,
      } as MolviaBotClient,
      api,
      APP,
    )

    expect(switchReminders).not.toHaveBeenCalled()
  })

  it('429: ждёт, сколько сказал Telegram, и повторяет один раз', async () => {
    const { api, calls } = telegram([], 1, 3)
    const waited: number[] = []
    const wait = (ms: number) => {
      waited.push(ms)
      return Promise.resolve(true)
    }

    await remindDue(
      claiming([{ telegramUserId: 777, items: [item('Кефир')], total: 1 }]) as MolviaBotClient,
      api,
      APP,
      wait,
    )

    expect(waited).toEqual([3000])
    expect(calls.map((call) => call.payload.chat_id)).toEqual([777, 777])
  })

  it('429 дольше потолка — остаток прогона бросается сразу, без ожиданий (адверсариальный З)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram([], 100, RETRY_AFTER_CAP_SECONDS + 50)
    const waited: number[] = []
    const wait = (ms: number) => {
      waited.push(ms)
      return Promise.resolve(true)
    }

    await remindDue(
      claiming([
        { telegramUserId: 777, items: [item('Кефир'), item('Сыр')], total: 2 },
        { telegramUserId: 888, items: [item('Хлеб')], total: 1 },
      ]) as MolviaBotClient,
      api,
      APP,
      wait,
    )

    expect(waited).toEqual([])
    expect(calls.map((call) => call.payload.chat_id)).toEqual([777])
    expect(error.mock.calls.flat().join(' ')).toContain('429 flood, 2 people given up')
  })

  it('второй 429 после ожидания — сообщение отдано, следующий человек получает своё', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram([], 2, 3)
    const waited: number[] = []
    const wait = (ms: number) => {
      waited.push(ms)
      return Promise.resolve(true)
    }

    await remindDue(
      claiming([
        { telegramUserId: 777, items: [item('Кефир')], total: 1 },
        { telegramUserId: 888, items: [item('Хлеб')], total: 1 },
      ]) as MolviaBotClient,
      api,
      APP,
      wait,
    )

    expect(waited).toEqual([3000])
    expect(calls.map((call) => call.payload.chat_id)).toEqual([777, 777, 888])
    expect(error.mock.calls.flat().join(' ')).toContain('429')
  })

  it('остановка прерывает ожидание: остаток уходит сразу, стоп — в пределах секунд', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.useFakeTimers()
    const { api, calls } = telegram([], 1, RETRY_AFTER_CAP_SECONDS)
    const reminders = [
      { telegramUserId: 777, items: [item('Кефир')], total: 1 },
      { telegramUserId: 888, items: [item('Хлеб')], total: 1 },
    ]

    const stop = startReminders(claiming(reminders) as MolviaBotClient, api, APP, 60_000)
    await vi.advanceTimersByTimeAsync(0)
    let stopped = false
    void stop().then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(stopped).toBe(true)
    // The first message's wait was cut and it was given up; the next person was still sent to.
    expect(calls.map((call) => call.payload.chat_id)).toEqual([777, 888])
  })

  it('API не ответил — ничего не отправлено, процесс жив', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram()
    const client = { claimReminders: vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL))) }

    await remindDue(client as unknown as MolviaBotClient, api, APP)

    expect(calls).toEqual([])
  })

  it('спрашивает сразу и потом раз в минуту, прогоны не накладываются', async () => {
    vi.useFakeTimers()
    const { api } = telegram()
    let release: () => void = () => undefined
    const claimReminders = vi.fn(
      () =>
        new Promise<{ reminders: Reminder[] }>((resolve) => {
          release = () => {
            resolve({ reminders: [] })
          }
        }),
    )

    const stop = startReminders({ claimReminders } as unknown as MolviaBotClient, api, APP, 60_000)
    expect(claimReminders).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(claimReminders).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(claimReminders).toHaveBeenCalledTimes(2)
    release()
    await stop()
  })
})
