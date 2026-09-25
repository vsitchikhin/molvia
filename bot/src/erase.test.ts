import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot, Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { assembleBot } from './assemble'
import { ERASE_BUTTON_SECONDS } from './erase'
import { t } from './i18n'

/**
 * Through `assembleBot`, not the composer alone: the login ends in a catch-all, and whether
 * `/delete` ever reaches erasure is a property of the order the two are installed in.
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

const NOW = 1_790_000_000
const FROM = { id: 777, is_bot: false, first_name: 'Аня' }
const CHAT = { id: 777, type: 'private' as const, first_name: 'Аня' }

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

function harness(
  api: Partial<MolviaBotClient> = {},
  now = NOW,
  failing: readonly string[] = [],
): { bot: Bot; calls: Call[] } {
  const calls: Call[] = []
  let shown: unknown
  // Telegram's own memory of the message: whether it still carries its buttons.
  let buttons = true
  const bot = assembleBot(
    '42:TEST',
    { api: api as MolviaBotClient, appUrl: 'https://molvia.test', now: () => now },
    { botInfo: BOT_INFO },
  )
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload: payload })
    if (failing.includes(method)) {
      return Promise.resolve({ ok: false, error_code: 403, description: 'Forbidden' }) as never
    }
    // Telegram refuses to rewrite a message with the text it already carries.
    if (method === 'editMessageText') {
      const body = payload as { readonly text?: unknown }
      if (body.text === shown) {
        return Promise.resolve({
          ok: false,
          error_code: 400,
          description: 'Bad Request: message is not modified',
        }) as never
      }
      shown = body.text
      buttons = false
    }
    // Taking away buttons that are already gone is refused, exactly like a text edit.
    if (method === 'editMessageReplyMarkup') {
      const restoring = (payload as { readonly reply_markup?: unknown }).reply_markup !== undefined
      if (!restoring && !buttons) {
        return Promise.resolve({
          ok: false,
          error_code: 400,
          description: 'Bad Request: message is not modified',
        }) as never
      }
      buttons = restoring
    }
    return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
  }
  bot.api.config.use(transformer)
  return { bot, calls }
}

function command(text: string, chat: Record<string, unknown> = CHAT): Update {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 0,
      chat: chat as never,
      from: FROM,
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.length }],
    },
  }
}

/** The prompt's own buttons, as Telegram hands them back with every press. */
const KEYBOARD = {
  inline_keyboard: [
    [
      { text: 'Удалить навсегда', callback_data: `erase:ok:${String(NOW)}` },
      { text: 'Отмена', callback_data: `erase:no:${String(NOW)}` },
    ],
  ],
}

function press(data: string, from: Record<string, unknown> = FROM): Update {
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
        chat: CHAT,
        from: { ...FROM, id: 42, is_bot: true },
        reply_markup: KEYBOARD,
      },
    },
  }
}

const sent = (calls: Call[], method: string): Record<string, unknown> | undefined =>
  calls.find((call) => call.method === method)?.payload

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('/delete — человек удаляет себя сам (MOL-58)', () => {
  it('спрашивает, что уйдёт и что останется, двумя кнопками — и ничего не стирает', async () => {
    const eraseMe = vi.fn()
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(command('/delete'))

    const reply = sent(calls, 'sendMessage')
    expect(reply?.text).toBe(t('ru', 'erase.prompt'))
    expect(reply?.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: 'Удалить навсегда', callback_data: `erase:ok:${String(NOW)}` },
          { text: 'Отмена', callback_data: `erase:no:${String(NOW)}` },
        ],
      ],
    })
    expect(eraseMe).not.toHaveBeenCalled()
  })

  it('«Удалить навсегда» стирает того, кто нажал, и пишет итог вместо вопроса', async () => {
    const eraseMe = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:ok:${String(NOW - 60)}`))

    expect(eraseMe).toHaveBeenCalledWith(777)
    expect(sent(calls, 'editMessageText')?.text).toBe(t('ru', 'erase.done'))
    expect(sent(calls, 'answerCallbackQuery')).toBeDefined()
  })

  it('кнопку нажал другой человек — стирается он, а не автор команды', async () => {
    const eraseMe = vi.fn(() => Promise.resolve())
    const { bot } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:ok:${String(NOW)}`, { ...FROM, id: 999 }))

    expect(eraseMe).toHaveBeenCalledWith(999)
  })

  it('двойное нажатие: второй итог тот же, и в чат не падает второе сообщение', async () => {
    const eraseMe = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:ok:${String(NOW)}`))
    await bot.handleUpdate(press(`erase:ok:${String(NOW)}`))

    expect(eraseMe).toHaveBeenCalledTimes(2)
    expect(calls.filter((call) => call.method === 'sendMessage')).toEqual([])
  })

  it('«Отмена» ничего не стирает и ничего не пишет в сообщение — только поверх, и кнопки уходят', async () => {
    const eraseMe = vi.fn()
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:no:${String(NOW)}`))

    expect(eraseMe).not.toHaveBeenCalled()
    expect(sent(calls, 'editMessageText')).toBeUndefined()
    expect(sent(calls, 'answerCallbackQuery')).toMatchObject({
      text: t('ru', 'erase.cancelled'),
      show_alert: true,
    })
    expect(sent(calls, 'editMessageReplyMarkup')).toBeDefined()
  })

  // Adversarial О-2: both presses leave before the first edit lands, and «Отмена» used to
  // rewrite «Готово» into «Ничего не удалено» over an account already gone.
  it('«Отмена» после «Удалить навсегда» оставляет «Готово» последним словом в сообщении', async () => {
    const eraseMe = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:ok:${String(NOW)}`))
    await bot.handleUpdate(press(`erase:no:${String(NOW)}`))

    const edits = calls
      .filter((call) => call.method === 'editMessageText')
      .map((call) => call.payload.text)
    expect(edits).toEqual([t('ru', 'erase.done')])
  })

  // Adversarial П-4: an aged-out query takes no alert, and the buttons used to go in silence.
  it('«Отмена» без алерта говорит в чат и только потом убирает кнопки', async () => {
    const { bot, calls } = harness({}, NOW, ['answerCallbackQuery'])

    await bot.handleUpdate(press(`erase:no:${String(NOW)}`))

    expect(sent(calls, 'sendMessage')?.text).toBe(t('ru', 'erase.cancelled'))
    expect(sent(calls, 'editMessageText')).toBeUndefined()
    expect(sent(calls, 'editMessageReplyMarkup')).toBeDefined()
  })

  it('«Отмена», которую не удалось сказать никак, оставляет кнопки', async () => {
    const { bot, calls } = harness({}, NOW, ['answerCallbackQuery', 'sendMessage'])

    await bot.handleUpdate(press(`erase:no:${String(NOW)}`))

    // Taken away to claim the right to speak, then put back when nothing could be said.
    const restores = calls.filter((call) => call.method === 'editMessageReplyMarkup')
    expect(restores.at(-1)?.payload.reply_markup).toEqual(KEYBOARD)
  })

  // Adversarial С-1: with the alert refused, a double tap put the same words in the chat twice.
  it.each([
    ['«Отмена»', `erase:no:${String(NOW)}`],
    ['устаревшая кнопка', `erase:ok:${String(NOW - ERASE_BUTTON_SECONDS - 1)}`],
  ])('%s дважды без алерта — слова в чате один раз', async (_name, data) => {
    const { bot, calls } = harness({}, NOW, ['answerCallbackQuery'])

    await bot.handleUpdate(press(data))
    await bot.handleUpdate(press(data))

    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  })

  it('второе нажатие молчит и тогда, когда первое сказало поверх сообщения', async () => {
    const { bot, calls } = harness()
    await bot.handleUpdate(press(`erase:no:${String(NOW)}`))
    // The second press finds the alert refused — its query aged out while the first was handled.
    bot.api.config.use((prev, method, payload, signal) =>
      method === 'answerCallbackQuery'
        ? (Promise.resolve({
            ok: false,
            error_code: 400,
            description: 'query is too old',
          }) as never)
        : prev(method, payload, signal),
    )

    await bot.handleUpdate(press(`erase:no:${String(NOW)}`))

    // The refusal really happened: the second alert never reached the recording transformer.
    expect(calls.filter((call) => call.method === 'answerCallbackQuery')).toHaveLength(1)
    expect(calls.filter((call) => call.method === 'sendMessage')).toEqual([])
  })

  it('«Удалить навсегда» после «Отмены» — нажатие было, и «Готово» правда', async () => {
    const eraseMe = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:no:${String(NOW)}`))
    await bot.handleUpdate(press(`erase:ok:${String(NOW)}`))

    expect(eraseMe).toHaveBeenCalledTimes(1)
    expect(sent(calls, 'editMessageText')?.text).toBe(t('ru', 'erase.done'))
  })

  it.each([
    ['ровно на границе', ERASE_BUTTON_SECONDS, true],
    ['секундой позже', ERASE_BUTTON_SECONDS + 1, false],
    ['через неделю', 7 * 24 * 3600, false],
    ['из будущего', -1, false],
  ])('кнопка %s', async (_name, age, erases) => {
    const eraseMe = vi.fn(() => Promise.resolve())
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:ok:${String(NOW - age)}`))

    expect(eraseMe).toHaveBeenCalledTimes(erases ? 1 : 0)
    if (!erases) {
      expect(sent(calls, 'answerCallbackQuery')?.text).toBe(t('ru', 'erase.expired'))
      expect(sent(calls, 'editMessageReplyMarkup')).toBeDefined()
    }
  })

  // Adversarial Р-2: the expired branch took the buttons away in silence, like «Отмена» did.
  it('устаревшая кнопка без алерта говорит в чат и только потом убирает кнопки', async () => {
    const eraseMe = vi.fn()
    const { bot, calls } = harness({ eraseMe }, NOW, ['answerCallbackQuery'])

    await bot.handleUpdate(press(`erase:ok:${String(NOW - ERASE_BUTTON_SECONDS - 1)}`))

    expect(eraseMe).not.toHaveBeenCalled()
    expect(sent(calls, 'sendMessage')?.text).toBe(t('ru', 'erase.expired'))
    expect(sent(calls, 'editMessageReplyMarkup')).toBeDefined()
  })

  it('устаревшая кнопка, которую не удалось объяснить никак, остаётся', async () => {
    const { bot, calls } = harness({}, NOW, ['answerCallbackQuery', 'sendMessage'])

    await bot.handleUpdate(press(`erase:ok:${String(NOW - ERASE_BUTTON_SECONDS - 1)}`))

    // Taken away to claim the right to speak, then put back when nothing could be said.
    const restores = calls.filter((call) => call.method === 'editMessageReplyMarkup')
    expect(restores.at(-1)?.payload.reply_markup).toEqual(KEYBOARD)
  })

  it('кнопка без времени — устаревшая, не «вечная»', async () => {
    const eraseMe = vi.fn()
    const { bot } = harness({ eraseMe })

    await bot.handleUpdate(press('erase:ok:'))

    expect(eraseMe).not.toHaveBeenCalled()
  })

  it('API не ответил — отказ поверх сообщения, кнопки остаются, в логе только код', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const eraseMe = vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(press(`erase:ok:${String(NOW)}`))

    expect(sent(calls, 'answerCallbackQuery')?.text).toBe(t('ru', 'erase.failed'))
    expect(sent(calls, 'editMessageText')).toBeUndefined()
    expect(sent(calls, 'editMessageReplyMarkup')).toBeUndefined()
    expect(log.mock.calls).toEqual([[`[molvia] erase: ${ERROR.INTERNAL}`]])
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/777|Аня/)
  })

  it('в группе команда не работает', async () => {
    const eraseMe = vi.fn()
    const { bot, calls } = harness({ eraseMe })

    await bot.handleUpdate(command('/delete', { id: -100, type: 'group', title: 'Семья' }))

    expect(calls).toEqual([])
  })

  it('упавший ответ уходит в лог без апдейта: ни имени, ни username, ни языка', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot } = harness({}, NOW, ['sendMessage'])
    const update = command('/delete')
    Object.assign(update.message?.from ?? {}, { username: 'anya_gyumri', language_code: 'hy' })

    // `handleUpdate` rethrows; the runner hands the error to `bot.catch`, and so does this.
    await bot.handleUpdate(update).catch((error: unknown) => bot.errorHandler(error as never))

    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Аня|anya_gyumri|"hy"|777/)
  })

  // Adversarial О-5 and selfreview 6: what goes is everything, what stays is named in full.
  it('вопрос называет, что остаются и товары, и магазины, а уходит всё', () => {
    for (const language of ['ru', 'en']) {
      const prompt = t(language, 'erase.prompt')
      expect(prompt).toMatch(language === 'ru' ? /магазин/ : /shops/)
      expect(prompt).toMatch(
        language === 'ru' ? /выбор в поиске.*отметки о визитах/s : /search picks.*visit marks/s,
      )
      // MOL-40: exchanges are the person's own money, and they go too.
      expect(prompt).toMatch(language === 'ru' ? /обмены денег/ : /money exchanges/)
    }
  })

  it('приветствие называет /delete', () => {
    expect(t('ru', 'start.greeting')).toContain('/delete')
    expect(t('en', 'start.greeting')).toContain('/delete')
  })
})
