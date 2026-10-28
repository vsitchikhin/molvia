import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import type { MolviaBotClient } from '@molvia/client'
import type { SilenceNotice } from '@molvia/model'
import { silenceMessage, silenceText, warnSilent } from './silence'

const APP = 'https://molvia.test'

const notice = (patch: Partial<SilenceNotice> = {}): SilenceNotice => ({
  telegramUserId: 4242,
  day: '2027-10-26',
  days: 30,
  ...patch,
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

function client(notices: SilenceNotice[]) {
  return {
    claimSilenceNotices: vi.fn(() => Promise.resolve({ notices })),
    switchReminders: vi.fn(() => Promise.resolve()),
    reportFailure: vi.fn(() => Promise.resolve()),
  }
}

const asClient = (fake: ReturnType<typeof client>) => fake as unknown as MolviaBotClient

afterEach(() => {
  vi.restoreAllMocks()
})

describe('предупреждение о стирании (MOL-239)', () => {
  it('по-русски, затем по-английски: дата, число дней и «войдите» (В-2 «а»)', () => {
    expect(silenceText(notice())).toBe(
      'Вы не открывали Molvia почти два года. 26 октября — через 30 дней — аккаунт и все ваши данные удалятся, так же как по «Удалить мои данные».\n\n' +
        'Чтобы их оставить, откройте приложение и войдите. Копию можно взять до этого: «Скачать мои данные» в настройках.\n\n' +
        "You haven't opened Molvia for almost two years. On 26 October — in 30 days — your account and all your data will be deleted, just as by «Delete my data».\n\n" +
        'To keep them, open the app and sign in. You can take a copy first: «Download my data» in the settings.',
    )
  })

  it('формы числа дней в обоих языках: 1, 2, 5, 7, 21', () => {
    const say = (days: number) => silenceText(notice({ days }))
    expect(say(1)).toContain('через 1 день')
    expect(say(1)).toContain('in 1 day —')
    expect(say(2)).toContain('через 2 дня')
    expect(say(5)).toContain('через 5 дней')
    expect(say(7)).toContain('через 7 дней')
    expect(say(7)).toContain('in 7 days')
    expect(say(21)).toContain('через 21 день')
  })

  it('кнопка ведёт в приложение; на http:// — ссылка строкой', () => {
    const https = silenceMessage(notice(), `${APP}/`)
    expect(https.keyboard?.inline_keyboard).toEqual([[{ text: 'Открыть Molvia', url: `${APP}/` }]])
    const http = silenceMessage(notice(), 'http://127.0.0.1:5300')
    expect(http.keyboard).toBeUndefined()
    expect(http.text.endsWith('\n\nОткрыть Molvia: http://127.0.0.1:5300/')).toBe(true)
  })
})

describe('отправка', () => {
  it('каждому — своё сообщение; 403 отмечает блок, остальные уходят', async () => {
    const { api, calls } = telegram([4242])
    const fake = client([notice(), notice({ telegramUserId: 5151, days: 7 })])
    await warnSilent(asClient(fake), api, APP, () => Promise.resolve(true))
    expect(calls.map(({ payload }) => payload.chat_id)).toEqual([4242, 5151])
    expect(fake.switchReminders).toHaveBeenCalledWith(4242, 'blocked')
  })

  it('claim не ответил — ничего не отправлено, сбой залогирован по коду', async () => {
    const { api, calls } = telegram()
    const fake = client([])
    fake.claimSilenceNotices.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await warnSilent(asClient(fake), api, APP, () => Promise.resolve(true))
    expect(calls).toEqual([])
    expect(error).toHaveBeenCalledWith('[molvia] silence claim: unexpected failure')
  })
})
