import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, POLICY_VERSION } from '@molvia/model'
import App from '@/App.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { pwaUpdateKey } from '@/pwaUpdate'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'

// Every other request stays in the air: the screens draw their skeletons, which is all this needs.
const me = vi.fn()
vi.mock('@/api', () => ({
  api: new Proxy(
    {},
    { get: (_, key) => (key === 'me' ? () => me() : () => new Promise(() => undefined)) },
  ),
}))

const OWNER = 'aaaaaaaa-0000-4000-8000-0000000000aa'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  me.mockReset()
})

// MOL-216, self-review №1: the session ended on another phone, and the door shut over the app took the
// screen the focus stood on. On master the first screen said its words into the live region; it is a
// screen now, not a state, and says nothing — so the focus goes to its heading, as a move's does.
describe('a door shut over the app', () => {
  it('gives the focus to its heading', async () => {
    // Somebody on the device, claimed, who accepted this edition: the app is shown on the drawer.
    localStorage.setItem('molvia.actor', OWNER)
    localStorage.setItem('molvia.login', JSON.stringify({ claimed: OWNER }))
    localStorage.setItem(`molvia.consent.${OWNER}`, String(POLICY_VERSION))
    let refuse: (error: unknown) => void = () => undefined
    me.mockReturnValue(
      new Promise((_, reject) => {
        refuse = reject
      }),
    )
    const pinia = createPinia()
    setActivePinia(pinia)
    const started = useActorStore().start()
    window.history.replaceState(null, '', '/')
    const router = createRouter({ history: createWebHistory(), routes })
    await router.push('/')
    await router.isReady()
    const view = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [pinia, router, createAppI18n('en')],
        provide: {
          [pwaUpdateKey as symbol]: {
            phase: shallowRef('none'),
            apply: vi.fn(),
            serverVersion: vi.fn(),
          },
        },
      },
    })
    await flushPromises()
    const tab = view.get<HTMLElement>('a[href="/purchases"]').element
    tab.focus()
    expect(document.activeElement).toBe(tab)

    refuse(new ApiError(ERROR.NO_ACTOR))
    await started.catch(() => undefined)
    await flushPromises()

    const heading = document.activeElement?.closest('h1')
    expect(heading?.textContent).toMatch(new RegExp(`^(${en.app.name}|${en.login.title})$`))
    view.unmount()
  })
})
