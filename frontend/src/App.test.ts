import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
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

/**
 * The app shown at `path` on the drawer of somebody claimed who accepted this edition, while the
 * server is still asked who we are; `shut` is the server's «no session», which shuts the door.
 */
async function shownOnTheDrawer(path: string) {
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
  window.history.replaceState(null, '', path)
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push(path)
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
  onTestFinished(() => {
    view.unmount()
  })
  await flushPromises()
  return {
    view,
    shut: async () => {
      refuse(new ApiError(ERROR.NO_ACTOR))
      await started.catch(() => undefined)
      await flushPromises()
    },
  }
}

// MOL-216, self-review №1: the session ended on another phone, and the door shut over the app took the
// screen the focus stood on. On master the first screen said its words into the live region; it is a
// screen now, not a state, and says nothing — so the focus goes to its heading, as a move's does.
describe('a door shut over the app', () => {
  it('gives the focus to its heading', async () => {
    const { view, shut } = await shownOnTheDrawer('/')
    const tab = view.get<HTMLElement>('a[href="/purchases"]').element
    tab.focus()
    expect(document.activeElement).toBe(tab)

    await shut()

    const heading = document.activeElement?.closest('h1')
    expect(heading?.textContent).toMatch(new RegExp(`^(${en.app.name}|${en.login.title})$`))
  })

  // Adversarial Р2-А1: a public screen stays behind the shut door, and nothing went from under the
  // focus. On the body it is a page being read — the privacy policy — and taken to its heading, the
  // reading jumped to the top.
  it('leaves the focus where it was over a public screen, which stays', async () => {
    const { view, shut } = await shownOnTheDrawer('/privacy')
    const heading = view.get('h1').element
    expect(heading.textContent.trim()).toBe(en.privacy.title)
    expect(document.activeElement).toBe(document.body)

    await shut()

    expect(view.find('.login').exists()).toBe(false)
    expect(view.get('h1').element).toBe(heading)
    expect(document.activeElement).toBe(document.body)
  })
})
