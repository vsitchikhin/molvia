import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { DueBroadcast } from '@molvia/model'
import { BROADCAST_GAP_MS, broadcastDue, startBroadcasts } from './broadcast'
import { RETRY_AFTER_CAP_SECONDS } from './deliver'

const TEXT = 'Molvia: 12 октября …\n\nMolvia: on October 12 …'

const position = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A batch of the chats `chats`, each at the position of its number. */
function batch(id: number, chats: readonly number[]): DueBroadcast {
  return {
    broadcast: {
      id,
      text: TEXT,
      recipients: chats.map((chat) => ({ telegramUserId: chat, position: position(chat) })),
    },
  }
}

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

/**
 * Telegram, faked: every call recorded; the chats in `refused` answer with their code, and a chat in
 * `throttle` answers 429 the first time with its `retry_after`.
 */
function telegram(
  refused: Readonly<Record<number, number>> = {},
  throttle: Readonly<Record<number, number>> = {},
) {
  const calls: Call[] = []
  const throttled = new Set<number>()
  const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload })
    const chat = (payload as { readonly chat_id?: number }).chat_id ?? 0
    const retryAfter = throttle[chat]
    if (retryAfter !== undefined && !throttled.has(chat)) {
      throttled.add(chat)
      return Promise.resolve({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: retryAfter },
      }) as never
    }
    const code = refused[chat]
    if (code !== undefined) {
      return Promise.resolve({ ok: false, error_code: code, description: 'refused' }) as never
    }
    return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
  }
  bot.api.config.use(transformer)
  const sentTo = () =>
    calls
      .filter((call) => call.method === 'sendMessage')
      .map((call) => call.payload.chat_id as number)
  return { api: bot.api, calls, sentTo }
}

function client(answers: readonly (DueBroadcast | Error)[]) {
  const queue = [...answers]
  return {
    claimBroadcast: vi.fn(() => {
      const next = queue.shift() ?? { broadcast: null }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    }),
    broadcastDone: vi.fn<MolviaBotClient['broadcastDone']>(() => Promise.resolve()),
    switchReminders: vi.fn(() => Promise.resolve()),
    reportFailure: vi.fn(() => Promise.resolve()),
  }
}

const asClient = (fake: ReturnType<typeof client>) => fake as unknown as MolviaBotClient

function quiet() {
  return {
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  }
}

const noWait = vi.fn(() => Promise.resolve(true))

afterEach(() => {
  vi.restoreAllMocks()
  noWait.mockClear()
})

describe('broadcastDue — рассылка об утечке (MOL-237)', () => {
  it('пачку за пачкой, по порядку, текст как есть, без превью; слово о каждой пачке', async () => {
    quiet()
    const api = client([batch(7, [1, 2]), batch(7, [3])])
    const tg = telegram()

    await broadcastDue(asClient(api), tg.api, noWait)

    expect(tg.sentTo()).toEqual([1, 2, 3])
    expect(tg.calls[0]?.payload).toMatchObject({
      text: TEXT,
      link_preview_options: { is_disabled: true },
    })
    expect(tg.calls[0]?.payload).not.toHaveProperty('parse_mode')
    expect(api.broadcastDone.mock.calls.map(([report]) => report)).toEqual([
      { id: 7, through: position(2), sent: 2, blocked: 0, failed: 0 },
      { id: 7, through: position(3), sent: 1, blocked: 0, failed: 0 },
    ])
    expect(api.claimBroadcast).toHaveBeenCalledTimes(3)
  })

  it('не быстрее 25 в секунду: пауза между сообщениями, не перед первым', async () => {
    quiet()
    await broadcastDue(asClient(client([batch(1, [1, 2, 3])])), telegram().api, noWait)
    expect(noWait.mock.calls).toEqual([[BROADCAST_GAP_MS], [BROADCAST_GAP_MS]])
  })

  it('403 — заблокировали: отмечено как у напоминаний, посчитано, рассылка идёт дальше', async () => {
    quiet()
    const api = client([batch(1, [1, 2, 3])])
    const tg = telegram({ 2: 403 })

    await broadcastDue(asClient(api), tg.api, noWait)

    expect(api.switchReminders).toHaveBeenCalledWith(2, 'blocked')
    expect(api.broadcastDone).toHaveBeenCalledWith({
      id: 1,
      through: position(3),
      sent: 2,
      blocked: 1,
      failed: 0,
    })
  })

  it('иной отказ Telegram — «не дошло», без отметки блокировки', async () => {
    quiet()
    const api = client([batch(1, [1, 2])])
    await broadcastDue(asClient(api), telegram({ 1: 400 }).api, noWait)
    expect(api.switchReminders).not.toHaveBeenCalled()
    expect(api.broadcastDone).toHaveBeenCalledWith({
      id: 1,
      through: position(2),
      sent: 1,
      blocked: 0,
      failed: 1,
    })
  })

  it('429 в пределах — выждан и отправлен', async () => {
    quiet()
    const api = client([batch(1, [1])])
    const tg = telegram({}, { 1: 3 })
    await broadcastDue(asClient(api), tg.api, noWait)
    expect(noWait).toHaveBeenCalledWith(3000)
    expect(tg.sentTo()).toEqual([1, 1])
    expect(api.broadcastDone).toHaveBeenCalledWith(expect.objectContaining({ sent: 1 }))
  })

  it('флуд на третьем — слово о двух первых, остаток со следующей минутой', async () => {
    const { error } = quiet()
    const api = client([batch(1, [1, 2, 3, 4]), batch(1, [5])])
    const tg = telegram({}, { 3: RETRY_AFTER_CAP_SECONDS + 1 })

    await broadcastDue(asClient(api), tg.api, noWait)

    expect(api.broadcastDone).toHaveBeenCalledExactlyOnceWith({
      id: 1,
      through: position(2),
      sent: 2,
      blocked: 0,
      failed: 0,
    })
    expect(tg.sentTo()).toEqual([1, 2, 3])
    expect(api.claimBroadcast).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(
      '[molvia] broadcast: 429 flood, the rest goes with the next minute',
    )
  })

  it('флуд на первом — ни слова: пачка вернётся по аренде', async () => {
    quiet()
    const api = client([batch(1, [1, 2])])
    await broadcastDue(asClient(api), telegram({}, { 1: RETRY_AFTER_CAP_SECONDS + 1 }).api, noWait)
    expect(api.broadcastDone).not.toHaveBeenCalled()
    expect(api.claimBroadcast).toHaveBeenCalledTimes(1)
  })

  it('API не приняло слово — дальше не просит, отказ — по коду', async () => {
    const { error } = quiet()
    const api = client([batch(1, [1]), batch(1, [2])])
    api.broadcastDone.mockRejectedValueOnce(new ApiError('error.internal'))
    await broadcastDue(asClient(api), telegram().api, noWait)
    expect(api.claimBroadcast).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[molvia] broadcast done: error.internal')
    // the API's answer is the API's failure, recorded there — not a defect of the bot's (MOL-143)
    expect(api.reportFailure).not.toHaveBeenCalled()
  })

  it('API не выдало пачку — отказ по коду, ничего не отправлено', async () => {
    const { error } = quiet()
    const api = client([new ApiError('error.internal')])
    const tg = telegram()
    await broadcastDue(asClient(api), tg.api, noWait)
    expect(tg.calls).toEqual([])
    expect(error).toHaveBeenCalledWith('[molvia] broadcast claim: error.internal')
  })

  it('в лог — только счётчики пачки, ни одного чата', async () => {
    const { log } = quiet()
    await broadcastDue(asClient(client([batch(9, [4242])])), telegram().api, noWait)
    expect(log.mock.calls).toEqual([['[molvia] broadcast #9: sent 1, blocked 0, failed 0']])
  })

  it('остановка — пачка в руках доходит, новой не просит', async () => {
    quiet()
    let stopping = false
    const api = client([batch(1, [1, 2]), batch(1, [3])])
    api.broadcastDone.mockImplementation(() => {
      stopping = true
      return Promise.resolve()
    })
    const tg = telegram()
    await broadcastDue(asClient(api), tg.api, noWait, () => stopping)
    expect(tg.sentTo()).toEqual([1, 2])
    expect(api.claimBroadcast).toHaveBeenCalledTimes(1)
  })
})

describe('startBroadcasts', () => {
  it('просит сразу и раз в минуту, без второго прогона поверх идущего; остановка ждёт пачку', async () => {
    quiet()
    vi.useFakeTimers()
    try {
      const api = client([batch(1, [1, 2])])
      const tg = telegram()
      const stop = startBroadcasts(asClient(api), tg.api, 60_000)
      await vi.advanceTimersByTimeAsync(60_000)
      await stop()
      expect(tg.sentTo()).toEqual([1, 2])
      expect(api.claimBroadcast).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(api.claimBroadcast).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
