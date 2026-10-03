import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { OwnerNotice, OwnerNotices } from '@molvia/model'
import { ownerText, startOwnerNotices, tellOwner } from './owner'

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
  it('остановка посреди пачки досылает остаток без пауз — они уже выданы (А4)', async () => {
    const { api, sent } = telegram()
    const claim = vi.fn(() =>
      Promise.resolve<OwnerNotices>({ to: OWNER, notices: [NEW, AGAIN, NEW, AGAIN, NEW] }),
    )
    const stop = startOwnerNotices(
      { claimOwnerNotices: claim } as unknown as MolviaBotClient,
      api,
      60_000,
    )
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    await stop()
    expect(sent).toHaveLength(5)
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
})
