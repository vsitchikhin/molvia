import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type * as Api from '@/api'
import type * as Identity from '@/stores/identity'

// A step of the start throws, as a browser that lacks what it calls would (adversarial А4).
vi.mock('@/stores/identity', async (original) => ({
  ...(await original<typeof Identity>()),
  forgetTheInviteDoor: () => {
    throw new TypeError('undefined is not a function')
  },
}))

// No connection: the report waits in the buffer, and nothing leaves the test.
vi.mock('@/api', async (original) => {
  const real = await original<typeof Api>()
  return {
    ...real,
    api: {
      ...real.api,
      reportClientErrors: () => Promise.reject(new ApiError(ERROR.INTERNAL, 'offline', false)),
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('сбой на старте (MOL-144, адверсариальный А4)', () => {
  it('ловушки стоят до первого шага старта, а его исключение ложится в буфер и летит дальше', async () => {
    const listen = vi.spyOn(window, 'addEventListener')
    await expect(import('@/main')).rejects.toThrow('undefined is not a function')
    expect(listen.mock.calls.map(([type]) => type)).toContain('error')
    const kept = JSON.parse(localStorage.getItem('molvia.failures') ?? '[]') as {
      catcher: string
      screen: string
    }[]
    expect(kept).toEqual([expect.objectContaining({ catcher: 'start', screen: 'start' })])
  })
})
