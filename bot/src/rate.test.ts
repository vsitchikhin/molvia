import { describe, expect, it, vi } from 'vitest'
import type { Bot, Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { assembleBot } from './assemble'
import { t } from './i18n'
import { scale } from './remind'

/** Through `assembleBot`: whether a press reaches the scale is a property of the order. */
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
  let shown: unknown
  const bot = assembleBot(
    '42:TEST',
    { api: api as MolviaBotClient, appUrl: 'https://molvia.test' },
    { botInfo: BOT_INFO },
  )
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload })
    if (method === 'editMessageText') {
      const body = payload as { readonly text?: unknown }
      // Telegram refuses to rewrite a message with the text it already carries.
      if (body.text === shown) {
        return Promise.resolve({
          ok: false,
          error_code: 400,
          description: 'Bad Request: message is not modified',
        }) as never
      }
      shown = body.text
    }
    return Promise.resolve({ ok: true, result: true }) as never
  }
  bot.api.config.use(transformer)
  return { bot, calls }
}

/** A press as Telegram hands it over: with the message as it stood when the finger came down. */
function press(
  data: string,
  {
    from = FROM,
    text = QUESTION,
    chat = CHAT,
    markup = scale(MILK),
  }: { from?: object; text?: string; chat?: object; markup?: object } = {},
): Update {
  return {
    update_id: 2,
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

const edits = (calls: Call[]) => calls.filter((call) => call.method === 'editMessageText')
const alert = (calls: Call[]) =>
  calls.find((call) => call.method === 'answerCallbackQuery' && call.payload.show_alert)?.payload

describe('кнопки 1–5 под напоминанием (MOL-101)', () => {
  it('ставит оценку тому, кто нажал, и пишет итог под вопросом — шкала остаётся с отметкой', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ rateFromBot })

    await bot.handleUpdate(press(`rate:${MILK}:4`))

    expect(rateFromBot).toHaveBeenCalledWith(777, MILK, 4)
    expect(edits(calls)).toEqual([
      {
        method: 'editMessageText',
        payload: expect.objectContaining({
          text: `${QUESTION}\n\n✓ ${t('ru', 'rate.done', { score: 4 })}`,
          reply_markup: scale(MILK, 4),
        }) as unknown,
      },
    ])
    expect(JSON.stringify(scale(MILK, 4))).toContain('4 ✓')
  })

  it('чья оценка — решает нажавший, а не тот, кому пришло сообщение', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot } = harness({ rateFromBot })

    await bot.handleUpdate(press(`rate:${MILK}:2`, { from: { ...FROM, id: 999 } }))

    expect(rateFromBot).toHaveBeenCalledWith(999, MILK, 2)
  })

  it('промах пальцем: 3, потом 4 — итог заменяется, а не копится', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ rateFromBot })
    const first = `${QUESTION}\n\n✓ ${t('ru', 'rate.done', { score: 3 })}`

    await bot.handleUpdate(press(`rate:${MILK}:3`))
    await bot.handleUpdate(press(`rate:${MILK}:4`, { text: first }))

    expect(rateFromBot.mock.calls).toEqual([
      [777, MILK, 3],
      [777, MILK, 4],
    ])
    expect(edits(calls).map((call) => call.payload.text)).toEqual([
      first,
      `${QUESTION}\n\n✓ ${t('ru', 'rate.done', { score: 4 })}`,
    ])
  })

  it('та же цифра дважды — второй итог тот же, и в чат ничего не падает', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ rateFromBot })

    await bot.handleUpdate(press(`rate:${MILK}:5`))
    await bot.handleUpdate(press(`rate:${MILK}:5`))

    expect(calls.filter((call) => call.method === 'sendMessage')).toEqual([])
  })

  it('итог — на языке нажавшего', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ rateFromBot })

    await bot.handleUpdate(press(`rate:${MILK}:4`, { from: { ...FROM, language_code: 'en' } }))

    expect(edits(calls)[0]?.payload.text).toBe(
      `${QUESTION}\n\n✓ ${t('en', 'rate.done', { score: 4 })}`,
    )
  })

  it('API не ответил — отказ поверх, сообщение не тронуто, шкала на месте', async () => {
    const rateFromBot = vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness({ rateFromBot })

    await bot.handleUpdate(press(`rate:${MILK}:4`))

    expect(edits(calls)).toEqual([])
    expect(calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(false)
    expect(alert(calls)?.text).toBe(t('ru', 'rate.failed'))
  })

  it('аккаунта или товара больше нет — отказ поверх, и кнопки уходят', async () => {
    const rateFromBot = vi.fn(() => Promise.reject(new ApiError(ERROR.NOT_FOUND)))
    const { bot, calls } = harness({ rateFromBot })

    await bot.handleUpdate(press(`rate:${MILK}:4`))

    expect(edits(calls)).toEqual([])
    expect(alert(calls)?.text).toBe(t('ru', 'rate.gone'))
    expect(calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(true)
  })

  it.each([`rate:${MILK}:0`, `rate:${MILK}:6`, 'rate:not-a-uuid:4', `rate:${MILK}:4:extra`])(
    'данные кнопки %s — до API не доходит',
    async (data) => {
      const rateFromBot = vi.fn(() => Promise.resolve())
      const { bot } = harness({ rateFromBot })

      await bot.handleUpdate(press(data))

      expect(rateFromBot).not.toHaveBeenCalled()
    },
  )

  it('строка выключателя и его итог остаются после оценки (MOL-103, Р-7)', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ rateFromBot })
    const stopped = `${QUESTION}\n\n${t('ru', 'remind.stopped')}`

    await bot.handleUpdate(
      press(`rate:${MILK}:5`, { text: stopped, markup: scale(MILK, undefined, 'on') }),
    )

    expect(edits(calls)).toEqual([
      {
        method: 'editMessageText',
        payload: expect.objectContaining({
          text: `${QUESTION}\n\n✓ ${t('ru', 'rate.done', { score: 5 })}\n\n${t('ru', 'remind.stopped')}`,
          reply_markup: scale(MILK, 5, 'on'),
        }) as unknown,
      },
    ])
  })

  it('под последним сообщением «Не напоминать» после оценки на месте', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ rateFromBot })

    await bot.handleUpdate(press(`rate:${MILK}:3`, { markup: scale(MILK, undefined, 'off') }))

    expect(edits(calls)[0]?.payload.reply_markup).toEqual(scale(MILK, 3, 'off'))
  })

  it('в группе не оценивает', async () => {
    const rateFromBot = vi.fn(() => Promise.resolve())
    const { bot } = harness({ rateFromBot })

    await bot.handleUpdate(
      press(`rate:${MILK}:4`, { chat: { id: -100, type: 'group', title: 'Семья' } }),
    )

    expect(rateFromBot).not.toHaveBeenCalled()
  })
})
