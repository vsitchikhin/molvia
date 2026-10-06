import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from 'grammy'
import type { Transformer } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import type { MolviaBotClient } from '@molvia/client'
import type { ReceiptNotice } from '@molvia/model'
import { RETRY_AFTER_CAP_SECONDS } from './deliver'
import { receiptMessage, receiptText, startReceiptNotices, tellReceipts } from './receipt'

const APP = 'https://molvia.test'
const RECEIPT = '0b0e2b9e-9a4d-4b0e-9f0e-6e6a4c3b2a10'

const notice = (patch: Partial<ReceiptNotice> = {}): ReceiptNotice => ({
  telegramUserId: 4242,
  receiptId: RECEIPT,
  outcome: 'parsed',
  language: 'ru',
  place: 'Ереван Сити',
  day: '2026-09-27',
  lineCount: 7,
  duplicate: false,
  silent: false,
  ...patch,
})

interface Call {
  readonly method: string
  readonly payload: Record<string, unknown>
}

/** Telegram, faked: every call recorded, the chats in `blocked` answering 403, the first `throttled` 429. */
function telegram(blocked: readonly number[] = [], throttled = 0, retryAfter = 3) {
  const calls: Call[] = []
  let limited = throttled
  const bot = new Bot('42:TEST', { botInfo: { id: 42 } as UserFromGetMe })
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload })
    const chat = (payload as { readonly chat_id?: number }).chat_id ?? 0
    if (limited > 0) {
      limited -= 1
      return Promise.resolve({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: retryAfter },
      }) as never
    }
    if (blocked.includes(chat)) {
      return Promise.resolve({
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      }) as never
    }
    return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never
  }
  bot.api.config.use(transformer)
  return { api: bot.api, calls }
}

function client(notices: ReceiptNotice[]) {
  return {
    claimReceiptNotices: vi.fn(() => Promise.resolve({ notices })),
    switchReminders: vi.fn(() => Promise.resolve()),
    reportFailure: vi.fn(() => Promise.resolve()),
  }
}

const asClient = (fake: ReturnType<typeof client>) => fake as unknown as MolviaBotClient

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('текст «чек разобран» (хендофф 08)', () => {
  it('8a · место в ёлочках и число позиций', () => {
    expect(receiptText(notice())).toBe(
      'Чек из «Ереван Сити» разобран: 7 позиций. Посмотрите и запишите.',
    )
  })

  it('8e · без места — дата чека без года', () => {
    expect(receiptText(notice({ place: null }))).toBe(
      'Чек от 27 сентября разобран: 7 позиций. Посмотрите и запишите.',
    )
  })

  it('чек без товаров — «можно записать сумму», не «0 позиций» (MOL-227)', () => {
    expect(receiptText(notice({ lineCount: 0 }))).toBe(
      'Чек из «Ереван Сити» разобран: товаров в нём нет — можно записать сумму.',
    )
    expect(receiptText(notice({ lineCount: 0, place: null }))).toBe(
      'Чек от 27 сентября разобран: товаров в нём нет — можно записать сумму.',
    )
    expect(receiptText(notice({ lineCount: 0, language: 'en', place: null }))).toBe(
      'Your receipt from 27 September is ready: it lists no items — you can save its total.',
    )
  })

  it('8b · не разобран — дата, без числа позиций', () => {
    expect(receiptText(notice({ outcome: 'failed', lineCount: 0 }))).toBe(
      'Чек от 27 сентября не удалось прочитать. Можно переснять или записать покупки вручную.',
    )
  })

  it('8c, 8d · по-английски — язык чека, место без кавычек', () => {
    expect(receiptText(notice({ language: 'en' }))).toBe(
      'Your Ереван Сити receipt is ready: 7 items. Take a look and save them.',
    )
    expect(receiptText(notice({ language: 'en', place: null, lineCount: 1 }))).toBe(
      'Your receipt from 27 September is ready: 1 item. Take a look and save them.',
    )
    expect(receiptText(notice({ language: 'en', outcome: 'failed' }))).toBe(
      'We couldn’t read your receipt from 27 September. You can retake it or add the purchases by hand.',
    )
  })

  it('второй снимок записанного чека — «уже записан», не «запишите», и кнопка «Открыть» (А4)', () => {
    expect(receiptText(notice({ duplicate: true }))).toBe(
      'Чек из «Ереван Сити» разобран, но он уже записан — второй раз записывать не нужно.',
    )
    expect(receiptText(notice({ duplicate: true, place: null }))).toBe(
      'Чек от 27 сентября разобран, но он уже записан — второй раз записывать не нужно.',
    )
    expect(receiptText(notice({ duplicate: true, language: 'en' }))).toBe(
      'Your Ереван Сити receipt is read, but it is saved already — no need to save it again.',
    )
    const button = receiptMessage(notice({ duplicate: true }), APP).keyboard?.inline_keyboard.flat()
    expect(button?.map(({ text }) => text)).toEqual(['Открыть чек'])
  })

  it('не разобран — сообщение «не прочитали», даже если такой же чек записан', () => {
    expect(receiptText(notice({ outcome: 'failed', duplicate: true }))).toMatch(
      /^Чек от 27 сентября не удалось прочитать/,
    )
  })

  it('формы числа: 1, 2, 5, 11, 21, 22', () => {
    const count = (n: number) =>
      /: (.+)\. Посмотрите/u.exec(receiptText(notice({ lineCount: n })))?.[1]
    expect([1, 2, 5, 11, 21, 22].map(count)).toEqual([
      '1 позиция',
      '2 позиции',
      '5 позиций',
      '11 позиций',
      '21 позиция',
      '22 позиции',
    ])
  })

  it('ни одной цифры, кроме числа позиций и даты: ни суммы, ни строки', () => {
    for (const one of [
      notice(),
      notice({ place: null }),
      notice({ outcome: 'failed' }),
      notice({ language: 'en', place: null }),
      notice({ duplicate: true }),
    ]) {
      const digits = receiptText(one).match(/\d+/g) ?? []
      expect(
        digits.every((d) => d === '7' || d === '27'),
        receiptText(one),
      ).toBe(true)
    }
  })
})

describe('кнопка', () => {
  it('одна URL-кнопка прямо на просмотр; «Открыть чек» у не разобранного', () => {
    const view = receiptMessage(notice(), `${APP}/`).keyboard?.inline_keyboard.flat()
    expect(view).toEqual([{ text: 'Посмотреть чек', url: `${APP}/purchases/receipts/${RECEIPT}` }])
    const open = receiptMessage(notice({ outcome: 'failed' }), APP).keyboard?.inline_keyboard.flat()
    expect(open).toEqual([{ text: 'Открыть чек', url: `${APP}/purchases/receipts/${RECEIPT}` }])
  })

  it('на http:// (копия разработки) — ссылка строкой, без кнопки: Telegram её не примет', () => {
    const message = receiptMessage(notice(), 'http://127.0.0.1:5300')
    expect(message.keyboard).toBeUndefined()
    expect(message.text).toBe(
      `${receiptText(notice())}\n\nПосмотреть чек: http://127.0.0.1:5300/purchases/receipts/${RECEIPT}`,
    )
  })
})

describe('отправка', () => {
  it('по сообщению на чек, со звуком днём и без звука ночью', async () => {
    const { api, calls } = telegram()
    const fake = client([notice(), notice({ telegramUserId: 7, silent: true })])
    await tellReceipts(asClient(fake), api, APP)
    expect(calls.map(({ payload }) => [payload.chat_id, payload.disable_notification])).toEqual([
      [4242, false],
      [7, true],
    ])
  })

  it('403 — человек заблокировал бота: отмечаем блок, остальные уходят', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram([4242])
    const fake = client([notice(), notice({ telegramUserId: 7 })])
    await tellReceipts(asClient(fake), api, APP)
    expect(fake.switchReminders).toHaveBeenCalledWith(4242, 'blocked')
    expect(calls).toHaveLength(2)
  })

  it('429 ждём один раз; дольше потолка — прогон сдаётся', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const wait = vi.fn(() => Promise.resolve(true))
    const short = telegram([], 1, 2)
    await tellReceipts(asClient(client([notice()])), short.api, APP, wait)
    expect(wait).toHaveBeenCalledWith(2000)
    expect(short.calls).toHaveLength(2)

    const long = telegram([], 1, RETRY_AFTER_CAP_SECONDS + 1)
    await tellReceipts(asClient(client([notice(), notice()])), long.api, APP, wait)
    expect(long.calls).toHaveLength(1)
    expect(error).toHaveBeenCalledWith('[molvia] receipt: 429 flood, 2 receipts given up')
  })

  it('API не ответил — ничего не шлём и пишем в лог по коду', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api, calls } = telegram()
    const fake = client([])
    fake.claimReceiptNotices.mockRejectedValueOnce(new Error('down'))
    await tellReceipts(asClient(fake), api, APP)
    expect(calls).toEqual([])
    expect(error).toHaveBeenCalledWith('[molvia] receipt claim: unexpected failure')
  })

  it('таймер спрашивает раз в минуту и не запускает второй прогон поверх первого', async () => {
    vi.useFakeTimers()
    const { api } = telegram()
    const fake = client([])
    const stop = startReceiptNotices(asClient(fake), api, APP, 60_000)
    expect(fake.claimReceiptNotices).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.claimReceiptNotices).toHaveBeenCalledTimes(2)
    await stop()
  })
})
