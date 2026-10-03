import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type * as Client from '@molvia/client'

/**
 * The one seam that hears «this browser has no session any more» (MOL-56).
 *
 * The client itself is replaced here: what is under test is not what the API answers but what
 * the app does with a refusal, and every call of the client goes through the same wrapper.
 */
const me = vi.fn<() => Promise<unknown>>()
const advice = vi.fn<() => Promise<unknown>>()
const sendFeedback = vi.fn<() => Promise<unknown>>()

vi.mock('@molvia/client', async (original) => {
  const actual = await original<typeof Client>()
  return { ...actual, createClient: () => ({ me, advice, sendFeedback }) }
})

async function freshApi() {
  vi.resetModules()
  return import('@/api')
}

beforeEach(() => {
  me.mockReset()
  advice.mockReset()
  sendFeedback.mockReset()
})

describe('когда сервер больше не узнаёт браузер', () => {
  it('говорит об этом один раз и не глотает отказ', async () => {
    const { api, onMissingActor } = await freshApi()
    const told = vi.fn()
    onMissingActor(told)
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))

    await expect(api.me()).rejects.toThrow(ApiError)
    expect(told).toHaveBeenCalledTimes(1)
  })

  it('слышит это на любом вызове, а не только на «кто я»', async () => {
    // Раньше `error.no_actor` разбирали трое из полутора десятков сценариев, и на остальных
    // экранах кончившаяся сессия выглядела как «что-то пошло не так».
    const { api, onMissingActor } = await freshApi()
    const told = vi.fn()
    onMissingActor(told)
    advice.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))

    await expect(api.advice()).rejects.toThrow(ApiError)
    expect(told).toHaveBeenCalledTimes(1)
  })

  it('пропускает успешный ответ как есть', async () => {
    const { api, onMissingActor } = await freshApi()
    const told = vi.fn()
    onMissingActor(told)
    me.mockResolvedValue({ id: 'кто-то' })

    await expect(api.me()).resolves.toEqual({ id: 'кто-то' })
    expect(told).not.toHaveBeenCalled()
  })
})

describe('чего шов не принимает за конец сессии', () => {
  it('ответ не по контракту — портал в кафе отвечает своей страницей', async () => {
    // Отличать `error.no_actor` от голого `401` — правило `packages/client` (`CODE_BY_STATUS`),
    // и оно остаётся там. Сюда приезжает уже разобранный код.
    const { api, onMissingActor } = await freshApi()
    const told = vi.fn()
    onMissingActor(told)
    me.mockRejectedValue(new ApiError(ISSUE.RESPONSE_INVALID, 'HTTP 401', false))

    await expect(api.me()).rejects.toThrow(ApiError)
    expect(told).not.toHaveBeenCalled()
  })

  it('сервер сломался', async () => {
    const { api, onMissingActor } = await freshApi()
    const told = vi.fn()
    onMissingActor(told)
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))

    await expect(api.me()).rejects.toThrow(ApiError)
    expect(told).not.toHaveBeenCalled()
  })

  it('сети не было вовсе', async () => {
    const { api, onMissingActor } = await freshApi()
    const told = vi.fn()
    onMissingActor(told)
    me.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(api.me()).rejects.toThrow(TypeError)
    expect(told).not.toHaveBeenCalled()
  })
})

describe('последний отказ — код экрана ошибки в сообщении разработчику (MOL-147, В-1)', () => {
  it('помнит код последнего отказа любого вызова, свежий — минуту', async () => {
    const { api, lastRefusal, REFUSAL_FRESH_MS } = await freshApi()
    expect(lastRefusal()).toBeNull()
    advice.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    // A 502 of the proxy during a rollout: no body of ours, but a reply — the status says so.
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502', false, 502))

    await api.advice().catch(() => undefined)
    await api.me().catch(() => undefined)
    const at = Date.now()

    expect(lastRefusal(at)).toBe(ERROR.INTERNAL)
    expect(lastRefusal(at + REFUSAL_FRESH_MS - 1_000)).toBe(ERROR.INTERNAL)
    expect(lastRefusal(at + REFUSAL_FRESH_MS + 1_000)).toBeNull()
    // A refusal after the error was shown is not why it was shown (review №1).
    expect(lastRefusal(at - 5_000)).toBeNull()
  })

  it('не берёт за отказ то, что не ответ API, и успех кода не стирает', async () => {
    const { api, lastRefusal } = await freshApi()
    me.mockRejectedValue(new TypeError('Failed to fetch'))
    await api.me().catch(() => undefined)
    expect(lastRefusal()).toBeNull()
    // Так обрыв и истёкший срок приходят из настоящего клиента: его `error.internal`, а не сервера
    // (adversarial В3а) — у пятисотки был бы статус.
    for (const details of ['Load failed', 'aborted']) {
      me.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, details, false))
      await api.me().catch(() => undefined)
    }
    expect(lastRefusal()).toBeNull()

    advice.mockRejectedValueOnce(new ApiError(ISSUE.BODY_INVALID))
    await api.advice().catch(() => undefined)
    me.mockResolvedValue({ id: 'кто-то' })
    await api.me()

    expect(lastRefusal()).toBe(ISSUE.BODY_INVALID)
  })

  it('не одалживает экрану ошибки отказ самой шторки — «много за сегодня» (adversarial В3б)', async () => {
    const { api, lastRefusal } = await freshApi()
    sendFeedback.mockRejectedValue(new ApiError(ERROR.FEEDBACK_RATE_LIMITED))

    await api.sendFeedback({} as never).catch(() => undefined)

    expect(lastRefusal()).toBeNull()
  })
})
