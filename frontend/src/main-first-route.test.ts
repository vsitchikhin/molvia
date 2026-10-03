import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type * as Api from '@/api'
import type * as Navigation from '@/navigation'

// The first route of the start throws: a guard with a bug, a route that cannot load (adversarial Б2).
vi.mock('@/navigation', async (original) => ({
  ...(await original<typeof Navigation>()),
  settleColdStart: () =>
    Promise.reject(new TypeError("Cannot read properties of undefined (reading 'meta')")),
}))

// The app itself is not what is tested: an empty root, so mounting it renders nothing.
vi.mock('@/App.vue', () => ({ default: { render: () => null } }))

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

describe('первый маршрут старта не встал (MOL-144, адверсариальный Б2)', () => {
  it('его исключение уходит отчётом, а приложение смонтировано всё равно', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    document.body.innerHTML = '<div id="app"></div>'
    await import('@/main')
    await vi.waitFor(() => {
      expect(logged.mock.calls.map(([, what]) => what)).toContain('first route')
    })
    const kept = JSON.parse(localStorage.getItem('molvia.failures') ?? '[]') as {
      errorName: string
      catcher: string
    }[]
    expect(kept).toEqual([expect.objectContaining({ errorName: 'TypeError', catcher: 'start' })])
    await vi.waitFor(() => {
      const root = document.querySelector<Element & { __vue_app__?: unknown }>('#app')
      expect(root?.__vue_app__).toBeDefined()
    })
  })
})
