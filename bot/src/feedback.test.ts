import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bot, Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { FeedbackFromBot, FeedbackFromBotAnswer, OwnerNotice } from '@molvia/model'
import { assembleBot } from './assemble'
import { DELIVERED_REACTION, replyFrame } from './feedback'
import { t } from './i18n'
import { ownerText } from './owner'

/** Through `assembleBot`: the composer has to stand before the login's catch-all. */
const BOT_INFO = { id: 42, is_bot: true, first_name: 'Molvia', username: 'molvia_test_bot' }

const OWNER = { id: 4242, is_bot: false, first_name: 'Владелец', language_code: 'ru' }
const ANNA = { id: 777, is_bot: false, first_name: 'Аня' }
const ANNA_TELEGRAM = 777

const NOTICE: OwnerNotice = {
  kind: 'feedback',
  thread: 42,
  feedbackKind: 'bug',
  text: 'Список «Что брать» не грузится',
  locale: 'en',
  pageBuild: null,
  apiBuild: 'dev',
  route: 'advice',
  platform: 'ios 18 app',
  fromError: true,
  errorCode: null,
  at: '2026-10-03T10:07:00.000Z',
}

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

/** Telegram's code for a call it refuses — by method, or by method and chat. */
type Refuse =
  Partial<Record<string, number>> | ((method: string, chat: unknown) => number | undefined)

function harness(api: Partial<MolviaBotClient>, refuse: Refuse = {}): { bot: Bot; calls: Call[] } {
  const calls: Call[] = []
  const bot = assembleBot(
    '42:TEST',
    {
      api: {
        switchReminders: vi.fn(() => Promise.resolve()),
        replyDelivered: vi.fn(() => Promise.resolve()),
        reportFailure: vi.fn(() => Promise.resolve()),
        ...api,
      } as unknown as MolviaBotClient,
      appUrl: 'https://molvia.test',
    },
    { botInfo: BOT_INFO as UserFromGetMe },
  )
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload: payload })
    const code =
      typeof refuse === 'function'
        ? refuse(method, (payload as { chat_id?: unknown }).chat_id)
        : refuse[method]
    if (code !== undefined) {
      return Promise.resolve({ ok: false, error_code: code, description: 'refused' }) as never
    }
    const result = method === 'sendMessage' ? { message_id: 9031, date: 0, chat: {} } : true
    return Promise.resolve({ ok: true, result }) as never
  }
  bot.api.config.use(transformer)
  return { bot, calls }
}

/** A message `from` writes in their chat, as a reply to the bot's message `replied`. */
function replyTo(
  replied: { text?: string; fromBot?: boolean; messageId?: number },
  { from = OWNER, text, photo = false }: { from?: object; text?: string; photo?: boolean } = {},
): Update {
  const chat = { id: (from as { id: number }).id, type: 'private', first_name: 'x' }
  return {
    update_id: 5,
    message: {
      message_id: 501,
      date: 0,
      chat: chat as never,
      from: from as never,
      ...(photo ? { photo: [{ file_id: 'p', file_unique_id: 'p', width: 1, height: 1 }] } : {}),
      ...(text === undefined ? {} : { text }),
      reply_to_message: {
        message_id: replied.messageId ?? 500,
        date: 0,
        chat: chat as never,
        from: (replied.fromBot === false ? ANNA : BOT_INFO) as never,
        ...(replied.text === undefined ? {} : { text: replied.text }),
      } as never,
    },
  }
}

function answering(answer: FeedbackFromBotAnswer | Error, seen: FeedbackFromBot[] = []) {
  return vi.fn((message: FeedbackFromBot) => {
    seen.push(message)
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  })
}

const sent = (calls: Call[], method: string) => calls.filter((call) => call.method === method)
const replies = (calls: Call[]) => sent(calls, 'sendMessage').map((call) => call.payload.text)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ответ владельца на уведомление (MOL-148, Р-10, Р-11)', () => {
  const answered: FeedbackFromBotAnswer = {
    outcome: 'answered',
    reply: 17,
    to: ANNA_TELEGRAM,
    locale: 'en',
    day: '2026-10-03',
  }

  it('метка из первой строки, кто и текст — в API; человеку рамка на его языке; владельцу 👌', async () => {
    const seen: FeedbackFromBot[] = []
    const replyDelivered = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ feedbackFromBot: answering(answered, seen), replyDelivered })

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { text: 'Fixed, please update' }))

    expect(seen).toEqual([
      {
        telegramUserId: OWNER.id,
        messageId: 501,
        repliedMessageId: 500,
        thread: 42,
        text: 'Fixed, please update',
      },
    ])
    expect(sent(calls, 'sendMessage')).toEqual([
      {
        method: 'sendMessage',
        payload: {
          chat_id: ANNA_TELEGRAM,
          text: replyFrame('Fixed, please update', '2026-10-03', 'en'),
        },
      },
    ])
    expect(replyFrame('Fixed, please update', '2026-10-03', 'en')).toBe(
      'A reply to your message of October 3:\n\nFixed, please update\n\nTo answer, reply to this message.',
    )
    expect(replyDelivered).toHaveBeenCalledWith({ reply: 17, outcome: 'sent', messageId: 9031 })
    expect(sent(calls, 'setMessageReaction')).toMatchObject([
      {
        payload: {
          chat_id: OWNER.id,
          message_id: 501,
          reaction: [{ type: 'emoji', emoji: DELIVERED_REACTION }],
        },
      },
    ])
  })

  it('рамка по-русски: «Ответ на ваше сообщение от 3 октября»', () => {
    expect(replyFrame('Починили', '2026-10-03', 'ru').split('\n')).toEqual([
      'Ответ на ваше сообщение от 3 октября:',
      '',
      'Починили',
      '',
      'Чтобы ответить, ответьте на это сообщение.',
    ])
  })

  it('Telegram не принял реакцию — строка «Доставлено.» под ответом владельца', async () => {
    const { bot, calls } = harness(
      { feedbackFromBot: answering(answered) },
      { setMessageReaction: 400 },
    )

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { text: 'Починили' }))

    expect(replies(calls).slice(1)).toEqual([t('ru', 'feedback.delivered')])
    expect(sent(calls, 'sendMessage')[1]?.payload.reply_parameters).toEqual({ message_id: 501 })
  })

  it('человек заблокировал бота — blocked в API, напоминания выключены, владельцу «Не дошло»', async () => {
    const replyDelivered = vi.fn(() => Promise.resolve())
    const switchReminders = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness(
      { feedbackFromBot: answering(answered), replyDelivered, switchReminders },
      (method, chat) => (method === 'sendMessage' && chat === ANNA_TELEGRAM ? 403 : undefined),
    )

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { text: 'Починили' }))

    expect(replyDelivered).toHaveBeenCalledWith({ reply: 17, outcome: 'blocked' })
    expect(switchReminders).toHaveBeenCalledWith(ANNA_TELEGRAM, 'blocked')
    // The owner's own «unblocked» from `heardFrom` is the owner's, not Anna's.
    expect(switchReminders).not.toHaveBeenCalledWith(ANNA_TELEGRAM, 'unblocked')
    expect(sent(calls, 'setMessageReaction')).toEqual([])
    expect(replies(calls)).toContain(t('ru', 'feedback.blocked'))
  })

  it('отметка об отправке не дошла до API — владелец всё равно видит 👌', async () => {
    const replyDelivered = vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    const { bot, calls } = harness({ feedbackFromBot: answering(answered), replyDelivered })

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { text: 'Починили' }))

    expect(sent(calls, 'setMessageReaction')).toHaveLength(1)
  })

  it.each([
    [{ outcome: 'gone', thread: 42 }, t('ru', 'feedback.gone', { thread: 42 })],
    [{ outcome: 'too_long', max: 3500 }, t('ru', 'feedback.tooLong', { max: 3500 })],
    [{ outcome: 'invisible' }, t('ru', 'feedback.invisible')],
  ] as const)('%o — одна строка под сообщением, человеку ничего', async (answer, words) => {
    const { bot, calls } = harness({ feedbackFromBot: answering(answer) })

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { text: 'Ответ' }))

    expect(sent(calls, 'sendMessage')).toEqual([
      {
        method: 'sendMessage',
        payload: { chat_id: OWNER.id, text: words, reply_parameters: { message_id: 501 } },
      },
    ])
  })

  it('фото в ответ на уведомление с меткой — «только текстом», в API ничего', async () => {
    const feedbackFromBot = answering(answered)
    const { bot, calls } = harness({ feedbackFromBot })

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { photo: true }))

    expect(feedbackFromBot).not.toHaveBeenCalled()
    expect(replies(calls)).toEqual([t('ru', 'feedback.textOnly')])
  })

  it('сервер не ответил — «Не получилось», без ошибки и без приветствия', async () => {
    const { bot, calls } = harness({
      feedbackFromBot: answering(new ApiError(ERROR.INTERNAL)),
    })

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { text: 'Ответ' }))

    expect(replies(calls)).toEqual([t('ru', 'feedback.failed')])
  })
})

describe('продолжение нити и чужое (MOL-148, В-1 MOL-150, В-3)', () => {
  const frame = replyFrame('Fixed', '2026-10-03', 'en')

  it('ответ человека на рамку — без метки в API; «Передали разработчику» на его языке', async () => {
    const seen: FeedbackFromBot[] = []
    const { bot, calls } = harness({ feedbackFromBot: answering({ outcome: 'continued' }, seen) })

    await bot.handleUpdate(
      replyTo({ text: frame }, { from: { ...ANNA, language_code: 'en' }, text: 'Works now' }),
    )

    expect(seen).toMatchObject([{ telegramUserId: ANNA_TELEGRAM, thread: null, text: 'Works now' }])
    expect(replies(calls)).toEqual([t('en', 'feedback.passed')])
  })

  it('день сообщений кончился — так и сказано', async () => {
    const { bot, calls } = harness({ feedbackFromBot: answering({ outcome: 'limited' }) })

    await bot.handleUpdate(replyTo({ text: frame }, { from: ANNA, text: 'Ещё' }))

    expect(replies(calls)).toEqual([t(undefined, 'feedback.limited')])
  })

  it('метка в тексте владельца внутри рамки не читается — только первая строка', async () => {
    const seen: FeedbackFromBot[] = []
    const { bot } = harness({ feedbackFromBot: answering({ outcome: 'continued' }, seen) })

    await bot.handleUpdate(
      replyTo({ text: replyFrame('см. #fb7', '2026-10-03', 'ru') }, { from: ANNA, text: 'Ок' }),
    )

    expect(seen[0]?.thread).toBeNull()
  })

  it('не наше (404) — апдейт идёт дальше, к приветствию, как раньше', async () => {
    const { bot, calls } = harness({
      feedbackFromBot: answering(new ApiError(ERROR.NOT_FOUND)),
    })

    await bot.handleUpdate(
      replyTo({ text: 'Вчера · Ереван Сити — Молоко' }, { from: ANNA, text: 'Привет' }),
    )

    expect(replies(calls)).toEqual([t(undefined, 'start.greeting', { url: 'https://molvia.test' })])
  })

  it('чужой reply с меткой: API сказал 404 — ничего не отправлено, кроме приветствия', async () => {
    const { bot, calls } = harness({
      feedbackFromBot: answering(new ApiError(ERROR.NOT_FOUND)),
    })

    await bot.handleUpdate(replyTo({ text: ownerText(NOTICE) }, { from: ANNA, text: 'Подделка' }))

    expect(sent(calls, 'setMessageReaction')).toEqual([])
    expect(replies(calls)).toEqual([t(undefined, 'start.greeting', { url: 'https://molvia.test' })])
  })

  it('текст не ответом и ответ не на сообщение бота — в API не идут', async () => {
    const feedbackFromBot = answering({ outcome: 'continued' })
    const { bot, calls } = harness({ feedbackFromBot })

    await bot.handleUpdate({
      update_id: 6,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: ANNA.id, type: 'private', first_name: 'x' },
        from: ANNA,
        text: 'Спасибо',
      },
    })
    await bot.handleUpdate(replyTo({ text: 'своё', fromBot: false }, { from: ANNA, text: 'Ок' }))

    expect(feedbackFromBot).not.toHaveBeenCalled()
    expect(replies(calls)).toHaveLength(2)
  })

  it('фото человека в ответ на рамку — бот молчит, как раньше на любое фото', async () => {
    const feedbackFromBot = answering({ outcome: 'continued' })
    const { bot, calls } = harness({ feedbackFromBot })

    await bot.handleUpdate(replyTo({ text: frame }, { from: ANNA, photo: true }))

    expect(feedbackFromBot).not.toHaveBeenCalled()
    expect(replies(calls)).toEqual([])
  })
})
