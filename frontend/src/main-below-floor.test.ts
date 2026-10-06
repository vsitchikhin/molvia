import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type * as Api from '@/api'
import type * as Identity from '@/stores/identity'
import { OUTDATED_MARK } from '@/browserFloor'

// The first step of the start throws, as it would in a browser below the floor: started, the app
// would report it — and here it must not start at all.
vi.mock('@/stores/identity', async (original) => ({
  ...(await original<typeof Identity>()),
  forgetTheInviteDoor: () => {
    throw new TypeError('undefined is not a function')
  },
}))

const sent = vi.hoisted(() => vi.fn())
vi.mock('@/api', async (original) => {
  const real = await original<typeof Api>()
  return {
    ...real,
    api: {
      ...real.api,
      reportClientErrors: (body: unknown) => {
        sent(body)
        return Promise.reject(new ApiError(ERROR.INTERNAL, 'offline', false))
      },
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute(OUTDATED_MARK)
})

describe('браузер ниже пола сборки (MOL-231)', () => {
  it('приложение не стартует и не слушает сбоев: ни отчёта, ни буфера, строка на месте', async () => {
    document.documentElement.setAttribute(OUTDATED_MARK, '')
    document.body.innerHTML = '<div id="app">line</div>'
    const listen = vi.spyOn(window, 'addEventListener')

    await import('@/main')

    const types = listen.mock.calls.map(([type]) => type)
    expect(types).not.toContain('error')
    expect(types).not.toContain('unhandledrejection')
    expect(types).not.toContain('online')
    expect(localStorage.getItem('molvia.failures')).toBeNull()
    expect(sent).not.toHaveBeenCalled()
    expect(document.getElementById('app')?.innerHTML).toBe('line')
  })
})
