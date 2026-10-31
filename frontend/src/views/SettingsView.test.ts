import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { actorCodec, ERROR } from '@molvia/model'
import type { ActorView, SettingsUpdate } from '@molvia/model'
import AppTag from '@/components/AppTag.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import StatusStrip, { STRIP_LATE_MS } from '@/components/StatusStrip.vue'
import { answeredAt, localDay } from '@/days'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'
import SettingsView from './SettingsView.vue'

const me = vi.fn<() => Promise<ActorView>>()
const save = vi.fn<(input: SettingsUpdate) => Promise<ActorView>>()
const salaryShift = vi.fn<() => Promise<{ day: number | null }>>()
vi.mock('@/api', () => ({
  api: {
    me: () => me(),
    saveSettings: (input: SettingsUpdate) => save(input),
    salaryShift: () => salaryShift(),
    analyticsSetting: () => Promise.resolve({ off: false }),
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
  return Object.assign(view, { router, pinia })
}
beforeEach(() => {
  vi.restoreAllMocks()
  me.mockReset()
  save.mockReset()
  salaryShift.mockReset()
  salaryShift.mockResolvedValue({ day: null })
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
  expect(view.get('.dock > button').attributes('aria-disabled')).toBe('true')
  expect(view.get('.dock > button').attributes('disabled')).toBeUndefined()
})
// MOL-269: the form coming in place of the skeleton moved the groups under it from under the finger
// — «Выйти» tapped became another row.
describe('the groups under the form come with its answer (MOL-269)', () => {
  // `v-show` on the group: the view is not in a document, so its own style is read up the tree.
  const seen = (node: Element | undefined): boolean => {
    for (let at = node; at instanceof HTMLElement; at = at.parentElement ?? undefined)
      if (at.style.display === 'none') return false
    return !!node
  }
  // Each group by a thing of its own: the salary's switch, the bot's page, the scheme, «Выйти».
  const shown = (view: VueWrapper) =>
    [
      view.find('[role="switch"]').element,
      view.find('a[href="/settings/bot"]').element,
      view
        .findAll('*')
        .find(
          (node) => node.element.children.length === 0 && node.text() === en.settings.group_scheme,
        )?.element,
      view.findAll('button').find((button) => button.text() === en.settings.sign_out)?.element,
    ].map(seen)
  const leave = (view: VueWrapper) =>
    seen(view.findAll('button').find((button) => button.text() === en.settings.sign_out)?.element)

  it('must not fire: none under the skeleton, though the salary answered', async () => {
    me.mockReturnValue(new Promise(() => undefined))
    const view = await render(false)
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(shown(view)).toEqual([false, false, false, false])
  })

  // Not kept on the phone, the salary's day would hide them at every opening — a step back the
  // browser showed whole came in again under its picture (motion.spec, А5).
  it('all with the form, not waiting for the salary’s day', async () => {
    salaryShift.mockReturnValue(new Promise(() => undefined))
    const view = await render(false)
    expect(view.find('select').exists()).toBe(true)
    expect(shown(view)).toEqual([true, true, true, true])
  })

  // Review Р3-1: a read after a failure — «Повторить», the app back in view — stands the skeleton
  // again with the failure still there; the groups went under it.
  it('must not fire: none under the skeleton of a read after a failure, by a tap or by itself', async () => {
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render(false)
    expect(view.text()).toContain(en.settings.load_error.title)
    expect(shown(view)).toEqual([true, true, true, true])

    me.mockReturnValue(new Promise(() => undefined))
    await view
      .findAll('button')
      .find((button) => button.text() === en.state.retry)
      ?.trigger('click')
    await flushPromises()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(shown(view)).toEqual([false, false, false, false])

    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const back = await render(false)
    me.mockReturnValue(new Promise(() => undefined))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(back.find('.skeleton').exists()).toBe(true)
    expect(shown(back)).toEqual([false, false, false, false])
  })

  it('come when the form failed, or offline with nothing kept', async () => {
    salaryShift.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await render(false)
    expect(failed.text()).toContain(en.settings.load_error.title)
    expect(leave(failed)).toBe(true)

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    me.mockRejectedValue(new TypeError('network'))
    salaryShift.mockRejectedValue(new TypeError('network'))
    const offline = await render(false)
    expect(offline.text()).toContain(en.settings.offline.body)
    expect(leave(offline)).toBe(true)
  })
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
  const strips = view.findAllComponents(StatusStrip)
  expect(strips).toHaveLength(1)
  expect(strips[0]?.props('kind')).toBe('offline')
  // Said on the button itself, with no line over it (Ф-6).
  expect(view.get('.dock > button').text()).toBe(en.settings.save_needs_network)
  expect(view.find('.dock .note').exists()).toBe(false)
  expect(view.get('.dock > button').attributes('aria-disabled')).toBe('true')
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
  await view.get('.dock > button').trigger('click')
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
  expect(view.get('.dock > button').attributes('aria-disabled')).toBeUndefined()
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
  expect(view.get('.dock > button').attributes('aria-disabled')).toBe('true')
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
  await view.get('.dock > button').trigger('click')
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
  expect(view.get('.dock > button').attributes('aria-disabled')).toBe('true')
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
  await view.get('.dock > button').trigger('click')
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
  await view.get('.dock > button').trigger('click')
  await flushPromises()
  expect(view.find('[role="alert"]').exists()).toBe(true)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  window.dispatchEvent(new Event('offline'))
  await flushPromises()
  expect(view.find('[role="alert"]').exists()).toBe(false)
  expect(view.get('.dock > button').text()).toBe(en.settings.save_needs_network)
  expect(view.get('.dock > button').attributes('aria-disabled')).toBe('true')
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
  const entry = view.findAll('a.nav-row').find((link) => link.text() === en.devices.title)
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
    const captions = view.findAllComponents(SectionCaption).map((caption) => caption.text())

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

describe('a form shown from memory says as of when, and what became of the read (MOL-215, Е-8)', () => {
  const READ = new Date('2026-10-31T10:05:00.000Z')
  const strips = (view: VueWrapper) => view.findAllComponents(StatusStrip)
  // The moment as the strips of «Деньги» print it, by the screen's day (`answeredAt`).
  const asOf = (template: string, at = READ, now = new Date()) =>
    template.replace('{when}', answeredAt(at, 'en', localDay(now), now))

  /** The phone remembers the settings and, unless `readAt` is null, when the server said them. */
  function remember(readAt: Date | null): void {
    localStorage.setItem(
      `molvia.settings.${initial.id}`,
      JSON.stringify({
        settings: { country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' },
        updatedAt: initial.updatedAt.toISOString(),
        ...(readAt ? { readAt: readAt.toISOString() } : {}),
      }),
    )
  }

  it('offline: one strip, at the moment the server last said them', async () => {
    remember(READ)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    me.mockRejectedValue(new TypeError('network'))
    const view = await render(false)

    expect(strips(view)).toHaveLength(1)
    expect(strips(view)[0]?.props('kind')).toBe('offline')
    expect(strips(view)[0]?.props('text')).toBe(asOf(en.settings.offline.strip))
  })

  it('offline, a shelf of the build before: from memory, no time', async () => {
    remember(null)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    me.mockRejectedValue(new TypeError('network'))
    const view = await render(false)

    expect(strips(view)[0]?.props('text')).toBe(en.settings.offline.strip_untimed)
  })

  it('the server did not answer: the strip with «Повторить», never the quiet card over the fields', async () => {
    remember(READ)
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render(false)

    expect(view.find('select').exists()).toBe(true)
    expect(strips(view)).toHaveLength(1)
    expect(strips(view)[0]?.props('kind')).toBe('unanswered')
    expect(strips(view)[0]?.props('text')).toBe(asOf(en.settings.stale_error))
    expect(view.text()).not.toContain(en.settings.load_error.title)
    const attempt = strips(view)[0]?.props('attempt') as number

    // A retry that failed the same way is an answer too: the strip says its words again (C1).
    await strips(view)[0]?.get('button').trigger('click')
    await flushPromises()
    expect(me).toHaveBeenCalledTimes(2)
    expect(strips(view)[0]?.props('attempt')).toBe(attempt + 1)

    me.mockResolvedValue(initial)
    await strips(view)[0]?.get('button').trigger('click')
    await flushPromises()
    expect(strips(view)).toHaveLength(0)
  })

  // Adversarial Д1 of round 5: the edit after a refused save took its notice away, and the strip of the
  // read after it came out of the very tap, moving the fields under it.
  it('must not fire: an edit after a refused save brings no strip of the read before it', async () => {
    const view = await render()
    await field(view, 'city')?.setValue('Ереван')
    save.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    await view.get('.dock > button').trigger('click')
    await flushPromises()
    expect(view.find('[role="alert"]').text()).toContain(en.settings.save_error.title)
    expect(strips(view)).toHaveLength(0)

    await field(view, 'spend')?.setValue('USD')
    await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(strips(view)).toHaveLength(0)
    expect(me).toHaveBeenCalledTimes(2)
  })

  it('must not fire: a failed save speaks for itself, with no strip of the read beside it', async () => {
    const view = await render()
    await field(view, 'city')?.setValue('Ереван')
    save.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    await view.get('.dock > button').trigger('click')
    await flushPromises()

    expect(view.find('[role="alert"]').text()).toContain(en.settings.save_error.title)
    expect(strips(view)).toHaveLength(0)
  })

  // Adversarial А2 of review 1: a read lost with no connection is no server's silence — the connection
  // back read again under «Сервер не ответил» with «Повторить», of a server nobody had asked yet.
  it('must not fire: the connection back says no «Сервер не ответил» over the read it starts', async () => {
    remember(READ)
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    me.mockRejectedValue(new TypeError('Failed to fetch'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const view = await render(false)
      expect(strips(view)[0]?.props('kind')).toBe('offline')

      me.mockReturnValue(new Promise(() => undefined))
      onLine.mockReturnValue(true)
      window.dispatchEvent(new Event('online'))
      await flushPromises()
      expect(me).toHaveBeenCalledTimes(2)
      expect(strips(view)).toHaveLength(0)

      vi.advanceTimersByTime(STRIP_LATE_MS)
      await flushPromises()
      expect(strips(view)).toHaveLength(1)
      expect(strips(view)[0]?.props('kind')).toBe('refreshing')
    } finally {
      vi.useRealTimers()
    }
  })

  it('must not fire: the screen opened again with the connection back, after an offline failure', async () => {
    // The failure lives in the store, not in the screen (adversarial А2б).
    remember(READ)
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    me.mockRejectedValue(new TypeError('Failed to fetch'))
    const first = await render(false)
    expect(strips(first)[0]?.props('kind')).toBe('offline')
    first.unmount()

    onLine.mockReturnValue(true)
    me.mockReturnValue(new Promise(() => undefined))
    const again = mount(SettingsView, {
      global: { plugins: [first.pinia, first.router, createAppI18n('en')] },
    })
    views.push(again)
    await flushPromises()
    expect(strips(again)).toHaveLength(0)
  })

  // Adversarial Б1 of round 2: a server's refusal lived through a stretch with no connection, and the
  // connection back said «Сервер не ответил» over the read it starts.
  it('must not fire: a refusal from before the connection went, over the read its return starts', async () => {
    remember(READ)
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render(false)
    expect(strips(view)[0]?.props('kind')).toBe('unanswered')

    onLine.mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(strips(view)[0]?.props('kind')).toBe('offline')

    me.mockReturnValue(new Promise(() => undefined))
    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(me).toHaveBeenCalledTimes(2)
    expect(strips(view)).toHaveLength(0)
  })

  // Adversarial В1, В2 of round 3: the failure lives in the store, and the screen opened again — after
  // a stretch with no connection lived on another screen, or an hour later — read under «Сервер не
  // ответил» with «Повторить». Only the person's own retry holds it.
  it.each([
    ['after a stretch with no connection on another screen', true],
    ['an hour later, the connection never gone', false],
  ])(
    'must not fire: a refusal from before, over the read of the screen opened again — %s',
    async (_name, wentOffline) => {
      remember(READ)
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
      me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const first = await render(false)
        expect(strips(first)[0]?.props('kind')).toBe('unanswered')
        first.unmount()
        if (wentOffline) {
          onLine.mockReturnValue(false)
          window.dispatchEvent(new Event('offline'))
          onLine.mockReturnValue(true)
          window.dispatchEvent(new Event('online'))
        }

        me.mockReturnValue(new Promise(() => undefined))
        const again = mount(SettingsView, {
          global: { plugins: [first.pinia, first.router, createAppI18n('en')] },
        })
        views.push(again)
        await flushPromises()
        expect(strips(again)).toHaveLength(0)

        vi.advanceTimersByTime(STRIP_LATE_MS)
        await flushPromises()
        expect(strips(again)[0]?.props('kind')).toBe('refreshing')
      } finally {
        vi.useRealTimers()
      }
    },
  )

  // Adversarial Г1 of round 4: the read of the app back in view took the strip down and put it up again
  // — the fields moved twice under the finger, and «Сервер не ответил» was said anew at every return.
  it.each([
    ['the app back in view', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['the connection back', () => window.dispatchEvent(new Event('online'))],
  ])(
    'the strip stands through a read nobody asked for, %s, and says nothing again',
    async (_name, back) => {
      remember(READ)
      me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
      const view = await render(false)
      const strip = strips(view)[0]
      expect(strip?.props('kind')).toBe('unanswered')
      const attempt = strip?.props('attempt') as number

      let refuse: (error: Error) => void = () => undefined
      me.mockReturnValue(
        new Promise((_resolve, reject) => {
          refuse = reject
        }),
      )
      back()
      await flushPromises()
      expect(me).toHaveBeenCalledTimes(2)
      expect(strips(view)).toHaveLength(1)
      expect(strips(view)[0]?.element).toBe(strip?.element)

      refuse(new ApiError(ERROR.INTERNAL))
      await flushPromises()
      expect(strips(view)[0]?.element).toBe(strip?.element)
      expect(strips(view)[0]?.props('attempt')).toBe(attempt)
    },
  )

  it('the person’s own «Повторить» keeps «Сервер не ответил» while it is on its way (C1)', async () => {
    remember(READ)
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render(false)
    me.mockReturnValue(new Promise(() => undefined))
    await strips(view)[0]?.get('button').trigger('click')
    await flushPromises()
    expect(me).toHaveBeenCalledTimes(2)
    expect(strips(view)[0]?.props('kind')).toBe('unanswered')
  })

  // Adversarial Б2 of round 2: the moment moves only with an answer, and a year-old one read as this year.
  it('a moment of another year says its year', async () => {
    remember(new Date('2025-10-30T10:05:00.000Z'))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-02T12:00:00.000Z'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      me.mockRejectedValue(new TypeError('Failed to fetch'))
      const view = await render(false)
      expect(strips(view)[0]?.props('text')).toContain('2025')
    } finally {
      vi.useRealTimers()
    }
  })

  // Adversarial А1: the day was counted once, and the app left overnight said «today» of yesterday.
  it('the day follows the screen past midnight, the app back in view', async () => {
    const before = new Date('2026-10-30T23:50:00.000Z')
    const after = new Date('2026-10-31T00:10:00.000Z')
    const read = new Date('2026-10-30T23:40:00.000Z')
    remember(read)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(before)
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      me.mockRejectedValue(new TypeError('Failed to fetch'))
      const view = await render(false)
      expect(strips(view)[0]?.props('text')).toBe(asOf(en.settings.offline.strip, read, before))
      expect(strips(view)[0]?.props('text')).toContain('today')

      vi.setSystemTime(after)
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(strips(view)[0]?.props('text')).toBe(asOf(en.settings.offline.strip, read, after))
      expect(strips(view)[0]?.props('text')).toContain('yesterday')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a read late past a moment says «обновляем»; a quick one says nothing', async () => {
    remember(READ)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let answer: (value: ActorView) => void = () => undefined
      me.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve
        }),
      )
      const view = await render(false)
      vi.advanceTimersByTime(STRIP_LATE_MS - 1)
      await flushPromises()
      expect(strips(view)).toHaveLength(0)

      vi.advanceTimersByTime(1)
      await flushPromises()
      expect(strips(view)[0]?.props('kind')).toBe('refreshing')
      expect(strips(view)[0]?.props('text')).toBe(asOf(en.settings.stale_loading))
      expect(strips(view)[0]?.find('button').exists()).toBe(false)

      answer(initial)
      await flushPromises()
      expect(strips(view)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('«Сохранить» says why it cannot be pressed, on itself (Ф-6)', () => {
  const button = (view: VueWrapper) => view.get('.dock > button')

  it('no changes', async () => {
    const view = await render()
    expect(button(view).text()).toBe(en.settings.save_unchanged)
    expect(button(view).attributes('aria-disabled')).toBe('true')

    await field(view, 'city')?.setValue('Ереван')
    expect(button(view).text()).toBe(en.settings.save)
    expect(button(view).attributes('aria-disabled')).toBeUndefined()
  })

  it('loading, with no form yet', async () => {
    me.mockReturnValue(new Promise(() => undefined))
    const view = await render(false)
    expect(button(view).text()).toBe(en.state.loading)
  })

  // Adversarial А3: «Повторить» after a refused save stood inactive through the read after it.
  it('loading, the read after a refused save — not a «Повторить» that cannot be pressed', async () => {
    const view = await render()
    await field(view, 'city')?.setValue('Ереван')
    save.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    let answer: (value: ActorView) => void = () => undefined
    me.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    await button(view).trigger('click')
    await flushPromises()
    expect(button(view).text()).toBe(en.state.loading)
    expect(button(view).attributes('aria-disabled')).toBe('true')
    expect(button(view).find('.glyph').exists()).toBe(false)

    answer(initial)
    await flushPromises()
    expect(button(view).text()).toBe(en.state.retry)
    expect(button(view).attributes('aria-disabled')).toBeUndefined()
  })

  it('loading, a changed form waiting for the read — and not an unchanged one', async () => {
    // An unchanged form says «no changes» through the read of every opening: the word would
    // otherwise blink at each one.
    me.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(button(view).text()).toBe(en.settings.save_unchanged)

    await field(view, 'city')?.setValue('Ереван')
    expect(button(view).text()).toBe(en.state.loading)
    expect(button(view).attributes('aria-disabled')).toBe('true')
  })
})

describe('the rows and the fields of the kit (MOL-215, Ф-4, Ф-12)', () => {
  it('a changed field is marked by the kit’s tag of what waits, not by a fill that says «press»', async () => {
    const view = await render()
    await field(view, 'city')?.setValue('Ереван')
    const tags = view.findAllComponents(AppTag)
    expect(tags).toHaveLength(1)
    expect(tags[0]?.props('tone')).toBe('warn')
    expect(tags[0]?.text()).toBe(en.settings.changed)
  })

  it('a chevron on what goes on, none on what acts or asks — and never both in one card (В-14 «а»)', async () => {
    const view = await render()
    const cards = view.findAll('ul').filter((list) => list.findAll(':scope > li').length > 0)
    const rows = cards.map((card) =>
      card.findAll(':scope > li').map((row) => ({
        text: row.text(),
        next: row.find('.chevron').exists(),
      })),
    )
    for (const card of rows) expect(new Set(card.map((row) => row.next)).size).toBe(1)

    const nextOf = (label: string) => rows.flat().find((row) => row.text.startsWith(label))?.next
    for (const label of [
      en.bot.title,
      en.devices.title,
      en.settings.feedback.label,
      en.privacy.title,
      en.terms.title,
    ])
      expect(nextOf(label), label).toBe(true)
    for (const label of [en.settings.sign_out, en.settings.export.label, en.settings.erase.label])
      expect(nextOf(label), label).toBe(false)
  })

  it('«Устройства» and «Выйти» stay one group, two cards (owner’s Q3, MOL-215 В-1 «а»)', async () => {
    const view = await render()
    const group = view
      .findAll('section.group')
      .find((section) => section.text().startsWith(en.settings.group_account))
    expect(group?.findAll('ul')).toHaveLength(2)
    expect(group?.text()).toContain(en.devices.title)
    expect(group?.text()).toContain(en.settings.sign_out)
  })
})
