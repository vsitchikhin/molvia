import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api, Context, GrammyError, HttpError } from 'grammy'
import type { BotError } from 'grammy'
import type { Transformer } from 'grammy'
import type { Update, UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR, ISSUE, botFailureSchema } from '@molvia/model'
import type { BotFailure } from '@molvia/model'
import { assembleBot } from './assemble'
import { botFailureOf, handlerOf, isDefect, reportDefect } from './failure'

const BOT_INFO = {
  id: 42,
  is_bot: true,
  first_name: 'Molvia',
  username: 'molvia_test_bot',
} as UserFromGetMe
const FROM = { id: 777, is_bot: false, first_name: 'Аня', username: 'anya_g' }
const CHAT = { id: 777, type: 'private' as const, first_name: 'Аня' }

afterEach(() => {
  vi.restoreAllMocks()
})

function context(update: Omit<Update, 'update_id'>): Context {
  return new Context({ update_id: 1, ...update }, new Api('42:TEST'), BOT_INFO)
}

function message(text: string): Omit<Update, 'update_id'> {
  return { message: { message_id: 1, date: 0, chat: CHAT, from: FROM, text } }
}

/** A message written as a reply to one from `author` — the bot's, or the person's own (MOL-148). */
function answering(author: number, text: string | undefined): Omit<Update, 'update_id'> {
  const replied = { message_id: 2, date: 0, chat: CHAT, from: { ...FROM, id: author }, text: 'x' }
  return {
    message: {
      message_id: 3,
      date: 0,
      chat: CHAT,
      from: FROM,
      ...(text === undefined ? {} : { text }),
      reply_to_message: replied,
    } as never,
  }
}

function press(data: string): Omit<Update, 'update_id'> {
  return { callback_query: { id: 'cb', from: FROM, chat_instance: 'ci', data } }
}

function telegramRefusal(code: number): GrammyError {
  return new GrammyError(
    'Call to sendMessage failed',
    { ok: false, error_code: code, description: 'Bad Request: Аня написала «секрет»' },
    'sendMessage',
    {},
  )
}

describe('handlerOf — где случилось, без того, кто и что (Р-5)', () => {
  it.each([
    [press('rate:5b0e7c0e-6d3e-4a53-9c4a-1f1f0b7e2a11:4'), 'callback:rate'],
    [press('remind:off'), 'callback:remind'],
    [press('Аня:секрет'), 'callback:other'],
    [message('/delete'), 'command:delete'],
    [message('/start@molvia_test_bot login_abc'), 'command:start'],
    [message('/Удалить'), 'message'],
    [message('/ivan_petrov'), 'command:other'],
    [press('anya:1'), 'callback:other'],
    [message('мой адрес: ул. Ширакаци 12'), 'message'],
    [answering(BOT_INFO.id, 'Обновил, работает'), 'message:reply'],
    [answering(FROM.id, 'ответ на своё'), 'message'],
    [answering(BOT_INFO.id, undefined), 'message:reply'],
  ])('%#', (update, handler) => {
    expect(handlerOf(context(update))).toBe(handler)
  })

  it('блокировка бота — my_chat_member', () => {
    const member = {
      chat: CHAT,
      from: FROM,
      date: 0,
      old_chat_member: { status: 'member', user: BOT_INFO },
      new_chat_member: { status: 'kicked', user: BOT_INFO, until_date: 0 },
    } as const
    expect(handlerOf(context({ my_chat_member: member }))).toBe('my_chat_member')
  })
})

describe('isDefect — что наше, а что погода', () => {
  it.each([
    [new TypeError('x'), true],
    [telegramRefusal(400), true],
    [telegramRefusal(403), false],
    [telegramRefusal(429), false],
    [telegramRefusal(502), false],
    [new HttpError('Network request for sendMessage failed', new Error('ETIMEDOUT')), false],
    [new ApiError(ERROR.INTERNAL), false],
    [new ApiError(ISSUE.RESPONSE_INVALID), true],
  ])('%#', (error, defect) => {
    expect(isDefect(error)).toBe(defect)
  })
})

describe('botFailureOf — вид, а не содержимое', () => {
  it('отказ Telegram — код, а не его описание', () => {
    const failure = botFailureOf(telegramRefusal(400), 'message')
    expect(failure).toMatchObject({
      errorName: 'GrammyError',
      code: 'TELEGRAM_400',
      handler: 'message',
    })
    expect(JSON.stringify(failure)).not.toMatch(/Аня|секрет/)
    expect(botFailureSchema.safeParse(failure).success).toBe(true)
  })

  it('чужое имя ошибки приводится к виду, который примет API', () => {
    const error = new Error('x')
    error.name = 'Ошибка: сыр'
    expect(botFailureSchema.safeParse(botFailureOf(error, 'message')).success).toBe(true)
  })
})

describe('сбой обработчика уходит в API без апдейта (MOL-143)', () => {
  function harness(reportFailure: (failure: BotFailure) => Promise<void>) {
    const bot = assembleBot(
      '42:TEST',
      {
        api: {
          switchReminders: () => Promise.resolve(),
          reportFailure,
        } as unknown as MolviaBotClient,
        appUrl: 'https://molvia.test',
      },
      { botInfo: BOT_INFO },
    )
    // Telegram refuses every message the bot writes, as it would one malformed by our code.
    const transformer: Transformer = () =>
      Promise.resolve({
        ok: false,
        error_code: 400,
        description: 'Bad Request: Аня написала «секрет»',
      }) as never
    bot.api.config.use(transformer)
    return bot
  }

  it('в теле отчёта нет ни from, ни текста, ни Telegram id; в логе — вид', async () => {
    const reportFailure = vi.fn(() => Promise.resolve())
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bot = harness(reportFailure)

    // As the runner does: a rejected update goes to the bot's error handler (`bot.catch`).
    await bot
      .handleUpdate({ update_id: 1, ...message('мой адрес: ул. Ширакаци 12') })
      .catch((error: unknown) => bot.errorHandler(error as BotError))

    expect(reportFailure).toHaveBeenCalledTimes(1)
    const sent = JSON.stringify(reportFailure.mock.calls)
    expect(sent).toContain('"handler":"message"')
    expect(sent).toContain('TELEGRAM_400')
    expect(sent).not.toMatch(/Ширакаци|Аня|anya_g|777|секрет/)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Ширакаци|Аня|секрет|Bad Request/)
  })

  it('отчёт, который не дошёл, — строка в логе, а не второй сбой', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const refused = vi.fn(() => Promise.reject(new ApiError(ERROR.INTERNAL)))
    reportDefect(
      { reportFailure: refused } as unknown as MolviaBotClient,
      new TypeError('x'),
      'message',
    )
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith(`[molvia] failure not reported: ${ERROR.INTERNAL}`)
    })
  })

  it('погода не отчитывается', () => {
    const reportFailure = vi.fn(() => Promise.resolve())
    reportDefect({ reportFailure } as unknown as MolviaBotClient, telegramRefusal(429), 'message')
    expect(reportFailure).not.toHaveBeenCalled()
  })
})

describe('ответ API, который контракт не читает, — дефект и из обработчика, который ловит сам', () => {
  const MILK = '5b0e7c0e-6d3e-4a53-9c4a-1f1f0b7e2a11'

  async function pressScale(refusal: ApiError) {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reportFailure = vi.fn(() => Promise.resolve())
    const bot = assembleBot(
      '42:TEST',
      {
        api: {
          switchReminders: () => Promise.resolve(),
          rateFromBot: () => Promise.reject(refusal),
          reportFailure,
        } as unknown as MolviaBotClient,
        appUrl: 'https://molvia.test',
      },
      { botInfo: BOT_INFO },
    )
    const transformer: Transformer = () => Promise.resolve({ ok: true, result: true }) as never
    bot.api.config.use(transformer)
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: 'cb',
        from: FROM,
        chat_instance: 'ci',
        data: `rate:${MILK}:4`,
        message: { message_id: 10, date: 0, chat: CHAT, text: 'Вчера · SAS\nМолоко — как вам?' },
      },
    })
    return reportFailure
  }

  it('RESPONSE_INVALID у оценки — в API как callback:rate', async () => {
    const reportFailure = await pressScale(new ApiError(ISSUE.RESPONSE_INVALID))
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'ApiError', handler: 'callback:rate' }),
    )
    expect(JSON.stringify(reportFailure.mock.calls)).not.toMatch(new RegExp(MILK))
  })

  it('отказ из реестра — не дефект', async () => {
    expect(await pressScale(new ApiError(ERROR.NOT_FOUND))).not.toHaveBeenCalled()
  })
})
