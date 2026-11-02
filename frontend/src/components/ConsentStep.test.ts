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
import ru from '@/i18n/ru.json'
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

  it('a newcomer sees the consent to the statistics on the step, and no «what changed» (MOL-236, В-2)', async () => {
    const { view } = await render()
    expect(view.get('.statistics').text()).toContain(en.consent.statistics.title)
    expect(view.get('.statistics').text()).toContain(en.consent.statistics.text)
    // The switch that withdraws it is named by its own words.
    expect(en.consent.statistics.text).toContain(`«${en.settings.analytics.label}»`)
    expect(view.find('.changes').exists()).toBe(false)
  })

  it('whoever accepted edition 1 is told what changed in 2, 3, 4, 5 and 6, and sees the statistics too', async () => {
    consent.mockResolvedValue({ version: 1 })
    const { view } = await render()
    expect(view.text()).toContain(en.consent.updated.title)
    expect(view.findAll('.changes-text').map((p) => p.text())).toEqual([
      en.consent.changes['2'],
      en.consent.changes['3'],
      en.consent.changes['4'],
      en.consent.changes['5'],
      en.consent.changes['6'],
    ])
    // It is told what edition 1 told it wrong: the catalogue and a receipt's word have no threshold (Р3-А1).
    expect(en.consent.changes['2']).toMatch(/with no threshold/)
    expect(ru.consent.changes['2']).toMatch(/без имени, но и без порога/)
    expect(view.get('.statistics').text()).toContain(en.consent.statistics.text)

    await view.get('input[type="checkbox"]').setValue(true)
    await button(view, en.consent.accept).trigger('click')
    await flushPromises()
    expect(acceptConsent).toHaveBeenCalledWith(POLICY_VERSION)
  })

  it('whoever accepted edition 2 is told what changed in 3, 4, 5 and 6: Anthropic, a new recipient (MOL-272)', async () => {
    consent.mockResolvedValue({ version: 2 })
    const { view } = await render()
    expect(view.findAll('.changes-text').map((p) => p.text())).toEqual([
      en.consent.changes['3'],
      en.consent.changes['4'],
      en.consent.changes['5'],
      en.consent.changes['6'],
    ])
    expect(en.consent.changes['3']).toMatch(/Anthropic/)
    expect(ru.consent.changes['3']).toMatch(/Anthropic/)
  })

  it('whoever accepted edition 3 is told what changed in 4, 5 and 6: a receipt kept for the review (MOL-309)', async () => {
    consent.mockResolvedValue({ version: 3 })
    const { view } = await render()
    expect(view.findAll('.changes-text').map((p) => p.text())).toEqual([
      en.consent.changes['4'],
      en.consent.changes['5'],
      en.consent.changes['6'],
    ])
    expect(en.consent.changes['4']).toMatch(/21 days/)
    expect(ru.consent.changes['4']).toMatch(/21 дня/)
  })

  it('whoever accepted edition 4 is told what changed in 5 and 6: France, and Anthropic beyond the USA (MOL-319)', async () => {
    consent.mockResolvedValue({ version: 4 })
    const { view } = await render()
    expect(view.findAll('.changes-text').map((p) => p.text())).toEqual([
      en.consent.changes['5'],
      en.consent.changes['6'],
    ])
    expect(ru.consent.changes['5']).toMatch(/во Франции, а не в Германии/)
    expect(ru.consent.changes['5']).toMatch(/в любой стране, где у неё есть мощности/)
    // the whole of the term, as the page says it: the one paragraph whoever accepted 4 reads (adversarial А3)
    expect(ru.consent.changes['5']).toMatch(
      /до 30 дней \(отмеченное её проверкой — до 2 лет, оценку проверки — до 7 лет\)/,
    )
    expect(en.consent.changes['5']).toMatch(/in France, not in Germany/)
    expect(en.consent.changes['5']).toMatch(/up to 30 days \(up to 2 years .*up to 7 years\)/)
  })

  it('whoever accepted edition 5 is told only what changed in 6: the search measured by their picks (MOL-330)', async () => {
    consent.mockResolvedValue({ version: 5 })
    const { view } = await render()
    expect(view.findAll('.changes-text').map((p) => p.text())).toEqual([en.consent.changes['6']])
    // A new purpose, said as one: by what was taken for a query, with no name, the export let go after it.
    expect(ru.consent.changes['6']).toMatch(/^Новая цель: /)
    expect(ru.consent.changes['6']).toMatch(/по тому, что вы взяли по какому запросу/)
    expect(ru.consent.changes['6']).toMatch(/без имени и номера аккаунта/)
    expect(ru.consent.changes['6']).toMatch(/выгрузку для замера удаляет после него/)
    expect(ru.consent.changes['6']).toContain(`«${ru.settings.analytics.label}»`)
    expect(en.consent.changes['6']).toMatch(/^A new purpose: /)
    expect(en.consent.changes['6']).toContain(`«${en.settings.analytics.label}»`)
    // And the card on the step names it beside the visits and the ratings.
    expect(view.get('.statistics').text()).toContain(en.consent.statistics.text)
    expect(ru.consent.statistics.text).toMatch(/меряем поиск по тому, что вы брали по запросу/)
    expect(en.consent.statistics.text).toMatch(/measure the search by what you took for a query/)
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
