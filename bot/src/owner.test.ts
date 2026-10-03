import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { OwnerNotice, OwnerNotices } from '@molvia/model'
import { OWNER_STOP_BUDGET_MS, ownerText, startOwnerNotices, tellOwner } from './owner'

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
  } as unknown as MolviaBotClient
}

const noWait = () => Promise.resolve(true)

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
