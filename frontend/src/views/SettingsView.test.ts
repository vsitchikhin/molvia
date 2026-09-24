import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { actorCodec, ERROR } from '@molvia/model'
import type { ActorView, SettingsUpdate } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import SettingsView from './SettingsView.vue'

const me = vi.fn<() => Promise<ActorView>>()
const save = vi.fn<(input: SettingsUpdate) => Promise<ActorView>>()
vi.mock('@/api', () => ({
  api: { me: () => me(), saveSettings: (input: SettingsUpdate) => save(input) },
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
async function render(cached = true) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = initial.id
  if (cached) actor.apply(initial)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings')
  const view = mount(SettingsView, { global: { plugins: [pinia, router, createAppI18n('en')] } })
  views.push(view)
  await flushPromises()
  return view
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
  await view.get('select').setValue('Ереван')
  expect(view.text()).toContain(en.settings.offline.strip)
  expect(view.get('.actions button').attributes('aria-disabled')).toBe('true')
  expect(view.find('[role="alert"]').exists()).toBe(false)
})
it('shows changed fields and matching currencies, then clears badges on success', async () => {
  const view = await render()
  await view.get('select').setValue('Ереван')
  await view.findAll('select')[2]?.setValue('AMD')
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
  expect((view.get('select').element as HTMLSelectElement).value).toBe(
    'Ванадзор, Лорийская область',
  )
  // Д1: the whole name is readable above the field, and it says why it is in the list at all.
  const kept = view.get('.kept')
  expect(kept.text()).toContain('Ванадзор, Лорийская область')
  expect(kept.text()).toContain(en.settings.city_not_listed)
  expect(view.get('select').attributes('aria-describedby')).toContain(kept.attributes('id'))
  await view.findAll('select')[2]?.setValue('EUR')
  expect(view.get('.actions button').attributes('aria-disabled')).toBeUndefined()
})

it('Б1: an unsupported city can be returned to, and keeps its own country', async () => {
  // Its option used to disappear on the first change, and the body the form built for it
  // named Armenia — which the server answers 400 to.
  const legacy = { ...initial, country: 'GE', city: 'Тбилиси' }
  me.mockResolvedValue(legacy)
  const view = await render(false)
  const city = view.get('select')
  await city.setValue('Ереван')
  expect(view.findAll('select option').map((option) => option.attributes('value'))).toContain(
    'Тбилиси',
  )
  await city.setValue('Тбилиси')
  expect(view.find('.kept').exists()).toBe(true)
  save.mockResolvedValue(legacy)
  expect(view.get('.actions button').attributes('aria-disabled')).toBe('true')
  expect(view.find('.badge').exists()).toBe(false)
})

it('names the country and the currencies of a conflict in the words the form uses', async () => {
  const view = await render()
  // The same choice on both devices, which is what a conflict is since Б2.
  await view.findAll('select')[1]?.setValue('EUR')
  save.mockRejectedValue(new ApiError(ERROR.CONFLICT))
  me.mockResolvedValue({ ...initial, spendCurrency: 'USD' })
  await view.get('.actions button').trigger('click')
  await flushPromises()
  const said = en.settings.conflict.body
    .replace('{country}', en.settings.armenia)
    .replace('{city}', 'Гюмри')
    .replace('{spendCurrency}', en.settings.currencies.USD)
    .replace('{incomeCurrency}', en.settings.currencies.RUB)
  expect(view.text()).toContain(said)
})

it('replaces a previous write error with the offline notice when the connection drops', async () => {
  const view = await render()
  await view.get('select').setValue('Ереван')
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
