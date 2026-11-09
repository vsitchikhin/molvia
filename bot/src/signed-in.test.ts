import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { LoginNotice } from '@molvia/model'
import { assembleBot } from './assemble'
import { t } from './i18n'
import { endButtonData, signedInMessage, signedInText, tellSignIns } from './signed-in'

const SESSION = '5b0e7c0e-6d3e-4a53-9c4a-1f1f0b7e2a11'

const notice = (patch: Partial<LoginNotice> = {}): LoginNotice => ({
  telegramUserId: 4242,
  sessionId: SESSION,
  deviceName: 'iPhone · Safari',
  day: '2026-11-09',
  time: '14:05',
  ...patch,
})

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('сообщение о новом входе (MOL-361)', () => {
  it('по-русски, затем по-английски: устройство, день и время, и что имя назвал браузер (В-2 «а»)', () => {
    expect(signedInText(notice())).toBe(
      'В ваш аккаунт Molvia вошло новое устройство: iPhone · Safari, 9 ноября в 14:05.\n\n' +
        'Название устройства сообщил сам браузер — подделать его нетрудно. Если входили вы, ничего делать не нужно. Если нет — завершите этот вход кнопкой ниже.\n\n' +
        'A new device signed in to your Molvia account: iPhone · Safari, 9 November at 14:05.\n\n' +
        'The device name comes from the browser itself and is easy to fake. If it was you, there is nothing to do. If not, end this sign-in with the button below.',
    )
  })

  it('устройство без имени — «неизвестное устройство» на каждом языке своё', () => {
    const text = signedInText(notice({ deviceName: null }))
    expect(text).toContain('новое устройство: неизвестное устройство, 9 ноября')
    expect(text).toContain('Molvia account: an unknown device, 9 November')
  })

  it('одна кнопка «Это не я — завершить» на двух языках, в ней только id сессии, в 64 байта', () => {
    expect(signedInMessage(notice()).keyboard.inline_keyboard).toEqual([
      [{ text: 'Это не я — завершить · Not me, end it', callback_data: `session:end:${SESSION}` }],
    ])
    expect(Buffer.byteLength(endButtonData(SESSION))).toBeLessThanOrEqual(64)
  })
})

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

function client(notices: LoginNotice[]) {
  return {
    claimLoginNotices: vi.fn(() => Promise.resolve({ notices })),
    switchReminders: vi.fn(() => Promise.resolve()),
    reportFailure: vi.fn(() => Promise.resolve()),
  }
}

const asClient = (fake: ReturnType<typeof client>) => fake as unknown as MolviaBotClient

describe('отправка', () => {
  it('каждому — своё сообщение с кнопкой и со звуком; 403 отмечает блок, остальные уходят', async () => {
    const { api, calls } = telegram([4242])
    const fake = client([notice(), notice({ telegramUserId: 5151 })])
    await tellSignIns(asClient(fake), api, () => Promise.resolve(true))
    expect(calls.map(({ payload }) => payload.chat_id)).toEqual([4242, 5151])
    for (const { payload } of calls) {
      expect(payload.reply_markup).toEqual(signedInMessage(notice()).keyboard)
      expect(payload.disable_notification).toBeUndefined()
    }
    expect(fake.switchReminders).toHaveBeenCalledWith(4242, 'blocked')
  })

  it('claim не ответил — ничего не отправлено, сбой залогирован по коду', async () => {
    const { api, calls } = telegram()
    const fake = client([])
    fake.claimLoginNotices.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await tellSignIns(asClient(fake), api, () => Promise.resolve(true))
    expect(calls).toEqual([])
    expect(error).toHaveBeenCalledWith('[molvia] login notice claim: unexpected failure')
  })
})

/** Through `assembleBot`: whether a press gets past the login's catch-all is a property of the order. */
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
const FROM = { id: 777, is_bot: false, first_name: 'Аня', language_code: 'ru' }
const CHAT = { id: 777, type: 'private' as const, first_name: 'Аня' }
const NOTICE_TEXT = signedInText(notice())

function harness(endSession: MolviaBotClient['endSession']): { bot: Bot; calls: Call[] } {
  const calls: Call[] = []
  const bot = assembleBot(
    '42:TEST',
    {
      api: {
        endSession,
        switchReminders: () => Promise.resolve(),
        reportFailure: () => Promise.resolve(),
      } as unknown as MolviaBotClient,
      appUrl: 'https://molvia.test',
    },
    { botInfo: BOT_INFO },
  )
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload })
    return Promise.resolve({ ok: true, result: true }) as never
  }
  bot.api.config.use(transformer)
  return { bot, calls }
}

function press(from: object = FROM): Update {
  return {
    update_id: 2,
    callback_query: {
      id: 'cb1',
      from: from as never,
      chat_instance: 'ci',
      data: endButtonData(SESSION),
      message: {
        message_id: 10,
        date: 0,
        chat: CHAT as never,
        from: { ...FROM, id: 42, is_bot: true },
        text: NOTICE_TEXT,
        reply_markup: signedInMessage(notice()).keyboard,
      },
    },
  }
}

const of = (calls: Call[], method: string) => calls.filter((call) => call.method === method)
const alert = (calls: Call[]) =>
  calls.find((call) => call.method === 'answerCallbackQuery' && call.payload.show_alert)?.payload

describe('«Это не я — завершить»', () => {
  it('завершает сессию за того, кто нажал; итог — под текстом, кнопка уходит', async () => {
    const endSession = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness(endSession)
    await bot.handleUpdate(press({ ...FROM, id: 999 }))
    expect(endSession).toHaveBeenCalledWith(SESSION, 999)
    expect(of(calls, 'editMessageText')).toEqual([
      {
        method: 'editMessageText',
        payload: expect.objectContaining({
          text: `${NOTICE_TEXT}\n\n${t('ru', 'signed_in.ended')}`,
        }) as unknown,
      },
    ])
    expect(of(calls, 'editMessageText')[0]?.payload.reply_markup).toBeUndefined()
    expect(alert(calls)).toBeUndefined()
  })

  it('сессии уже нет (или она не этого аккаунта) — «уже завершён» поверх, на языке нажавшего, кнопка уходит', async () => {
    const { bot, calls } = harness(() => Promise.reject(new ApiError(ERROR.NOT_FOUND)))
    await bot.handleUpdate(press({ ...FROM, language_code: 'en' }))
    expect(alert(calls)?.text).toBe('This sign-in has already ended.')
    expect(of(calls, 'editMessageText')).toEqual([])
    expect(of(calls, 'editMessageReplyMarkup')).toHaveLength(1)
  })

  it('API не ответил — «не дождался» поверх, кнопка остаётся для следующего нажатия', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    await bot.handleUpdate(press())
    expect(alert(calls)?.text).toBe(t('ru', 'login.failed'))
    expect(of(calls, 'editMessageText')).toEqual([])
    expect(of(calls, 'editMessageReplyMarkup')).toEqual([])
    expect(error).toHaveBeenCalledWith('[molvia] end session: error.internal')
  })
})
