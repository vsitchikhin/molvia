import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type * as Api from '@/api'
import type * as I18n from '@/i18n'
import type * as Navigation from '@/navigation'

// The dictionary of the start comes when the test says (MOL-337, owner's В-3 «а»).
const dictionary = vi.hoisted(() => {
  let arrive: () => void = () => undefined
  const coming = new Promise<void>((resolve) => {
    arrive = resolve
  })
  return {
    coming,
    arrive: () => {
      arrive()
    },
  }
})
vi.mock('@/i18n', async (original) => ({
  ...(await original<typeof I18n>()),
  loadDictionary: () => dictionary.coming,
}))

// The screens are not loaded after the mount: that work would go on past the file's end.
vi.mock('@/navigation', async (original) => ({
  ...(await original<typeof Navigation>()),
  warmScreens: () => Promise.resolve(),
}))

// The app itself is not what is tested: an empty root, so mounting it renders nothing.
vi.mock('@/App.vue', () => ({ default: { render: () => null } }))

// No connection, and nothing leaves the test — the identity asked at the start neither (MOL-286).
vi.mock('@/api', async (original) => {
  const real = await original<typeof Api>()
  const offline = () => Promise.reject(new ApiError(ERROR.INTERNAL, 'offline', false))
  return { ...real, api: { ...real.api, me: offline, reportClientErrors: offline } }
})

describe('the start and its dictionary (MOL-337)', () => {
  it('mounts the app once the dictionary is here, never before — the first route settled or not', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = () => document.querySelector<Element & { __vue_app__?: unknown }>('#app')
    await import('@/main')
    const { router } = await import('@/router')
    await router.isReady()
    await new Promise((settle) => {
      setTimeout(settle, 0)
    })
    expect(root()?.__vue_app__).toBeUndefined()

    dictionary.arrive()
    await vi.waitFor(() => {
      expect(root()?.__vue_app__).toBeDefined()
    })
  }, 20_000)
})
