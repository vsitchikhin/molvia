import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { Reminder } from '@molvia/model'
import { t } from './i18n'
import { SCALE_DATA, remindDue, reminderText, scale, startReminders } from './remind'

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

/** Telegram, faked: every call recorded, the chats in `blocked` answering 403. */
function telegram(blocked: readonly number[] = []) {
  const calls: Call[] = []
  const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload })
    const chat = (payload as { readonly chat_id?: number }).chat_id ?? 0
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

  it('заблокировавший бота не останавливает остальных, и ему дальше не шлём', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram([777])
    const reminders = [
      { telegramUserId: 777, items: [item('Кефир'), item('Сыр')], total: 2 },
      { telegramUserId: 888, items: [item('Хлеб')], total: 1 },
    ]

    await remindDue(claiming(reminders) as MolviaBotClient, api, APP)

    expect(calls.map((call) => call.payload.chat_id)).toEqual([777, 888])
    // The code, never the chat.
    expect(error.mock.calls.flat().join(' ')).not.toContain('777')
    expect(error.mock.calls.flat().join(' ')).toContain('403')
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
