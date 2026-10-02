import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bot, Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { ALLOWED_UPDATES, assembleBot } from './assemble'
import { t } from './i18n'
import { scale } from './remind'

/** Through `assembleBot`: the switch has to be reached before the login's catch-all. */
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

const MILK = '5b0e7c0e-6d3e-4a53-9c4a-1f1f0b7e2a11'
const FROM = { id: 777, is_bot: false, first_name: 'Аня' }
const CHAT = { id: 777, type: 'private' as const, first_name: 'Аня' }
const QUESTION = t(undefined, 'remind.question', {
  when: t(undefined, 'remind.yesterday'),
  place: 'Ереван Сити',
  name: 'Молоко Ашхар 1 л',
})

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

function harness(api: Partial<MolviaBotClient>): { bot: Bot; calls: Call[] } {
  const calls: Call[] = []
  const bot = assembleBot(
    '42:TEST',
    { api: api as MolviaBotClient, appUrl: 'https://molvia.test' },
    { botInfo: BOT_INFO },
  )
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload })
    return Promise.resolve({ ok: true, result: true }) as never
  }
  bot.api.config.use(transformer)
  return { bot, calls }
}

function press(
  data: string,
  {
    from = FROM,
    text = QUESTION,
    chat = CHAT,
    markup = scale(MILK, undefined, 'off'),
  }: { from?: object; text?: string; chat?: object; markup?: object } = {},
): Update {
  return {
    update_id: 3,
    callback_query: {
      id: 'cb1',
      from: from as never,
      chat_instance: 'ci',
      data,
      message: {
        message_id: 10,
        date: 0,
        chat: chat as never,
        from: { ...FROM, id: 42, is_bot: true },
        text,
        reply_markup: markup as never,
      },
    },
  }
}

/** Telegram's word that the person changed the bot's place in their chat list. */
function member(
  status: 'kicked' | 'member' | 'left',
  { chat = CHAT, from = FROM }: { chat?: object; from?: object } = {},
): Update {
  return {
    update_id: 4,
    my_chat_member: {
      chat: chat as never,
      from: from as never,
      date: 0,
      old_chat_member: { status: 'member', user: { ...FROM, id: 42, is_bot: true } } as never,
      new_chat_member: { status, user: { ...FROM, id: 42, is_bot: true } } as never,
    },
  }
}

const edits = (calls: Call[]) => calls.filter((call) => call.method === 'editMessageText')
const alert = (calls: Call[]) =>
  calls.find((call) => call.method === 'answerCallbackQuery' && call.payload.show_alert)?.payload

afterEach(() => {
  vi.restoreAllMocks()
})

describe('«Не напоминать» под напоминанием (MOL-103)', () => {
  it('выключает тому, кто нажал; итог под вопросом, шкала на месте, на месте кнопки — «Вернуть»', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ switchReminders })

    await bot.handleUpdate(press('remind:off'))

    expect(switchReminders).toHaveBeenCalledWith(777, 'off')
    expect(edits(calls)).toEqual([
      {
        method: 'editMessageText',
        payload: expect.objectContaining({
          text: `${QUESTION}\n\n${t('ru', 'remind.stopped')}`,
          reply_markup: scale(MILK, undefined, 'on'),
        }) as unknown,
      },
    ])
  })

  it('«Вернуть напоминания» включает и снова предлагает «Не напоминать»', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ switchReminders })

    await bot.handleUpdate(
      press('remind:on', {
        text: `${QUESTION}\n\n${t('ru', 'remind.stopped')}`,
        markup: scale(MILK, undefined, 'on'),
      }),
    )

    expect(switchReminders).toHaveBeenCalledWith(777, 'on')
    expect(edits(calls)[0]?.payload).toMatchObject({
      text: `${QUESTION}\n\n${t('ru', 'remind.resumed')}`,
      reply_markup: scale(MILK, undefined, 'off'),
    })
  })

  it('оценка, поставленная раньше, остаётся — и в тексте, и на шкале', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ switchReminders })
    const rated = `${QUESTION}\n\n✓ ${t('ru', 'rate.done', { score: 4 })}`

    await bot.handleUpdate(press('remind:off', { text: rated, markup: scale(MILK, 4, 'off') }))

    expect(edits(calls)[0]?.payload).toMatchObject({
      text: `${rated}\n\n${t('ru', 'remind.stopped')}`,
      reply_markup: scale(MILK, 4, 'on'),
    })
  })

  it('чьи напоминания — решает нажавший; итог — на его языке', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ switchReminders })

    await bot.handleUpdate(press('remind:off', { from: { ...FROM, id: 999, language_code: 'en' } }))

    expect(switchReminders).toHaveBeenCalledWith(999, 'off')
    expect(edits(calls)[0]?.payload.text).toBe(`${QUESTION}\n\n${t('en', 'remind.stopped')}`)
  })

  it('API не ответил — отказ поверх, сообщение и кнопки не тронуты, в журнале только код', async () => {
    const switchReminders = vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness({ switchReminders })

    await bot.handleUpdate(press('remind:off'))

    expect(edits(calls)).toEqual([])
    expect(calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(false)
    expect(alert(calls)?.text).toBe(t('ru', 'remind.switchFailed'))
    expect(error.mock.calls.flat().join(' ')).toContain(ERROR.INTERNAL)
    expect(error.mock.calls.flat().join(' ')).not.toContain('777')
  })

  it('«Вернуть» стёртому аккаунту — отказ поверх и кнопки уходят, «включены» не пишется (адверсариальный В)', async () => {
    const switchReminders = vi.fn(() => Promise.reject(new ApiError(ERROR.NOT_FOUND)))
    const { bot, calls } = harness({ switchReminders })

    await bot.handleUpdate(
      press('remind:on', {
        text: `${QUESTION}\n\n${t('ru', 'remind.stopped')}`,
        markup: scale(MILK, undefined, 'on'),
      }),
    )

    expect(edits(calls)).toEqual([])
    expect(alert(calls)?.text).toBe(t('ru', 'remind.gone'))
    expect(calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(true)
  })

  it('сообщение без текста (InaccessibleMessage) не переписывается — итог уходит ответом (адверсариальный Г)', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ switchReminders })
    const update = press('remind:off')
    const query = update.callback_query as unknown as { message: Record<string, unknown> }
    query.message = { chat: CHAT, message_id: 10, date: 0 }

    await bot.handleUpdate(update)

    expect(switchReminders).toHaveBeenCalledWith(777, 'off')
    expect(edits(calls)).toEqual([])
    expect(calls.find((call) => call.method === 'sendMessage')?.payload.text).toBe(
      t('ru', 'remind.stopped'),
    )
  })

  it.each(['remind:', 'remind:pause', 'remind:off:777', 'remind:on '])(
    'данные кнопки %s — до API не доходит',
    async (data) => {
      const switchReminders = vi.fn(() => Promise.resolve())
      const { bot } = harness({ switchReminders })

      await bot.handleUpdate(press(data))

      expect(switchReminders).not.toHaveBeenCalled()
    },
  )

  it('в группе не выключает', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot } = harness({ switchReminders })

    await bot.handleUpdate(
      press('remind:off', { chat: { id: -100, type: 'group', title: 'Семья' } }),
    )

    expect(switchReminders).not.toHaveBeenCalled()
  })
})

describe('/start — бот не заблокирован', () => {
  it('передаёт «разблокирован» и не держит вход: ответ на /start идёт как прежде', async () => {
    const switchReminders = vi.fn(() => new Promise<void>(() => undefined))
    const previewLogin = vi.fn(() => Promise.reject(new ApiError(ERROR.LOGIN_UNAVAILABLE)))
    const { bot, calls } = harness({ switchReminders, previewLogin })

    await bot.handleUpdate({
      update_id: 5,
      message: {
        message_id: 11,
        date: 0,
        chat: CHAT,
        from: FROM,
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    })

    expect(switchReminders).toHaveBeenCalledWith(777, 'unblocked')
    expect(calls.some((call) => call.method === 'sendMessage')).toBe(true)
  })
})

describe('блокировка и разблокировка бота (MOL-103, В-1)', () => {
  it('заблокировал — blocked, разблокировал — unblocked, ушёл иначе — ничего', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ switchReminders })

    await bot.handleUpdate(member('kicked'))
    await bot.handleUpdate(member('member'))
    await bot.handleUpdate(member('left'))

    expect(switchReminders.mock.calls).toEqual([
      [777, 'blocked'],
      [777, 'unblocked'],
    ])
    // A blocked bot has nobody to tell, and an unblocked one is greeted by the person's /start.
    expect(calls).toEqual([])
  })

  it('бота убрали из группы — напоминания человека не трогаются', async () => {
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot } = harness({ switchReminders })

    await bot.handleUpdate(member('kicked', { chat: { id: -100, type: 'group', title: 'Семья' } }))

    expect(switchReminders).not.toHaveBeenCalled()
  })

  it('API не ответил — в журнал по коду, процесс жив', async () => {
    const switchReminders = vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot } = harness({ switchReminders })

    await bot.handleUpdate(member('kicked'))

    expect(error.mock.calls.flat().join(' ')).toContain(`remind block: ${ERROR.INTERNAL}`)
    expect(error.mock.calls.flat().join(' ')).not.toContain('777')
  })

  it('бот слушает my_chat_member, а не полагается на прежнюю настройку токена', () => {
    expect(ALLOWED_UPDATES).toContain('my_chat_member')
    expect(ALLOWED_UPDATES).toContain('message')
    expect(ALLOWED_UPDATES).toContain('callback_query')
  })
})
