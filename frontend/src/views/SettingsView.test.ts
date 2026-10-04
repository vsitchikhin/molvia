import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { actorCodec, ERROR } from '@molvia/model'
import type { ActorView, SettingsUpdate } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'
import SettingsView from './SettingsView.vue'

const me = vi.fn<() => Promise<ActorView>>()
const save = vi.fn<(input: SettingsUpdate) => Promise<ActorView>>()
vi.mock('@/api', () => ({
  api: {
    me: () => me(),
    saveSettings: (input: SettingsUpdate) => save(input),
    salaryShift: () => Promise.resolve({ day: null }),
  },
}))
const initial = actorCodec.parse({
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
})
const views: VueWrapper[] = []
async function render(cached = true, online?: boolean) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = initial.id
  if (cached) actor.apply(initial)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings')
  if (online !== undefined) vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
  const view = mount(SettingsView, { global: { plugins: [pinia, router, createAppI18n('en')] } })
  views.push(view)
  await flushPromises()
  return Object.assign(view, { router })
}
beforeEach(() => {
  vi.restoreAllMocks()
  me.mockReset()
  save.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  me.mockResolvedValue(initial)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
})
/** The form's fields in their order: country, city, spend currency, income currency (MOL-109). */
const field = (view: VueWrapper, at: 'country' | 'city' | 'spend' | 'income') =>
  view.findAll('select')[['country', 'city', 'spend', 'income'].indexOf(at)]
const options = (view: VueWrapper, at: 'country' | 'city') =>
  field(view, at)
    ?.findAll('option')
    .map((option) => option.attributes('value'))

it('loads without invented fields, and keeps a focusable inactive save action', async () => {
  me.mockReturnValue(new Promise(() => undefined))
  const view = await render(false)
  expect(view.find('.skeleton').exists()).toBe(true)
  expect(view.find('select').exists()).toBe(false)
  expect(view.get('.actions button').attributes('aria-disabled')).toBe('true')
  expect(view.get('.actions button').attributes('disabled')).toBeUndefined()
})
it('a failed initial read shows retry, not a creation form', async () => {
  me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
  const view = await render(false)
  expect(view.text()).toContain(en.settings.load_error.title)
  expect(view.find('select').exists()).toBe(false)
})
it('offline without memory offers no retry and no default values', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  me.mockRejectedValue(new TypeError('network'))
  const view = await render(false)
  expect(view.text()).toContain(en.settings.offline.body)
  expect(view.find('select').exists()).toBe(false)
  expect(view.text()).not.toContain(en.state.retry)
})
it('offline with memory keeps fields editable and explains when save becomes possible', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  me.mockRejectedValue(new TypeError('network'))
  const view = await render()
  await field(view, 'city')?.setValue('Ереван')
  expect(view.text()).toContain(en.settings.offline.strip)
  expect(view.get('.actions button').attributes('aria-disabled')).toBe('true')
  expect(view.find('[role="alert"]').exists()).toBe(false)
})
it('shows changed fields and matching currencies, then clears badges on success', async () => {
  const view = await render()
  await field(view, 'city')?.setValue('Ереван')
  await field(view, 'income')?.setValue('AMD')
  expect(view.findAll('.badge')).toHaveLength(2)
  expect(view.text()).toContain(en.settings.same_currencies)
  expect(view.find('.draft').exists()).toBe(false)
  save.mockResolvedValue({ ...initial, city: 'Ереван', incomeCurrency: 'AMD' })
  await view.get('.actions button').trigger('click')
  await flushPromises()
  expect(view.text()).toContain(en.settings.saved)
  expect(view.find('.badge').exists()).toBe(false)
})
it('preserves an unsupported saved city while allowing currency changes', async () => {
  me.mockResolvedValue({ ...initial, city: 'Ванадзор, Лорийская область' })
  const view = await render()
  expect((field(view, 'city')?.element as HTMLSelectElement).value).toBe(
    'Ванадзор, Лорийская область',
  )
  // Д1: the whole name is readable above the field, and it says why it is in the list at all.
  const kept = view.get('.kept')
  expect(kept.text()).toContain('Ванадзор, Лорийская область')
  expect(kept.text()).toContain(en.settings.city_not_listed)
  expect(field(view, 'city')?.attributes('aria-describedby')).toContain(kept.attributes('id'))
  await field(view, 'income')?.setValue('EUR')
  expect(view.get('.actions button').attributes('aria-disabled')).toBeUndefined()
})

it('Б1: an unsupported city can be returned to, and keeps its own country', async () => {
  // Its option used to disappear on the first change, and the body the form built for it
  // named Armenia — which the server answers 400 to. A country the settings do not offer stays
  // in the list of countries too (MOL-109).
  const legacy = { ...initial, country: 'RU', city: 'Москва' }
  me.mockResolvedValue(legacy)
  const view = await render(false)
  expect(options(view, 'country')).toEqual(['RU', 'AM', 'GE', 'RS'])
  // a country the settings never offered is named by its code (`countryLabel`)
  expect(field(view, 'country')?.findAll('option')[0]?.text()).toBe('RU')
  expect(options(view, 'city')).toEqual(['Москва'])
  await field(view, 'country')?.setValue('AM')
  expect(options(view, 'city')).toEqual(['Гюмри', 'Ереван'])
  expect((field(view, 'city')?.element as HTMLSelectElement).value).toBe('Гюмри')
  await field(view, 'country')?.setValue('RU')
  expect((field(view, 'city')?.element as HTMLSelectElement).value).toBe('Москва')
  expect(view.find('.kept').exists()).toBe(true)
  save.mockResolvedValue(legacy)
  expect(view.get('.actions button').attributes('aria-disabled')).toBe('true')
  expect(view.find('.badge').exists()).toBe(false)
})

it('moves to Georgia: the cities follow the country, the first one chosen (MOL-109)', async () => {
  const view = await render()
  expect(options(view, 'country')).toEqual(['AM', 'GE', 'RS'])
  expect(
    field(view, 'country')
      ?.findAll('option')
      .map((option) => option.text()),
  ).toEqual([en.settings.countries.AM, en.settings.countries.GE, en.settings.countries.RS])
  await field(view, 'country')?.setValue('GE')
  expect(options(view, 'city')).toEqual(['Тбилиси', 'Батуми'])
  expect((field(view, 'city')?.element as HTMLSelectElement).value).toBe('Тбилиси')
  await field(view, 'city')?.setValue('Батуми')
  // both fields changed, and nothing is said about a city outside the list
  expect(view.findAll('.badge')).toHaveLength(2)
  expect(view.find('.kept').exists()).toBe(false)
  save.mockResolvedValue({ ...initial, country: 'GE', city: 'Батуми' })
  await view.get('.actions button').trigger('click')
  await flushPromises()
  expect(save).toHaveBeenCalledWith({
    previous: expect.objectContaining({ country: 'AM', city: 'Гюмри' }),
    settings: expect.objectContaining({ country: 'GE', city: 'Батуми' }),
  })
  expect(view.text()).toContain(en.settings.saved)
})

it('the country is described by its change alone, never by an empty list (MOL-109)', async () => {
  const view = await render()
  expect(field(view, 'country')?.attributes('aria-describedby')).toBeUndefined()
  await field(view, 'country')?.setValue('RS')
  const said = field(view, 'country')?.attributes('aria-describedby') ?? ''
  expect(view.find(`#${said}`).text()).toBe(en.settings.changed_announced)
})

it('back to its own country, the form is back on its own city: nothing changed (MOL-109, А3)', async () => {
  me.mockResolvedValue({ ...initial, city: 'Ереван' })
  const view = await render(false)
  await field(view, 'country')?.setValue('GE')
  expect((field(view, 'city')?.element as HTMLSelectElement).value).toBe('Тбилиси')
  await field(view, 'country')?.setValue('AM')
  expect((field(view, 'city')?.element as HTMLSelectElement).value).toBe('Ереван')
  expect(view.find('.badge').exists()).toBe(false)
  expect(view.get('.actions button').attributes('aria-disabled')).toBe('true')
})

it('choosing the country it already has changes nothing (MOL-109)', async () => {
  const view = await render()
  await field(view, 'city')?.setValue('Ереван')
  await field(view, 'country')?.setValue('AM')
  expect((field(view, 'city')?.element as HTMLSelectElement).value).toBe('Ереван')
  expect(view.findAll('.badge')).toHaveLength(1)
})

it('names the country and the currencies of a conflict in the words the form uses', async () => {
  const view = await render()
  // The same choice on both devices, which is what a conflict is since Б2.
  await field(view, 'spend')?.setValue('EUR')
  save.mockRejectedValue(new ApiError(ERROR.CONFLICT))
  me.mockResolvedValue({ ...initial, spendCurrency: 'USD' })
  await view.get('.actions button').trigger('click')
  await flushPromises()
  const said = en.settings.conflict.body
    .replace('{country}', en.settings.countries.AM)
    .replace('{city}', 'Гюмри')
    .replace('{spendCurrency}', en.settings.currencies.USD)
    .replace('{incomeCurrency}', en.settings.currencies.RUB)
  expect(view.text()).toContain(said)
})

it('replaces a previous write error with the offline notice when the connection drops', async () => {
  const view = await render()
  await field(view, 'city')?.setValue('Ереван')
  save.mockRejectedValue(new ApiError(ERROR.INTERNAL))
  await view.get('.actions button').trigger('click')
  await flushPromises()
  expect(view.find('[role="alert"]').exists()).toBe(true)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  window.dispatchEvent(new Event('offline'))
  await flushPromises()
  expect(view.find('[role="alert"]').exists()).toBe(false)
  expect(view.get('.actions button').text()).toBe(en.settings.save)
  expect(view.get('.actions button').attributes('aria-disabled')).toBe('true')
})

it.each([
  ['with the form', true, true],
  ['offline and without a form to show', false, false],
])('leads to «Data and privacy» %s (MOL-58)', async (_name, cached, online) => {
  if (!online) me.mockRejectedValue(new TypeError('network'))
  const view = await render(cached, online)
  const link = view.findAll('a').find((one) => one.text() === en.privacy.title)
  expect(link).toBeDefined()
  await link?.trigger('click')
  await flushPromises()
  expect(view.router.currentRoute.value.name).toBe('privacy')
})

it('no longer leads to the exchanges and incomes: they moved to «Деньги» (MOL-81)', async () => {
  const view = await render()
  const targets = view.findAll('a').map((link) => link.attributes('href'))
  expect(targets).not.toContain('/money/exchange')
  expect(targets).not.toContain('/money/incomes')
  expect(view.text()).not.toContain(en.exchange.title)
  expect(view.text()).not.toContain(en.income.title)
})

it.each([
  ['with the form', true, true],
  ['offline and without a form to show', false, false],
])('leads to «Устройства» from the account group %s (MOL-57)', async (_name, cached, online) => {
  // The way into the account does not depend on whether its settings loaded.
  if (!online) me.mockRejectedValue(new TypeError('network'))
  const view = await render(cached, online)
  const entry = view.findAll('a.entry').find((link) => link.text() === en.devices.title)
  expect(entry?.attributes('href')).toBe('/settings/devices')
  expect(view.text()).toContain(en.settings.group_account)
})
it('«Тема» stands in every state, under «Бот» and over «Аккаунт» (MOL-111)', async () => {
  const captions = (view: VueWrapper) => view.findAll('h2').map((caption) => caption.text())
  const loading = await (async () => {
    me.mockReturnValue(new Promise(() => undefined))
    return render(false)
  })()
  expect(captions(loading)).toContain(en.settings.group_scheme)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  me.mockRejectedValue(new TypeError('network'))
  const offline = await render(false)
  expect(captions(offline)).toContain(en.settings.group_scheme)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
  const failed = await render(false)
  expect(failed.text()).toContain(en.settings.load_error.title)
  expect(captions(failed)).toContain(en.settings.group_scheme)
  me.mockResolvedValue(initial)
  const loaded = captions(await render())
  const at = loaded.indexOf(en.settings.group_scheme)
  expect(loaded[at - 1]).toBe(en.settings.group_bot)
  expect(loaded[at + 1]).toBe(en.settings.group_account)
})

describe('«Write to the developer» (MOL-147)', () => {
  const row = (view: VueWrapper) =>
    view.findAll('button').find((button) => button.text().startsWith(en.settings.feedback.label))

  it('stands in «About the app», between the account and your data', async () => {
    const view = await render()
    const captions = view.findAll('h2.caption').map((caption) => caption.text())

    expect(captions.slice(captions.indexOf(en.settings.group_account))).toEqual([
      en.settings.group_account,
      en.settings.group_app,
      en.settings.group_data,
    ])
    expect(row(view)?.text()).toContain(en.settings.feedback.hint)
    expect(row(view)?.attributes('aria-haspopup')).toBe('dialog')
  })

  it("opens the sheet with no kind and no code — the kind is the person's", async () => {
    const view = await render()

    await row(view)?.trigger('click')

    expect(useFeedbackSheetStore().shown).toBe(true)
    expect(useFeedbackSheetStore().entry).toEqual({ from: 'settings' })
  })

  it('opens it offline all the same: written now, sent with a connection', async () => {
    const view = await render(true, false)

    await row(view)?.trigger('click')

    expect(useFeedbackSheetStore().shown).toBe(true)
  })
})
