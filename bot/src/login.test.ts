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
  confirmed: false,
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
  let shown: unknown
  const bot = new Bot('42:TEST', { botInfo: BOT_INFO })
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload: payload })
    if (options.failing?.includes(method)) {
      return Promise.resolve({
        ok: false,
        error_code: 400,
        description: 'Bad Request: message can not be edited',
      }) as never
    }
    // Telegram as it is: a message cannot be rewritten with the text it already carries. The
    // bot has to tell that apart from «cannot be edited», so the fake has to produce it.
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
    }
    return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
  }
  bot.api.config.use(transformer)
  bot.use(loginComposer({ api: api as MolviaBotClient, appUrl: APP_URL }))
  return { bot, calls }
}

const FROM = { id: 777, is_bot: false, first_name: 'Вова' }
const CHAT = { id: 777, type: 'private' as const, first_name: 'Вова' }

/** Нажатие всегда приходит от сообщения, у которого есть клавиатура. */
const MESSAGE_WITH_BUTTONS = {
  message_id: 10,
  date: 0,
  chat: CHAT,
  from: { ...FROM, id: 42, is_bot: true },
  text: 'Впустить это устройство в ваш аккаунт Molvia?',
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'Войти', callback_data: `login:ok:${CODE}` },
        { text: 'Это не я', callback_data: `login:no:${CODE}` },
      ],
    ],
  },
}

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
    // Вопрос задан от лица хозяина аккаунта, а не входящего, и называет последствие (З-2):
    // «Войти в Molvia?» читается как «войти мне» — ровно наоборот тому, от чего кнопка.
    expect(payload?.text).toContain('Впустить это устройство в ваш аккаунт Molvia?')
    expect(payload?.text).toContain('получит доступ к вашим покупкам')
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

  it('уже подтверждённый код — «вернитесь в приложение», а не мёртвая ссылка', async () => {
    // Человек открывает ссылку второй раз ровно после того, как бот сказал «попробуйте ещё
    // раз»: подтверждение записано, ответ потерян. Сказать ему здесь «начните вход заново» —
    // вторая неправда подряд, пока браузер уже забирает сессию (О-2).
    const confirmLogin = vi.fn()
    const { bot, calls } = harness({
      previewLogin: vi.fn().mockResolvedValue({ ...PREVIEW, confirmed: true }),
      confirmLogin,
    })

    await bot.handleUpdate(message(`/start ${CODE}`))

    const payload = sent(calls, 'sendMessage')
    expect(String(payload?.text)).toContain('Этот вход уже подтверждён')
    expect(confirmLogin).not.toHaveBeenCalled()
  })

  it('на уже подтверждённом остаётся «Это не я» — кто подтвердил, бот не знает', async () => {
    // Другая сторона Р-7: ссылка жертвы утекла, посторонний подтвердил её своим Telegram, и
    // браузер жертвы вот-вот заберёт сессию **чужого** аккаунта. Превью говорит «подтверждён»,
    // но не кем (Р-11), так что эту фразу читают оба — и тому, кого угоняют, чистое «вернитесь,
    // приложение узнает вас само» было бы успокоением в худший момент (Б1). `decline` на
    // подтверждённом живом запросе работает, и кнопка — единственный путь к нему.
    const { bot, calls } = harness({
      previewLogin: vi.fn().mockResolvedValue({ ...PREVIEW, confirmed: true }),
    })

    await bot.handleUpdate(message(`/start ${CODE}`))

    const payload = sent(calls, 'sendMessage')
    expect(String(payload?.text)).toContain('Если подтверждали не вы')
    expect(payload?.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Это не я', callback_data: `login:no:${CODE}` }]],
    })
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

    expect(sent(calls, 'sendMessage')?.text).toBe(
      'Не дождался ответа. Попробуйте ещё раз через минуту.',
    )
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

  it('второе нажатие своим же аккаунтом не добавляет в чат второй реплики', async () => {
    // Оба нажатия уходят раньше, чем правка первого долетела: кнопки ещё на экране, а у полки
    // на медленной связи это обычное дело. **Второй `confirm` теперь успешен** — он идемпотентен
    // для того же аккаунта (О-2), — и подделывать его отказом значило бы проверять путь, которого
    // в продукте больше нет (селфревью П-1). Настоящий путь упирается в Telegram: правка тем же
    // текстом отвергается, и раньше это читалось как «сообщения нет», а в чат уходил дубль (Б2).
    const confirmLogin = vi.fn().mockResolvedValue(undefined)
    const { bot, calls } = harness({ confirmLogin })

    await bot.handleUpdate(press(`login:ok:${CODE}`))
    await bot.handleUpdate(press(`login:ok:${CODE}`))

    expect(confirmLogin).toHaveBeenCalledTimes(2)
    expect(calls.filter((call) => call.method === 'sendMessage')).toEqual([])
    const said = calls
      .filter((call) => call.method === 'editMessageText')
      .map((call) => String(call.payload.text))
    expect(said).toEqual([
      'Вход подтверждён. Вернитесь в Molvia — приложение узнает вас само.',
      'Вход подтверждён. Вернитесь в Molvia — приложение узнает вас само.',
    ])
    expect(calls.filter((call) => call.method === 'answerCallbackQuery')).toHaveLength(2)
  })

  it('второе нажатие после того, как сессию забрали, не затирает исход', async () => {
    // Второй `confirm` того же аккаунта успешен, пока запрос жив (О-2). Отказ здесь означает,
    // что запрос уже погашен — сессию забрали или её погасило «Это не я». Бот обязан не
    // превратить это в ложь: отказ показывается **над** сообщением и оставляет исход
    // последним словом (О-1).
    const confirmLogin = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(ERROR.LOGIN_UNAVAILABLE))
    const { bot, calls } = harness({ confirmLogin })

    await bot.handleUpdate(press(`login:ok:${CODE}`))
    await bot.handleUpdate(press(`login:ok:${CODE}`))

    const edits = calls.filter((call) => call.method === 'editMessageText')
    expect(edits).toHaveLength(1)
    expect(String(edits[0]?.payload.text)).toContain('Вход подтверждён')
    expect(calls.filter((call) => call.method === 'sendMessage')).toEqual([])
    const answers = calls.filter((call) => call.method === 'answerCallbackQuery')
    expect(String(answers.at(-1)?.payload.text)).toContain('больше не действует')
  })

  it('«Это не я» дважды — «никто не вошёл» остаётся последним словом', async () => {
    // Зеркало предыдущего: человеку, который только что сказал «это не я», нельзя ответить
    // предложением войти заново.
    const declineLogin = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(ERROR.LOGIN_UNAVAILABLE))
    const { bot, calls } = harness({ declineLogin })

    await bot.handleUpdate(press(`login:no:${CODE}`))
    await bot.handleUpdate(press(`login:no:${CODE}`))

    const said = calls
      .filter((call) => call.method === 'editMessageText' || call.method === 'sendMessage')
      .map((call) => String(call.payload.text))
    expect(said).toEqual(['Вход отклонён. В аккаунт никто не вошёл.'])
  })

  it('сбой API оставляет кнопки на месте — «попробуйте ещё раз» иначе не о чем', async () => {
    // Мёртвой ссылке нажимать нечего, и кнопки у неё снимаются. А у «API не ответил» —
    // ровно наоборот: текст просит повторить, и повторять должно быть чем (О-3).
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness({
      confirmLogin: vi.fn().mockRejectedValue(new ApiError(ERROR.INTERNAL, 'down', false)),
    })

    await bot.handleUpdate(press(`login:ok:${CODE}`))

    expect(calls.filter((call) => call.method === 'editMessageReplyMarkup')).toEqual([])
    expect(calls.filter((call) => call.method === 'editMessageText')).toEqual([])
    expect(String(sent(calls, 'answerCallbackQuery')?.text)).toContain('Попробуйте ещё раз')
  })

  it('мёртвая ссылка снимает кнопки, ничего не переписывая', async () => {
    const { bot, calls } = harness({
      confirmLogin: vi.fn().mockRejectedValue(new ApiError(ERROR.LOGIN_UNAVAILABLE)),
    })

    await bot.handleUpdate(press(`login:ok:${CODE}`))

    expect(calls.filter((call) => call.method === 'editMessageText')).toEqual([])
    expect(calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(true)
  })

  it('часик гасится и тогда, когда переписать сообщение не удалось вовсе', async () => {
    // Подтверждение прошло, а Telegram отказывает на обоих путях ответа. Ответ человек
    // потеряет, но часик под пальцем остаться крутиться не должен, поэтому гашение стоит
    // впереди правки, а не следом за ней.
    const { bot, calls } = harness(
      { confirmLogin: vi.fn().mockResolvedValue(undefined) },
      { failing: ['editMessageText', 'sendMessage'] },
    )

    await expect(bot.handleUpdate(press(`login:ok:${CODE}`))).rejects.toThrow()

    expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true)
  })

  it('отказ, который не показать, не пишется никуда — ни в сообщение, ни под него', async () => {
    // Всплывашка — единственный канал отказа (О-1), и когда Telegram её не принимает, бот
    // молчит. Два запасных пути это опровергли: сообщение под вопросом оставалось в чате
    // навсегда и удачный повтор переписывал вопрос **выше** него (Г1), а правка самого
    // вопроса стирала «Вход подтверждён» и возвращала кнопки, потому что «API не ответил»
    // вовсе не значит, что не удалось ни одно нажатие — API мог ответить первому и не
    // ответить второму (Д1). Кнопки остаются, и следующее нажатие несёт свежий запрос,
    // на который ответить можно.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness(
      { confirmLogin: vi.fn().mockRejectedValue(new ApiError(ERROR.INTERNAL, 'aborted', false)) },
      { failing: ['answerCallbackQuery'] },
    )

    await bot.handleUpdate(press(`login:ok:${CODE}`, { message: MESSAGE_WITH_BUTTONS }))

    expect(calls.filter((call) => call.method === 'sendMessage')).toEqual([])
    expect(calls.filter((call) => call.method === 'editMessageText')).toEqual([])
    expect(calls.filter((call) => call.method === 'editMessageReplyMarkup')).toEqual([])
  })

  it('удавшийся вход не переписывается отказом следующего нажатия', async () => {
    // Двойной тап, и API заболел ровно между ними: первое нажатие подтвердило вход, второе
    // упёрлось в таймаут и устарело. В чате должен остаться исход, а не отказ с вернувшимися
    // кнопками — среди которых «Это не я» погасило бы этому же человеку его собственный
    // подтверждённый вход (Д1).
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const confirmLogin = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'aborted', false))
    const { bot, calls } = harness({ confirmLogin }, { failing: ['answerCallbackQuery'] })

    await bot.handleUpdate(press(`login:ok:${CODE}`, { message: MESSAGE_WITH_BUTTONS }))
    await bot.handleUpdate(press(`login:ok:${CODE}`, { message: MESSAGE_WITH_BUTTONS }))

    const said = calls
      .filter((call) => call.method === 'editMessageText' || call.method === 'sendMessage')
      .map((call) => String(call.payload.text))
    expect(said).toEqual(['Вход подтверждён. Вернитесь в Molvia — приложение узнает вас само.'])
  })

  it('мёртвая ссылка на устаревшем нажатии теряет кнопки и ничего не пишет', async () => {
    // `dropKeyboard` стоял после ответа на нажатие и вместе с ним пропускался: у мёртвой
    // ссылки оставались кнопки, и следующий тап находил то же самое ничто (В1). Слова человек
    // получит, открыв ссылку заново, а исчезнувшие кнопки — сигнал, который писать в чат не
    // нужно.
    const { bot, calls } = harness(
      { declineLogin: vi.fn().mockRejectedValue(new ApiError(ERROR.LOGIN_UNAVAILABLE)) },
      { failing: ['answerCallbackQuery'] },
    )

    await bot.handleUpdate(press(`login:no:${CODE}`, { message: MESSAGE_WITH_BUTTONS }))

    expect(calls.filter((call) => call.method === 'sendMessage')).toEqual([])
    expect(calls.filter((call) => call.method === 'editMessageText')).toEqual([])
    expect(calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(true)
  })

  it('устаревшее нажатие не мешает записать исход и не зовёт сбоем удавшийся вход', async () => {
    // «query is too old» — то, чем Telegram считает нажатие, прождавшее таймаут клиента в
    // пятнадцать секунд или перезапуск бота. С ответом на нажатие впереди исход не
    // записывался вовсе (П-2), а его же ошибка, отпущенная наружу, писала в лог «update
    // failed» о входе, который состоялся (Г2) — ровно то, что убирал З-4.
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot, calls } = harness(
      { confirmLogin: vi.fn().mockResolvedValue(undefined) },
      { failing: ['answerCallbackQuery'] },
    )

    await bot.handleUpdate(press(`login:ok:${CODE}`))

    expect(String(sent(calls, 'editMessageText')?.text)).toContain('Вход подтверждён')
    expect(log).not.toHaveBeenCalled()
  })

  it('сбой Telegram после удачного подтверждения не называется сбоем входа', async () => {
    // Раньше `settle` стоял внутри того же `try`, что и вызов API: упавшая правка приводила
    // к «Не получилось, попробуйте ещё раз» поверх уже выданной сессии и к строке в логе,
    // называющей сломанным не то (З-4).
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { bot } = harness(
      { confirmLogin: vi.fn().mockResolvedValue(undefined) },
      { failing: ['editMessageText', 'sendMessage'] },
    )

    await expect(bot.handleUpdate(press(`login:ok:${CODE}`))).rejects.toThrow()

    expect(log).not.toHaveBeenCalled()
  })

  it('кнопка с пустым кодом — мёртвая ссылка, а не вечный часик', async () => {
    // Фильтр, который такую кнопку не узнаёт, оставил бы часик крутиться навсегда: обработчик
    // не вызвался бы вовсе. Пустой код доходит до клиента и получает тот же отказ, что мусор.
    const declineLogin = vi.fn().mockRejectedValue(new ApiError(ISSUE.PATH_INVALID, 'code'))
    const { bot, calls } = harness({ declineLogin })

    await bot.handleUpdate(press('login:no:'))

    expect(declineLogin).toHaveBeenCalledExactlyOnceWith('')
    expect(String(sent(calls, 'answerCallbackQuery')?.text)).toContain('больше не действует')
  })

  it('кнопка формата, которого бот не знает, тоже гасится', async () => {
    // Вопросы, уже разосланные людям, живут в чатах вечно, и смена формата кнопки —
    // ровно то, что делал коммит 0708da3. Без этого часик у нажавшего не остановится (О-7).
    const confirmLogin = vi.fn()
    const { bot, calls } = harness({ confirmLogin })

    await bot.handleUpdate(press(`auth:ok:${CODE}`))
    await bot.handleUpdate(press('login:ok'))

    expect(confirmLogin).not.toHaveBeenCalled()
    const answers = calls.filter((call) => call.method === 'answerCallbackQuery')
    expect(answers).toHaveLength(2)
    for (const answer of answers) expect(String(answer.payload.text)).toContain('не действует')
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

  it('служебные сообщения приветствием не встречаются', async () => {
    // Telegram называет сообщением и закреп, и выданное право писать, и — с 0.3 — оплату
    // звёздами за чаевые. «Вход начинается в приложении» в ответ на каждое из них — не то,
    // о чём был Q5: там сказано «произвольный текст» (О-6).
    const { bot, calls } = harness()
    const service = (over: Record<string, unknown>): Update => ({
      update_id: 3,
      message: { message_id: 11, date: 0, chat: CHAT, from: FROM, ...over },
    })

    await bot.handleUpdate(service({ pinned_message: { message_id: 10, date: 0, chat: CHAT } }))
    await bot.handleUpdate(service({ write_access_allowed: { from_request: true } }))
    await bot.handleUpdate(
      service({
        successful_payment: {
          currency: 'XTR',
          total_amount: 50,
          invoice_payload: 'tip',
          telegram_payment_charge_id: 'c',
          provider_payment_charge_id: 'p',
        },
      }),
    )

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
