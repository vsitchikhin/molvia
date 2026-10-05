import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { OwnerNotice, OwnerNotices } from '@molvia/model'
import { FEEDBACK_KINDS } from '@molvia/model'
import {
  MERGE_TEXT_MAX,
  OWNER_STOP_BUDGET_MS,
  ownerText,
  startOwnerNotices,
  tellOwner,
  threadTagOf,
} from './owner'

const OWNER = 4242
const NEW: OwnerNotice = {
  kind: 'failure',
  source: 'api',
  errorName: 'TypeError',
  route: 'PUT /verdicts/:itemId',
  build: 'v0.2.0-4-gabc1234',
  frame: 'at rateItem (src/usecases/rate-item.ts:42:7)',
  fingerprint: '3f9a1c',
}
const AGAIN: OwnerNotice = {
  kind: 'failure_count',
  source: 'bot',
  errorName: 'GrammyError',
  code: 'TELEGRAM_400',
  route: 'callback:rate',
  build: 'v0.2.0-4-gabc1234',
  count: 100,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function telegram(refuse?: number) {
  const sent: { chat: unknown; text: unknown }[] = []
  const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
  const transformer: Transformer = (_prev, _method, payload) => {
    const { chat_id: chat, text } = payload as { chat_id: unknown; text: unknown }
    sent.push({ chat, text })
    if (refuse !== undefined) {
      return Promise.resolve({ ok: false, error_code: refuse, description: 'no' }) as never
    }
    return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
  }
  bot.api.config.use(transformer)
  return { api: bot.api, sent }
}

function claiming(answer: OwnerNotices | Error): MolviaBotClient {
  return {
    claimOwnerNotices: vi.fn(() =>
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
    ),
    reportFailure: vi.fn(() => Promise.resolve()),
  } as unknown as MolviaBotClient
}

const noWait = () => Promise.resolve(true)

const MESSAGE: OwnerNotice = {
  kind: 'feedback',
  number: 42,
  thread: 42,
  feedbackKind: 'bug',
  text: 'Список «Что брать» не грузится, белый экран',
  locale: 'ru',
  pageBuild: 'v0.1.3-29-g873189fd',
  apiBuild: 'v0.1.3-30-gabc12345',
  route: 'advice',
  platform: 'ios 18 app',
  fromError: true,
  errorCode: 'issue.response_invalid',
  at: '2026-10-03T10:07:00.000Z',
}
const CONTINUED: OwnerNotice = {
  kind: 'feedback_continued',
  number: 57,
  thread: 42,
  quote: 'Починили, обновите приложение',
  text: 'Обновил, всё работает',
  at: '2026-10-03T11:02:00.000Z',
}

describe('ownerText — сообщение разработчику (MOL-148)', () => {
  it('вид и метка первой строкой, текст, что ушло с ним, время по Еревану', () => {
    const lines = ownerText(MESSAGE).split('\n')
    expect(lines.slice(0, 6)).toEqual([
      '🐞 Сломалось · #fb42',
      'Список «Что брать» не грузится, белый экран',
      '',
      'Экран advice · ios 18 app · ru',
      'Код issue.response_invalid',
      'Страница v0.1.3-29-g873189fd · API v0.1.3-30-gabc12345',
    ])
    expect(lines[6]).toMatch(/^3 октября.*14:07$/)
    expect(lines).toHaveLength(7)
  })

  it('с экрана ошибки без кода — так и сказано; из настроек — ни строки о коде', () => {
    const noCode = ownerText({ ...MESSAGE, errorCode: null })
    expect(noCode).toContain('С экрана ошибки, без кода')
    const settings = ownerText({
      ...MESSAGE,
      feedbackKind: 'idea',
      fromError: false,
      errorCode: null,
      pageBuild: null,
    })
    expect(settings).not.toMatch(/Код|ошибки/)
    expect(settings).toContain('Страница — · API')
    expect(settings.split('\n')[0]).toBe('💡 Идея · #fb42')
  })

  it('продолжение: та же метка, цитата ответа, слово человека', () => {
    const lines = ownerText(CONTINUED).split('\n')
    expect(lines.slice(0, 4)).toEqual([
      '↩️ Продолжение · #fb42',
      '> Починили, обновите приложение',
      'Обновил, всё работает',
      '',
    ])
    expect(lines[4]).toMatch(/^3 октября.*15:02$/)
  })

  it('метка не теряется из ключа: каждый вид и продолжение читаются обратно в номер нити', () => {
    for (const feedbackKind of FEEDBACK_KINDS) {
      expect(threadTagOf(ownerText({ ...MESSAGE, feedbackKind }))).toBe(42)
    }
    expect(threadTagOf(ownerText(CONTINUED))).toBe(42)
  })

  it('метка читается только с конца первой строки', () => {
    expect(threadTagOf('Ответ на ваше сообщение от 3 октября:\n\nСм. #fb7')).toBeNull()
    expect(threadTagOf('🐞 Сломалось · #fb42 и ещё')).toBeNull()
    expect(threadTagOf('🐞 Сломалось · #fb042')).toBeNull()
    expect(threadTagOf('🐞 Сломалось · #fb99999999999999999')).toBeNull()
    expect(threadTagOf('')).toBeNull()
  })
})

describe('ownerText — что прочитает владелец (MOL-143)', () => {
  it('новый сбой: откуда, вид и место, кадр, сборка с отпечатком, где подробности', () => {
    expect(ownerText(NEW)).toBe(
      [
        '🔴 Новый сбой · api',
        'TypeError · PUT /verdicts/:itemId',
        'at rateItem (src/usecases/rate-item.ts:42:7)',
        'Сборка v0.2.0-4-gabc1234 · 3f9a1c',
        'Подробности — make failures',
      ].join('\n'),
    )
  })

  it('порог: сколько, вид с кодом и место, сборка', () => {
    expect(ownerText(AGAIN)).toBe(
      [
        '🟠 Уже 100 раз в этой сборке · bot',
        'GrammyError TELEGRAM_400 · callback:rate',
        'Сборка v0.2.0-4-gabc1234',
      ].join('\n'),
    )
  })

  it('сбой телефона называет платформу (MOL-144)', () => {
    const phone: OwnerNotice = {
      kind: 'failure',
      source: 'phone',
      errorName: 'TypeError',
      route: 'screen:advice',
      build: 'index-BTCsHrpw',
      platform: 'ios 18 app',
      frame: 'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
      fingerprint: '7c21e0',
    }
    expect(ownerText(phone)).toBe(
      [
        '🔴 Новый сбой · phone',
        'TypeError · screen:advice',
        'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
        'Платформа ios 18 app',
        'Сборка index-BTCsHrpw · 7c21e0',
        'Подробности — make failures',
      ].join('\n'),
    )
    expect(ownerText({ ...phone, kind: 'failure_count', count: 10 })).toContain(
      'Платформа ios 18 app\nСборка index-BTCsHrpw',
    )
  })

  it('скрытые уведомления о телефоне — сколько и где смотреть (MOL-144, ревью №7)', () => {
    expect(ownerText({ kind: 'failure_muted', source: 'phone', count: 37 })).toBe(
      ['🔕 Скрыто уведомлений о сбоях телефона: 37', 'Подробности — make failures'].join('\n'),
    )
    expect(ownerText({ kind: 'failure_muted', source: 'phone', count: 2, unwritten: 5 })).toBe(
      [
        '🔕 Скрыто уведомлений о сбоях телефона: 2',
        '🔕 Не записано новых сбоев телефона: 5 — предел строк часа',
        'Подробности — make failures',
      ].join('\n'),
    )
    // Only the unwritten: no «скрыто: 0», and nothing to look for in `make failures` (review №10).
    expect(ownerText({ kind: 'failure_muted', source: 'phone', count: 0, unwritten: 3 })).toBe(
      '🔕 Не записано новых сбоев телефона: 3 — предел строк часа',
    )
  })

  it('без маршрута и без кадра — так и сказано, пустых строк нет', () => {
    const bare: OwnerNotice = {
      kind: 'failure',
      source: 'api',
      errorName: 'Error',
      build: 'dev',
      fingerprint: 'abcdef',
    }
    expect(ownerText(bare)).toBe(
      [
        '🔴 Новый сбой · api',
        'Error · без маршрута',
        'Сборка dev · abcdef',
        'Подробности — make failures',
      ].join('\n'),
    )
  })
})

describe('tellOwner — уведомление о сообщении ушло, и API это знает (MOL-148, адверсариальное В1)', () => {
  function client(notices: OwnerNotice[]) {
    const ownerNoticesSent = vi.fn<MolviaBotClient['ownerNoticesSent']>(() => Promise.resolve())
    const api = {
      claimOwnerNotices: vi.fn(() => Promise.resolve({ to: OWNER, notices })),
      ownerNoticesSent,
      reportFailure: vi.fn(() => Promise.resolve()),
    } as unknown as MolviaBotClient
    return { api, ownerNoticesSent }
  }

  it('отправленные сообщения называются API по номерам, сбой — нет', async () => {
    const { api: telegramApi } = telegram()
    const { api, ownerNoticesSent } = client([NEW, MESSAGE, CONTINUED])

    await tellOwner(api, telegramApi, noWait)

    expect(ownerNoticesSent.mock.calls.map((call) => call[0] as unknown)).toEqual([[42], [57]])
  })

  it('Telegram отказал как есть (400) — отчёт о сбое owner:send; погода (502) — без отчёта', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const [code, reported] of [
      [400, true],
      [502, false],
    ] as const) {
      const { api: telegramApi } = telegram(code)
      const { api } = client([MESSAGE])

      await tellOwner(api, telegramApi, noWait)

      const reports = (api.reportFailure as ReturnType<typeof vi.fn>).mock.calls
      expect(reports.length > 0).toBe(reported)
      if (reported)
        expect(reports[0]?.[0]).toMatchObject({ handler: 'owner:send', code: 'TELEGRAM_400' })
    }
  })

  it('Telegram не принял (502, 429) — не названо: API выдаст его снова', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const code of [502, 429]) {
      const { api: telegramApi } = telegram(code)
      const { api, ownerNoticesSent } = client([MESSAGE, CONTINUED])

      await tellOwner(api, telegramApi, noWait)

      expect(ownerNoticesSent).not.toHaveBeenCalled()
    }
  })

  it('слово «ушло» не дошло до API — строка в логе, остальные отправляются', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api: telegramApi, sent } = telegram()
    const { api, ownerNoticesSent } = client([MESSAGE, CONTINUED])
    ownerNoticesSent.mockImplementationOnce(() => Promise.reject(new ApiError(ERROR.INTERNAL)))

    await tellOwner(api, telegramApi, noWait)

    expect(sent).toHaveLength(2)
    expect(errors).toHaveBeenCalledWith('[molvia] owner notice sent: error.internal')
  })
})

describe('tellOwner — забрать и отправить', () => {
  it('каждое уведомление — сообщение владельцу, по очереди', async () => {
    const { api, sent } = telegram()
    await tellOwner(claiming({ to: OWNER, notices: [NEW, AGAIN] }), api, noWait)
    expect(sent.map((message) => message.chat)).toEqual([OWNER, OWNER])
    expect(sent[1]?.text).toBe(ownerText(AGAIN))
  })

  it('писать некому — ни одного сообщения', async () => {
    const { api, sent } = telegram()
    await tellOwner(claiming({ to: null, notices: [] }), api, noWait)
    expect(sent).toEqual([])
  })

  it('API не ответил — строка в логе по коду', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, sent } = telegram()
    await tellOwner(claiming(new ApiError(ERROR.INTERNAL)), api, noWait)
    expect(sent).toEqual([])
    expect(log).toHaveBeenCalledWith(`[molvia] owner claim: ${ERROR.INTERNAL}`)
  })

  it('429 кончает прогон: остальное ушло бы туда же', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, sent } = telegram(429)
    await tellOwner(claiming({ to: OWNER, notices: [NEW, AGAIN, NEW] }), api, noWait)
    expect(sent).toHaveLength(1)
  })

  it('отказ одного сообщения не держит остальные', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, sent } = telegram(400)
    await tellOwner(claiming({ to: OWNER, notices: [NEW, AGAIN] }), api, noWait)
    expect(sent).toHaveLength(2)
    expect(log).toHaveBeenCalledWith('[molvia] owner notice: 400')
  })
})

describe('startOwnerNotices — таймер раз в минуту', () => {
  it('остановка посреди пачки досылает остаток в прежнем темпе — они уже выданы (А4, Б3)', async () => {
    const { api, sent } = telegram()
    const claim = vi.fn(() =>
      Promise.resolve<OwnerNotices>({ to: OWNER, notices: [NEW, AGAIN, NEW, AGAIN, NEW] }),
    )
    const stop = startOwnerNotices(
      { claimOwnerNotices: claim } as unknown as MolviaBotClient,
      api,
      60_000,
      50,
    )
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    const stopped = performance.now()
    await stop()
    expect(sent).toHaveLength(5)
    // Four pauses of 50 ms after the stop: the pace held — without it they went in a few ms (Б3).
    expect(performance.now() - stopped).toBeGreaterThanOrEqual(180)
  })

  it('отправка, повисшая к концу времени остановки, обрывается, и остаток назван (В1)', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
    // The first message goes; the second hangs, as a stuck socket does, until its signal fires.
    const transformer: Transformer = (_prev, _method, _payload, signal) => {
      calls += 1
      if (calls === 1) return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      }) as never
    }
    bot.api.config.use(transformer)
    const claim = vi.fn(() =>
      Promise.resolve<OwnerNotices>({ to: OWNER, notices: [NEW, AGAIN, NEW, AGAIN] }),
    )
    const stop = startOwnerNotices(
      { claimOwnerNotices: claim } as unknown as MolviaBotClient,
      bot.api,
      60_000,
      50,
    )
    await vi.advanceTimersByTimeAsync(60)
    expect(calls).toBe(2)

    const stopped = stop()
    await vi.advanceTimersByTimeAsync(OWNER_STOP_BUDGET_MS)
    await stopped
    expect(log).toHaveBeenCalledWith('[molvia] owner: stopping, 3 notices given up')
  })

  it('429 кончает прогон и говорит, сколько ушло с ним', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api } = telegram(429)
    await tellOwner(claiming({ to: OWNER, notices: [NEW, AGAIN, NEW] }), api, noWait)
    expect(log).toHaveBeenCalledWith('[molvia] owner: 429 flood, 2 notices given up')
  })

  it('спрашивает при старте и каждую минуту, остановка ждёт хвост', async () => {
    vi.useFakeTimers()
    const { api } = telegram()
    const claim = vi.fn(() => Promise.resolve<OwnerNotices>({ to: OWNER, notices: [] }))
    const stop = startOwnerNotices(
      { claimOwnerNotices: claim } as unknown as MolviaBotClient,
      api,
      60_000,
    )
    await vi.advanceTimersByTimeAsync(120_000)
    expect(claim).toHaveBeenCalledTimes(3)
    await stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(claim).toHaveBeenCalledTimes(3)
  })

  it('время остановки кончилось — остаток назван в логе, а не отправлен скопом', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, sent } = telegram()
    const claim = vi.fn(() =>
      Promise.resolve<OwnerNotices>({ to: OWNER, notices: [NEW, AGAIN, NEW] }),
    )
    // A pause longer than the whole budget: after the stop not one more fits.
    const stop = startOwnerNotices(
      { claimOwnerNotices: claim } as unknown as MolviaBotClient,
      api,
      60_000,
      OWNER_STOP_BUDGET_MS + 1,
    )
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    await stop()
    expect(sent).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('[molvia] owner: stopping, 2 notices given up')
  })

  it('claim, повисший к концу времени остановки, обрывается, и это сказано (№16)', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, sent } = telegram()
    // The API answers only when told to stop waiting: a lock in its database, say.
    const claim = vi.fn(
      (signal?: AbortSignal) =>
        new Promise<OwnerNotices>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        }),
    )
    const stop = startOwnerNotices(
      { claimOwnerNotices: claim } as unknown as MolviaBotClient,
      api,
      60_000,
      50,
    )
    const stopped = stop()
    await vi.advanceTimersByTimeAsync(OWNER_STOP_BUDGET_MS)
    await stopped
    expect(sent).toEqual([])
    expect(log).toHaveBeenCalledWith('[molvia] owner: stopping, the claim under way given up')
  })
})

describe('tellOwner — снимки после уведомления (MOL-167, Р-5)', () => {
  const WITH_PICTURES: OwnerNotice = { ...MESSAGE, pictures: 2 }
  const PHOTO_WORD: OwnerNotice = { ...CONTINUED, text: '', pictures: 1 }
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')

  function calls(refuse: (method: string) => number | 'network' | undefined = () => undefined) {
    const made: { method: string; payload: Record<string, unknown> }[] = []
    const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
    const transformer: Transformer = (_prev, method, payload) => {
      made.push({ method, payload: payload })
      const code = refuse(method)
      if (code === 'network') return Promise.reject(new Error('reset'))
      if (code !== undefined) {
        return Promise.resolve({ ok: false, error_code: code, description: 'no' }) as never
      }
      return Promise.resolve({ ok: true, result: { message_id: 700 + made.length } }) as never
    }
    bot.api.config.use(transformer)
    return { telegramApi: bot.api, made }
  }

  function client(notices: OwnerNotice[], pictures: MolviaBotClient['feedbackPicture']) {
    const ownerNoticesSent = vi.fn<MolviaBotClient['ownerNoticesSent']>(() => Promise.resolve())
    const feedbackPicture = vi.fn(pictures)
    const api = {
      claimOwnerNotices: vi.fn(() => Promise.resolve({ to: OWNER, notices })),
      ownerNoticesSent,
      feedbackPicture,
      reportFailure: vi.fn(() => Promise.resolve()),
    } as unknown as MolviaBotClient
    return { api, ownerNoticesSent, feedbackPicture }
  }

  const phone: MolviaBotClient['feedbackPicture'] = () =>
    Promise.resolve({ source: 'phone', jpeg: JPEG })

  it('текст, затем каждый снимок ответом на него с меткой в подписи; «ушло» — после всех', async () => {
    const { telegramApi, made } = calls()
    const { api, ownerNoticesSent, feedbackPicture } = client([WITH_PICTURES], phone)

    await tellOwner(api, telegramApi, noWait)

    expect(made.map((call) => call.method)).toEqual(['sendMessage', 'sendPhoto', 'sendPhoto'])
    expect(made[0]?.payload.text).toContain('Снимков: 2')
    expect(
      made.slice(1).map((call) => [call.payload.caption, call.payload.reply_parameters]),
    ).toEqual([
      ['Снимок 1 из 2 · #fb42', { message_id: 701, allow_sending_without_reply: true }],
      ['Снимок 2 из 2 · #fb42', { message_id: 701, allow_sending_without_reply: true }],
    ])
    expect(threadTagOf(String(made[1]?.payload.caption))).toBe(42)
    expect(feedbackPicture.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [42, 1],
      [42, 2],
    ])
    expect(ownerNoticesSent.mock.calls.map((call) => call[0] as unknown)).toEqual([[42]])
  })

  it('фото из бота — по id Telegram, не пересылкой; без текста — пометка', async () => {
    const { telegramApi, made } = calls()
    const { api } = client([PHOTO_WORD], () =>
      Promise.resolve({ source: 'telegram', fileId: 'AgAC-large' }),
    )

    await tellOwner(api, telegramApi, noWait)

    expect(made[0]?.payload.text).toContain('(без текста, только снимок)')
    expect(made[1]).toMatchObject({
      method: 'sendPhoto',
      payload: { photo: 'AgAC-large', caption: 'Снимок 1 из 1 · #fb42' },
    })
  })

  it('снимок Telegram отверг (400) или его уже нет — остальное идёт, сообщение «ушло»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let photos = 0
    const { telegramApi, made } = calls((method) =>
      method === 'sendPhoto' && ++photos === 1 ? 400 : undefined,
    )
    const { api, ownerNoticesSent } = client(
      [WITH_PICTURES, { ...WITH_PICTURES, number: 43, thread: 43 }],
      (number) => (number === 43 ? Promise.resolve(null) : phone(number, 1)),
    )

    await tellOwner(api, telegramApi, noWait)

    expect(made.filter((call) => call.method === 'sendPhoto')).toHaveLength(2)
    expect(ownerNoticesSent.mock.calls.map((call) => call[0] as unknown)).toEqual([[42], [43]])
    // Gone or refused, a picture went to nobody: the API is told, and does not mark it sent (А4).
    expect(ownerNoticesSent.mock.calls.map((call) => call[2] as unknown)).toEqual([
      [{ message: 42, position: 1 }],
      [
        { message: 43, position: 1 },
        { message: 43, position: 2 },
      ],
    ])
    expect((api.reportFailure as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      handler: 'owner:picture',
    })
  })

  it('связь оборвалась на снимке или API не отдал его — «ушло» не сказано: уведомление придёт снова', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const [refuse, pictures] of [
      [(method: string) => (method === 'sendPhoto' ? ('network' as const) : undefined), phone],
      [() => undefined, () => Promise.reject(new ApiError(ERROR.INTERNAL))],
      [(method: string) => (method === 'sendPhoto' ? 429 : undefined), phone],
    ] as const) {
      const { telegramApi } = calls(refuse)
      const { api, ownerNoticesSent } = client([WITH_PICTURES], pictures)

      await tellOwner(api, telegramApi, noWait)

      expect(ownerNoticesSent).not.toHaveBeenCalled()
    }
  })
})

describe('tellOwner — 429 на снимке кончает прогон, как на тексте (ревью 4)', () => {
  it('следующее уведомление не отправляется, «ушло» не сказано', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const made: string[] = []
    const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
    const transformer: Transformer = (_prev, method) => {
      made.push(method)
      if (method === 'sendPhoto') {
        return Promise.resolve({ ok: false, error_code: 429, description: 'flood' }) as never
      }
      return Promise.resolve({ ok: true, result: { message_id: 7 } }) as never
    }
    bot.api.config.use(transformer)
    const ownerNoticesSent = vi.fn<MolviaBotClient['ownerNoticesSent']>(() => Promise.resolve())
    const api = {
      claimOwnerNotices: vi.fn(() =>
        Promise.resolve({
          to: OWNER,
          notices: [{ ...MESSAGE, pictures: 1 }, CONTINUED],
        }),
      ),
      ownerNoticesSent,
      feedbackPicture: vi.fn(() => Promise.resolve({ source: 'phone' as const, jpeg: '/9j/2Q==' })),
      reportFailure: vi.fn(() => Promise.resolve()),
    } as unknown as MolviaBotClient

    await tellOwner(api, bot.api, noWait)

    expect(made).toEqual(['sendMessage', 'sendPhoto'])
    expect(ownerNoticesSent).not.toHaveBeenCalled()
  })
})

describe('ownerText — утренний отчёт склейки (MOL-106)', () => {
  const FROM = '0a0b0c0d-0000-4000-8000-000000000001'
  const INTO = '0a0b0c0d-0000-4000-8000-000000000002'
  const NIGHT: OwnerNotice = {
    kind: 'catalogue_merged',
    day: '2026-10-06',
    mode: 'on',
    merged: 12,
    candidates: 1,
    mergedPairs: [
      { subject: 'item', from: 'Малоко 3,2%', into: 'Молоко 3,2%', id: 17 },
      { subject: 'place', from: 'Ереван  Сити', into: 'Ереван Сити', city: 'Гюмри', id: 18 },
    ],
    candidatePairs: [
      {
        subject: 'place',
        from: 'Yerevan City',
        into: 'Ереван Сити',
        fromId: FROM,
        intoId: INTO,
        city: 'Гюмри',
      },
    ],
  }

  it('names what merged with its number, places with their city, the rest counted', () => {
    expect(ownerText(NIGHT).split('\n')).toEqual([
      '🧩 Склейка за 2026-10-06: склеено 12, новых кандидатов 1',
      '',
      'Склеено',
      '#17 «Малоко 3,2%» → «Молоко 3,2%»',
      '#18 место «Ереван  Сити» → «Ереван Сити» · Гюмри',
      '…и ещё 10',
      '',
      'Кандидаты — склеить командой',
      'место «Yerevan City» → «Ереван Сити» · Гюмри',
      `make merge FROM=${FROM} INTO=${INTO}`,
      '',
      'Отменить — make unmerge ID=номер',
    ])
  })

  it('says only what would merge in the report mode, and offers no undo', () => {
    const lines = ownerText({
      ...NIGHT,
      mode: 'report',
      merged: 1,
      mergedPairs: [
        { subject: 'item', from: 'Малоко', into: 'Молоко', fromId: FROM, intoId: INTO },
      ],
      candidates: 0,
      candidatePairs: [],
    }).split('\n')
    expect(lines).toEqual([
      '🔎 Склейка за 2026-10-06, только отчёт: склеил бы 1, новых кандидатов 0',
      '',
      'Склеил бы',
      '«Малоко» → «Молоко»',
      `make apart FROM=${FROM} INTO=${INTO}`,
    ])
  })

  it('says the candidates past the printed ones come on the mornings after', () => {
    const text = ownerText({ ...NIGHT, merged: 0, mergedPairs: [], candidates: 3 })
    expect(text).toContain('…и ещё 2 — назову в следующие утра')
  })

  it('holds within what Telegram takes, and sends the cut candidates to the list (review №9)', () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const long = (n: number) => `${'Молоко ультрапастеризованное '.repeat(3)}${String(n)}`
    const city = 'Г'.repeat(120)
    for (const subject of ['item', 'place'] as const) {
      const text = ownerText({
        kind: 'catalogue_merged',
        day: '2026-10-06',
        mode: 'report',
        merged: 10,
        candidates: 12,
        mergedPairs: Array.from({ length: 10 }, (_, i) => ({
          subject,
          from: long(i),
          into: long(i + 50),
          ...(subject === 'place' ? { city } : {}),
          fromId: id(i),
          intoId: id(i + 50),
        })),
        candidatePairs: Array.from({ length: 10 }, (_, i) => ({
          subject,
          from: long(i + 100),
          into: long(i + 150),
          ...(subject === 'place' ? { city } : {}),
          fromId: id(i + 100),
          intoId: id(i + 150),
        })),
      })
      expect(text.length).toBeLessThanOrEqual(MERGE_TEXT_MAX)
      expect(text).toContain('не влезли в сообщение — все: make merge-candidates')
      expect(text).toContain('…и ещё 2 — назову в следующие утра')
    }
  })

  it('still says the night ran when nothing merged', () => {
    expect(
      ownerText({ ...NIGHT, merged: 0, candidates: 0, mergedPairs: [], candidatePairs: [] }),
    ).toBe('🧩 Склейка за 2026-10-06: склеено 0, новых кандидатов 0')
  })

  it('cuts a long name so ten pairs fit one message', () => {
    const long = 'Ж'.repeat(200)
    const text = ownerText({
      ...NIGHT,
      merged: 1,
      mergedPairs: [{ subject: 'item', from: long, into: 'Ж', id: 1 }],
      candidates: 0,
      candidatePairs: [],
    })
    expect(text).toContain(`«${'Ж'.repeat(59)}…»`)
  })
})
