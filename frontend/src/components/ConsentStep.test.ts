import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { actorCodec, ERROR, POLICY_VERSION } from '@molvia/model'
import type { ActorView, Consent } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useLoginStore } from '@/stores/login'
import LoginView from '@/views/LoginView.vue'

const me = vi.fn<() => Promise<ActorView>>()
const consent = vi.fn<() => Promise<Consent>>()
const acceptConsent = vi.fn<(version: number) => Promise<Consent>>()
const logout = vi.fn<() => Promise<void>>()
vi.mock('@/api', () => ({
  api: {
    me: () => me(),
    consent: () => consent(),
    acceptConsent: (version: number) => acceptConsent(version),
    logout: () => logout(),
  },
}))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const MINE = actorCodec.parse({
  id: OWNER,
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: '2026-09-12T00:00:00Z',
  updatedAt: '2026-09-12T00:00:00Z',
})

const views: VueWrapper[] = []
let clock = 0

/** The login screen of an owner claimed on this device who has accepted no edition. */
async function render() {
  localStorage.setItem('molvia.login', JSON.stringify({ claimed: OWNER }))
  localStorage.setItem('molvia.actor', OWNER)
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  await actor.start()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const view = mount(LoginView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return { view, router, login: useLoginStore() }
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function button(view: VueWrapper, name: string) {
  const found = view.findAll('button').find((one) => one.text() === name)
  if (!found) throw new Error(`no «${name}» button`)
  return found
}

function sheet(): HTMLDialogElement {
  const found = document.querySelector('dialog[open]')
  if (!(found instanceof HTMLDialogElement)) throw new Error('no sheet is open')
  return found
}

function inSheet(name: string): HTMLButtonElement {
  const found = [...sheet().querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name,
  )
  if (!found) throw new Error(`no «${name}» in the sheet`)
  return found
}

/** Long enough for a sheet to be up: before that it takes no tap (MOL-69). */
async function settle(): Promise<void> {
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  await flushPromises()
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  me.mockReset()
  me.mockResolvedValue(MINE)
  consent.mockReset()
  consent.mockResolvedValue({ version: null })
  acceptConsent.mockReset()
  acceptConsent.mockImplementation((version) => Promise.resolve({ version }))
  logout.mockReset()
  online(true)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

describe('«Условия и приватность» (MOL-95)', () => {
  it('names both documents, and «I accept» waits for the age to be ticked (В-3)', async () => {
    const { view, login } = await render()
    expect(view.text()).toContain(en.consent.title)
    expect(view.text()).toContain(en.consent.body)
    const links = view.findAll('.documents a').map((one) => one.attributes('href'))
    expect(links).toContain('/terms')
    expect(links).toContain('/privacy')

    await button(view, en.consent.accept).trigger('click')
    expect(acceptConsent).not.toHaveBeenCalled()
    expect(button(view, en.consent.accept).attributes('aria-disabled')).toBe('true')

    await view.get('input[type="checkbox"]').setValue(true)
    await button(view, en.consent.accept).trigger('click')
    await flushPromises()

    expect(acceptConsent).toHaveBeenCalledWith(POLICY_VERSION)
    expect(login.closed).toBe(false)
  })

  it('sends nothing of the age: the edition alone is the answer', async () => {
    const { view } = await render()
    await view.get('input[type="checkbox"]').setValue(true)
    await button(view, en.consent.accept).trigger('click')
    expect(acceptConsent.mock.calls).toEqual([[POLICY_VERSION]])
  })

  it('offline, «I accept» is inactive and the step says why before a tap', async () => {
    const { view } = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await view.get('input[type="checkbox"]').setValue(true)
    expect(view.text()).toContain(en.consent.offline)
    await button(view, en.consent.accept).trigger('click')
    expect(acceptConsent).not.toHaveBeenCalled()
  })

  it('an accept that failed keeps the door shut and says so', async () => {
    acceptConsent.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const { view, login } = await render()
    await view.get('input[type="checkbox"]').setValue(true)
    await button(view, en.consent.accept).trigger('click')
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toBe(en.consent.error)
    expect(login.closed).toBe(true)
  })

  it('a server that did not say what was accepted offers «Try again», never the app', async () => {
    consent.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const { view, login } = await render()
    expect(view.text()).toContain(en.consent.failed.title)
    consent.mockResolvedValue({ version: POLICY_VERSION })
    await button(view, en.state.retry).trigger('click')
    await flushPromises()
    expect(login.closed).toBe(false)
  })

  it('«I do not accept» says the account is there and offers the two ways out (В-4)', async () => {
    const { view } = await render()
    await button(view, en.consent.decline).trigger('click')
    await settle()

    expect(sheet().textContent).toContain(en.consent.leave.title)
    expect(sheet().textContent).toContain(en.consent.leave.body)
    // Nothing is erased or signed out by a «no» alone.
    expect(logout).not.toHaveBeenCalled()

    inSheet(en.settings.sign_out).click()
    await settle()
    expect(sheet().textContent).toContain(en.sign_out.title)
  })

  it('and «Delete my data…» opens the erasure’s own sheet, with its words', async () => {
    const { view } = await render()
    await button(view, en.consent.decline).trigger('click')
    await settle()
    inSheet(en.consent.leave.erase).click()
    await settle()
    expect(sheet().textContent).toContain(en.erase.title)
    expect(sheet().textContent).toContain(en.erase.goes)
  })

  it('names each document once: the links under the login screen give way to the step’s', async () => {
    const { view } = await render()
    const titles = view.findAll('a').map((one) => one.text())
    expect(titles.filter((title) => title === en.terms.title)).toHaveLength(1)
    expect(titles.filter((title) => title === en.privacy.title)).toHaveLength(1)
  })
})
