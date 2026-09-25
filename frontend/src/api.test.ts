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

vi.mock('@molvia/client', async (original) => {
  const actual = await original<typeof Client>()
  return { ...actual, createClient: () => ({ me, advice }) }
})

async function freshApi() {
  vi.resetModules()
  return import('@/api')
}

beforeEach(() => {
  me.mockReset()
  advice.mockReset()
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
