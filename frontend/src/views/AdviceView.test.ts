import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, adviceResponseSchema } from '@molvia/model'
import type {
  AdvicePlace,
  AdviceResponse,
  AdviceRow,
  AdviceSearchResponse,
  PendingVerdicts,
  Rating,
  VerdictAmendment,
  VerdictCard,
} from '@molvia/model'
import en from '@/i18n/en.json'
import { forgetPageWrites } from '@/composables/useAdvice'
import { createAppI18n } from '@/i18n'
import StatusStrip, { STRIP_LATE_MS } from '@/components/StatusStrip.vue'
import IconMagnify from '~icons/mdi/magnify'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useReceiptQueueStore } from '@/stores/receiptQueue'
import AdviceView from '@/views/AdviceView.vue'

const advice = vi.fn<() => Promise<AdviceResponse>>()
const adviceSearch = vi.fn<(query: string) => Promise<AdviceSearchResponse>>()
const pendingVerdicts = vi.fn<() => Promise<PendingVerdicts>>()
const amendVerdict = vi.fn<(itemId: string, patch: VerdictAmendment) => Promise<VerdictCard>>()
const withdrawVerdict = vi.fn<(itemId: string) => Promise<void>>()
const rateItem =
  vi.fn<(itemId: string, rating: Rating) => Promise<{ verdict: VerdictCard; created: boolean }>>()
vi.mock('@/api', () => ({
  api: {
    receipts: () => Promise.resolve({ receipts: [] }),
    advice: () => advice(),
    adviceSearch: (query: string) => adviceSearch(query),
    pendingVerdicts: () => pendingVerdicts(),
    amendVerdict: (itemId: string, patch: VerdictAmendment) => amendVerdict(itemId, patch),
    withdrawVerdict: (itemId: string) => withdrawVerdict(itemId),
    rateItem: (itemId: string, rating: Rating) => rateItem(itemId, rating),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

// A verdict written from the sheet is kept by the page as well as the shelf (MOL-202): a fresh page
// for every test, as a reload makes one.
beforeEach(() => {
  forgetPageWrites()
})

function place(name: string, scaledMinor: bigint): AdvicePlace {
  return {
    placeId: 'aaaaaaaa-0000-4000-8000-000000000001',
    name,
    unitPrice: { scaledMinor, currency: 'AMD', unit: 'l' },
    observations: 3,
  }
}

const milk: AdviceRow = {
  level: 'take',
  isMine: true,
  ownScore: 5,
  itemId: 'cccccccc-0000-4000-8000-000000000001',
  name: 'Молоко «Ашхар»',
  rating: '4.6',
  ratingsCount: 3,
  review: null,
  places: [place('Ереван Сити', 57_000_000_000n)],
}

const cheese: AdviceRow = {
  level: 'if_cheap',
  isMine: true,
  ownScore: 3,
  itemId: 'cccccccc-0000-4000-8000-000000000002',
  name: 'Сыр «Чанах»',
  rating: '2.8',
  ratingsCount: 3,
  review: null,
  places: [],
  threshold: null,
}

const sausage: AdviceRow = {
  level: 'never',
  isMine: true,
  ownScore: 1,
  itemId: 'cccccccc-0000-4000-8000-000000000003',
  name: 'Колбаса «Молочная»',
  rating: '1.4',
  ratingsCount: 3,
  review: 'Пахнет крахмалом, а не мясом',
}

/** How a row looks in the own mode: one verdict, so the figure is whole and it is the asker's. */
const mine: AdviceRow = { ...sausage, rating: '1.0', ratingsCount: 1 }

function answer(rows: AdviceRow[], over: Partial<AdviceResponse> = {}): AdviceResponse {
  return {
    geography: { country: 'AM', city: 'Гюмри' },
    scope: 'own',
    rows,
    total: rows.length,
    ...over,
  }
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const broke = () => new ApiError(ERROR.INTERNAL, 'HTTP 502')

const mounted: VueWrapper[] = []

/** The strips of the connection on the screen, by kind and words: one a screen (MOL-181). */
function strips(view: VueWrapper): { kind: string; text: string }[] {
  return view.findAllComponents(StatusStrip).map((strip) => ({
    kind: strip.props('kind') as string,
    text: strip.props('text') as string,
  }))
}

/** Every «Try again» on the screen, wherever it stands — the strip of the screen included. */
function retries(): Element[] {
  return [...document.body.querySelectorAll('button')].filter(
    (button) => button.textContent.trim() === en.state.retry,
  )
}

async function render({ identity = true, country = 'AM' } = {}) {
  localStorage.setItem('molvia.actor', ME)
  localStorage.setItem(
    `molvia.settings.${ME}`,
    JSON.stringify({ country, city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = identity ? ME : null
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const view = mount(AdviceView, {
    global: { plugins: [router, pinia, createAppI18n('en')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router }
}

describe('AdviceView', () => {
  // A country the server reads no receipt of (Р-1): the version «без чека» of MOL-128 (Д-3).
  describe('without receipts (Д-3, review 12)', () => {
    it('a person with ratings has no strip; a newcomer records purchases from it', async () => {
      const georgia = { geography: { country: 'GE', city: 'Гюмри' } }
      advice.mockResolvedValue(answer([milk], georgia))
      const rated = await render({ country: 'GE' })
      expect(rated.view.find('.dock').exists()).toBe(false)
      expect(rated.view.text()).not.toContain(en.purchases.capture)

      advice.mockResolvedValue(answer([], georgia))
      const newcomer = await render({ country: 'GE' })
      expect(newcomer.view.text()).toContain(en.advice.home.new.title)
      expect(newcomer.view.get('.dock').text()).toContain(en.purchases.manual)
      expect(newcomer.view.text()).not.toContain(en.purchases.capture)
    })

    // 1k-0: the strip has nothing to do without a list, so it is the error's — the one «Try again»
    // of the screen (Ф-15), and the words are a person's, not a developer's (Ф-19).
    it('no answer and nothing remembered: one «Try again», in the strip', async () => {
      advice.mockRejectedValue(broke())
      const { view } = await render({ country: 'GE' })

      expect(view.text()).toContain(en.advice.error.body)
      expect(retries()).toHaveLength(1)
      expect(view.get('.dock').text()).toContain(en.state.retry)
      expect(view.find('input[type="search"]').exists()).toBe(false)
    })

    // 1l-0: the cold offline is not empty (Ф-14) — the field, the cloud, and purchases recorded
    // from the strip, since a purchase needs no list.
    it('offline with nothing remembered: the field, the cloud, and «Record purchases» below', async () => {
      online(false)
      advice.mockRejectedValue(broke())
      const { view } = await render({ country: 'GE' })

      expect(view.find('input[type="search"]').exists()).toBe(true)
      const state = view.getComponent({ name: 'ScreenState' })
      expect(state.props('kind')).toBe('offline')
      expect(state.props('tone')).toBe('warn')
      expect(state.props('body')).toBe(en.advice.offline.body)
      expect(view.get('.dock').text()).toContain(en.purchases.manual)
      expect(strips(view)).toEqual([])
      expect(retries()).toHaveLength(0)
    })

    // С-1: nothing on the phone to search, and the answer says so and why — in place of the cloud,
    // as the list gives way to what is found; the server is not asked.
    it('offline with nothing remembered: a query is answered «offline», and the cloud gives way', async () => {
      online(false)
      advice.mockRejectedValue(broke())
      const { view } = await render({ country: 'GE' })

      await view.get('input[type="search"]').setValue('молоко')
      await flushPromises()

      expect(adviceSearch).not.toHaveBeenCalled()
      const states = view.findAllComponents({ name: 'ScreenState' })
      expect(states).toHaveLength(1)
      expect(states[0]?.props('kind')).toBe('empty')
      expect(states[0]?.props('body')).toBe(en.advice.search.empty.body_offline)
      expect(view.get('.dock').text()).toContain(en.purchases.manual)

      // Cleared, the cloud is back.
      await view.get('.clear').trigger('click')
      await flushPromises()
      expect(view.getComponent({ name: 'ScreenState' }).props('kind')).toBe('offline')
    })

    // The connection back without a list — the server failed, or nothing is rated yet: the field
    // being typed in stays under the thumb with what it holds, and answers from the server; cleared,
    // it goes and the focus is given to the heading (owner's В-3 «а» on adversarial А1).
    for (const [kind, reply] of [
      ['fails', () => advice.mockRejectedValue(broke())],
      [
        'is empty',
        () => advice.mockResolvedValue(answer([], { geography: { country: 'GE', city: 'Гюмри' } })),
      ],
    ] as const) {
      it(`В-3: back online, the list ${kind} — the field typed in stays, cleared it goes`, async () => {
        online(false)
        advice.mockRejectedValue(broke())
        const { view } = await render({ country: 'GE' })
        const field = view.get<HTMLInputElement>('input[type="search"]')
        field.element.focus()
        await field.setValue('молоко')
        await flushPromises()

        online(true)
        reply()
        adviceSearch.mockResolvedValue({
          geography: { country: 'GE', city: 'Гюмри' },
          scope: 'own',
          near: true,
          items: [{ itemId: milk.itemId, name: milk.name, advice: null }],
        })
        window.dispatchEvent(new Event('online'))
        await flushPromises()
        await vi.waitFor(() => {
          expect(adviceSearch).toHaveBeenCalledWith('молоко')
        })
        await flushPromises()

        expect(view.get('input[type="search"]').element).toBe(field.element)
        expect(field.element.value).toBe('молоко')
        expect(document.activeElement).toBe(field.element)
        expect(view.text()).toContain(milk.name)
        // What the list's answer put up waits for the field to be cleared.
        expect(view.text()).not.toContain(en.advice.error.title)
        expect(view.text()).not.toContain(en.advice.home.new.title)

        // Erased to nothing to type another word: the field stays, with the focus (В-4 «а», Б2).
        for (const text of ['мо', 'м', '']) await field.setValue(text)
        await flushPromises()
        expect(view.get('input[type="search"]').element).toBe(field.element)
        expect(document.activeElement).toBe(field.element)
        await field.setValue('сыр')
        await flushPromises()
        expect(field.element.value).toBe('сыр')

        // «Очистить» gives the focus back to the field (Р-12), so it stays too.
        await view.get('.clear').trigger('click')
        await flushPromises()
        expect(view.get('input[type="search"]').element).toBe(field.element)

        // Left empty, it goes; the focus is where the person put it, never pulled to the heading.
        field.element.blur()
        await flushPromises()
        expect(view.find('input[type="search"]').exists()).toBe(false)
        expect(view.text()).toContain(
          kind === 'fails' ? en.advice.error.title : en.advice.home.new.title,
        )
        expect(document.activeElement?.tagName).not.toBe('H1')
      })
    }

    // Nobody touched the field: the connection back without a list takes it, and the focus stays
    // where it was — <body> on a phone nobody touched is no focus to give away (Б1, review № 8).
    it('must not fire: the field nobody touched goes, the focus is not pulled to the heading', async () => {
      online(false)
      advice.mockRejectedValue(broke())
      const { view } = await render({ country: 'GE' })
      expect(document.activeElement).toBe(document.body)

      online(true)
      window.dispatchEvent(new Event('online'))
      await flushPromises()

      expect(view.find('input[type="search"]').exists()).toBe(false)
      expect(view.text()).toContain(en.advice.error.title)
      expect(document.activeElement).toBe(document.body)
    })

    /** The cold offline, «мол» typed, the connection back with the list failed, the text erased. */
    async function heldEmpty() {
      online(false)
      advice.mockRejectedValue(broke())
      const rendered = await render({ country: 'GE' })
      const field = rendered.view.get<HTMLInputElement>('input[type="search"]')
      field.element.focus()
      await field.setValue('мол')
      await flushPromises()
      online(true)
      adviceSearch.mockResolvedValue({
        geography: { country: 'GE', city: 'Гюмри' },
        scope: 'own',
        near: true,
        items: [],
      })
      window.dispatchEvent(new Event('online'))
      await flushPromises()
      await field.setValue('')
      await flushPromises()
      expect(document.activeElement).toBe(field.element)
      return { ...rendered, field }
    }

    // A press under the field takes the focus as it lands; the field goes once the press is over,
    // or what was pressed rose from under the finger before the release (owner's В-5 «а», В1).
    it('В-5: the focus taken by a press — the empty field goes only after the release', async () => {
      const { view, field } = await heldEmpty()

      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      field.element.blur()
      await flushPromises()
      expect(view.find('input[type="search"]').exists()).toBe(true)

      // Still there until the task after the release, where its click is dispatched — `flushPromises`
      // waits a task itself, so the render is awaited without one.
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await nextTick()
      expect(view.find('input[type="search"]').exists()).toBe(true)
      await new Promise((resolve) => setTimeout(resolve))
      await flushPromises()
      expect(view.find('input[type="search"]').exists()).toBe(false)
      expect(view.text()).toContain(en.advice.error.title)
      expect(document.activeElement?.tagName).not.toBe('H1')
    })

    // «Очистить» pressed takes the focus for a moment and gives it back: the press is no leaving.
    it('must not fire: a press on «Clear» keeps the empty field', async () => {
      const { view, field } = await heldEmpty()
      await field.setValue('сыр')
      await flushPromises()

      const clear = view.get('.clear')
      clear.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      ;(clear.element as HTMLButtonElement).focus()
      await clear.trigger('click')
      clear.element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve))
      await flushPromises()

      expect(view.get('input[type="search"]').element).toBe(field.element)
      expect(document.activeElement).toBe(field.element)
    })

    // Gone to another app to copy a name: the page lost the system's focus, not the person the field.
    it('must not fire: the page losing the system`s focus keeps the empty field', async () => {
      const { view, field } = await heldEmpty()
      const away = vi.spyOn(document, 'hasFocus').mockReturnValue(false)

      field.element.blur()
      await flushPromises()
      away.mockRestore()

      expect(view.get('input[type="search"]').element).toBe(field.element)
    })

    // The strip of a list remembered empty — another window kept it — stands under the field the
    // focus holds over the newcomer, never above it as well (adversarial В2).
    it('В2: over the newcomer with the field held, one strip, under the field', async () => {
      online(false)
      advice.mockRejectedValue(broke())
      const { view } = await render({ country: 'GE' })
      const field = view.get<HTMLInputElement>('input[type="search"]')
      field.element.focus()
      await flushPromises()

      // Another window kept an empty list meanwhile; this one, back in view, cannot ask.
      localStorage.setItem(
        `molvia.advice.${ME}`,
        JSON.stringify({
          answer: answer([], { geography: { country: 'GE', city: 'Гюмри' } }),
          fetchedAt: new Date('2026-10-21T09:00:00Z').toISOString(),
        }),
      )
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()

      expect(view.text()).toContain(en.advice.home.new.title)
      expect(view.get('input[type="search"]').element).toBe(field.element)
      expect(strips(view)).toHaveLength(1)
      const under = view.get('.strip').element.closest('.head')
      expect(under?.contains(field.element)).toBe(true)
    })

    // The connection back: the list comes under the very field being typed in.
    it('the connection back brings the list under the same field, the text kept', async () => {
      online(false)
      advice.mockRejectedValue(broke())
      const { view } = await render({ country: 'GE' })
      const field = view.get<HTMLInputElement>('input[type="search"]')
      await field.setValue('мол')
      await flushPromises()

      online(true)
      const georgia = { geography: { country: 'GE', city: 'Гюмри' } }
      advice.mockResolvedValue(answer([milk], georgia))
      adviceSearch.mockResolvedValue({ ...georgia, scope: 'own', near: true, items: [] })
      window.dispatchEvent(new Event('online'))
      await flushPromises()

      expect(view.get('input[type="search"]').element).toBe(field.element)
      expect(field.element.value).toBe('мол')
      await field.setValue('')
      await flushPromises()
      expect(view.text()).toContain(milk.name)
      expect(view.find('.dock').exists()).toBe(false)
    })

    // A failure under «Где вы?» opened from the strip: the error is a section's while the sheet is
    // up, so the strip — and the sheet and what was typed in it — stays (MOL-180, adversarial А1,
    // as Р-15 of MOL-128). Taken by the error, the sheet went, and `entering` stuck.
    it('a failure under the open sheet keeps it, and the strip is the error’s once it is down', async () => {
      const georgia = { geography: { country: 'GE', city: 'Гюмри' } }
      advice.mockResolvedValue(answer([], georgia))
      const { view } = await render({ country: 'GE' })
      await view.get('.dock').get('button').trigger('click')
      await flushPromises()
      const sheet = () => view.findComponent({ name: 'StartTripSheet' })
      expect(sheet().props('open')).toBe(true)

      // The city moved in another tab, and the answer for it failed.
      advice.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
      const key = `molvia.settings.${ME}`
      localStorage.setItem(
        key,
        JSON.stringify({
          country: 'GE',
          city: 'Тбилиси',
          spendCurrency: 'AMD',
          incomeCurrency: 'RUB',
        }),
      )
      window.dispatchEvent(new StorageEvent('storage', { key }))
      await flushPromises()

      expect(view.text()).toContain(en.advice.error.title)
      expect(sheet().exists()).toBe(true)
      expect(sheet().props('open')).toBe(true)
      expect(view.get('.state').classes()).toContain('card')
      expect(view.get('.dock').text()).not.toContain(en.state.retry)
    })

    // Serbia's receipts are read by the QR code off the photo (MOL-233): the version «с чеком» whole,
    // where MOL-232 left it «без чека» on this screen (Р-9).
    it('a person in Serbia takes a receipt from here as anyone whose receipts are read', async () => {
      const serbia = { geography: { country: 'RS', city: 'Гюмри' } }
      advice.mockResolvedValue(answer([milk], serbia))
      const rated = await render({ country: 'RS' })
      expect(rated.view.get('.dock').text()).toContain(en.purchases.capture)

      advice.mockResolvedValue(answer([], serbia))
      const newcomer = await render({ country: 'RS' })
      expect(newcomer.view.text()).toContain(en.advice.home.new_capture.title)
    })

    it('a receipt by its link on its way is «by link», never «0 parts» (MOL-233)', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      advice.mockResolvedValue(answer([], { geography: { country: 'RS', city: 'Гюмри' } }))
      const { view } = await render({ country: 'RS' })
      useReceiptQueueStore().sendLink({
        id: 'b2c3d4e5-0000-4000-8000-000000000001',
        // a sale made up by the model's `madeUpSerbianLink`, as in `LinkReceiptSheet.test.ts`
        link: 'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAANQ2SgAAAAAAAAABmBxSTwgAAABUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNQ87U0RqxUqXGlv0IC2EMdY%3D',
        country: 'RS',
        language: 'en',
        capturedAt: new Date(),
      })
      await flushPromises()
      expect(view.text()).toContain(en.purchases.waiting.replace('{parts}', en.purchases.by_link))
      expect(view.text()).not.toContain('0 parts')
    })
  })

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    advice.mockReset()
    adviceSearch.mockReset()
    pendingVerdicts.mockReset()
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    vi.restoreAllMocks()
    online(true)
  })

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
  })

  // The answer's shape, with the field's well where the field will stand (Ф-13, 1j).
  it('draws the skeleton while the answer is on its way, the field`s well first', async () => {
    advice.mockReturnValue(new Promise(() => undefined))
    const { view } = await render()

    expect(view.find('.skeleton').exists()).toBe(true)
    // The well where the field will stand, above the frame (review № 2).
    const head = view.get('.ghost-head').element
    expect(head.firstElementChild?.classList).toContain('skeleton-field')
    expect(head.nextElementSibling?.classList).toContain('skeleton')
    expect(view.findAll('.skeleton .ghost-take')).toHaveLength(1)
    expect(view.findAll('.skeleton .skeleton-caption')).toHaveLength(3)
    // The subtitle's line is held, as a bar (owner's В-2 «а»).
    expect(view.find('.subtitle .subtitle-bar').exists()).toBe(true)
  })

  // The line under the title stands in every state, so the field under it never moves (В-2 «а»): a
  // bar while the answer is on its way, empty with none, the words once they are known.
  it('В-2: the subtitle`s line stands in every state, words only with the answer', async () => {
    online(false)
    advice.mockRejectedValue(broke())
    const cold = await render({ country: 'GE' })
    expect(cold.view.find('.subtitle .subtitle-hold').exists()).toBe(true)
    expect(cold.view.find('.subtitle-bar').exists()).toBe(false)

    online(true)
    const failed = await render({ country: 'GE' })
    expect(failed.view.find('.subtitle .subtitle-hold').exists()).toBe(true)

    advice.mockResolvedValue(answer([milk]))
    const ready = await render()
    expect(ready.view.get('.subtitle').text()).toBe(en.advice.own_data_only)
  })

  it('three groups, each in its own shape, in the order the answer arrived', async () => {
    advice.mockResolvedValue(answer([milk, cheese, sausage]))
    const { view } = await render()

    expect(view.findAll('h2').map((head) => head.text())).toEqual([
      en.advice.group_take,
      en.advice.group_if_cheap,
      en.advice.group_never,
    ])
    expect(view.findAllComponents({ name: 'AdviceTakeCard' })).toHaveLength(1)
    expect(view.findAllComponents({ name: 'AdviceCheapRow' })).toHaveLength(1)
    expect(view.findAllComponents({ name: 'AdviceNeverRow' })).toHaveLength(1)
    expect(view.text()).toContain(en.advice.no_price_shown)
  })

  it('an empty group prints no heading: «BUY IT» over nothing is a promise of nothing', async () => {
    advice.mockResolvedValue(answer([sausage]))
    const { view } = await render()

    expect(view.findAll('h2').map((head) => head.text())).toEqual([en.advice.group_never])
  })

  it('says whose figures it shows, and in the shared mode what is still one`s own', async () => {
    advice.mockResolvedValue(answer([milk]))
    const own = await render()
    expect(own.view.text()).toContain(en.advice.own_data_only)
    expect(own.view.text()).not.toContain(en.advice.shared_note)

    advice.mockResolvedValue(
      answer([milk], { geography: { country: 'AM', city: 'Гюмри' }, scope: 'shared' }),
    )
    const shared = await render()
    expect(shared.view.text()).toContain(en.advice.shared_data)
    expect(shared.view.text()).toContain(en.advice.shared_note)
  })

  it('a cut list says it is cut, and a whole one says nothing', async () => {
    advice.mockResolvedValue(answer([milk], { total: 340 }))
    const cut = await render()
    expect(cut.view.text()).toContain('Showing 1 of 340')

    advice.mockResolvedValue(answer([milk]))
    const whole = await render()
    expect(whole.view.text()).not.toContain('Showing')
  })

  describe('the newcomer (MOL-128, handoff `02`)', () => {
    it('nothing rated: an offer to act — first purchases, the cycle, «Записать покупки» below', async () => {
      advice.mockResolvedValue(answer([]))
      const { view, router } = await render()

      expect(view.text()).toContain(en.advice.home.new_capture.title)
      expect(view.text()).toContain(en.advice.home.new_capture.body.replace('{app}', en.app.name))
      expect(view.text()).toContain(en.advice.home.trust)
      // No search before the first verdict, and nobody's data to speak of in a subtitle.
      expect(view.find('input[type="search"]').exists()).toBe(false)
      expect(view.text()).not.toContain(en.advice.own_data_only)
      expect(view.get('.dock').text()).toContain(en.purchases.capture)
      // No circle anywhere: a «+» in one read as a button (MOL-77).
      expect(view.find('.circle').exists()).toBe(false)

      const step = view
        .findAll('button')
        .find((button) => button.text().includes(en.advice.home.step_purchases_capture_title))
      await step?.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('purchases')
    })

    it('the last step is this screen: said, and not a button', async () => {
      advice.mockResolvedValue(answer([]))
      const { view } = await render()
      expect(view.text()).toContain(en.advice.home.step_advice_title)
      expect(
        view.findAll('button').some((b) => b.text().includes(en.advice.home.step_advice_title)),
      ).toBe(false)
    })

    it('purchases waiting for a verdict: «Now rate them», and the card leads to «Оценки»', async () => {
      advice.mockResolvedValue(answer([]))
      pendingVerdicts.mockResolvedValue({
        items: [
          {
            itemId: 'cccccccc-0000-4000-8000-000000000009',
            name: 'Лаваш',
            placeName: 'Рынок',
            boughtAt: new Date(),
          },
        ],
        total: 1,
      })
      const { view, router } = await render()

      expect(view.text()).toContain(en.advice.home.pending.title)
      expect(view.text()).not.toContain(en.advice.home.new_capture.title)
      await view.get('.pending .purchase-row').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('verdicts')
    })

    it('no answer and nothing remembered is not a newcomer: offline, not the offer', async () => {
      online(false)
      advice.mockRejectedValue(broke())
      const { view } = await render()
      expect(view.text()).not.toContain(en.advice.home.new_capture.title)
    })
  })

  it('the server broke: red, with «Try again» — and the retry brings the list', async () => {
    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(view.text()).toContain(en.advice.error.title)

    advice.mockResolvedValue(answer([milk]))
    const retry = view.findAll('button').find((button) => button.text().includes(en.state.retry))
    await retry?.trigger('click')
    await flushPromises()

    expect(view.text()).toContain(milk.name)
  })

  it('offline with nothing remembered is yellow and offers no button to press', async () => {
    online(false)
    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(view.text()).toContain(en.advice.offline.title)
    expect(view.text()).not.toContain(en.advice.error.title)
    // Nothing to press about the list; the camera stands in the strip, a receipt needs no list
    // (handoff v2, 1l — MOL-127).
    expect(view.findAll('button').map((button) => button.text())).toEqual([en.purchases.capture])
  })

  it('offline with a remembered list shows the rows and names their age exactly', async () => {
    advice.mockResolvedValue(answer([milk]))
    await render()

    online(false)
    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(view.text()).toContain(milk.name)
    // One strip, the cloud, under the field — never red (Ф-14).
    expect(strips(view)).toEqual([
      { kind: 'offline', text: expect.stringContaining('Offline · the list as of today,') },
    ])
    expect(view.find('.head .strip').exists()).toBe(true)
    // The connection will come back by itself, so the strip offers nothing to press.
    expect(retries()).toHaveLength(0)
  })

  it('the server broke with a list remembered: the strip offers the retry the screen cannot make', async () => {
    advice.mockResolvedValue(answer([milk]))
    await render()

    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(strips(view)).toEqual([
      {
        kind: 'unanswered',
        text: expect.stringContaining('The server did not answer — the list as of today,'),
      },
    ])
    // One «Try again» on the screen, in the strip: the docked strip holds the camera (Ф-15).
    expect(retries()).toHaveLength(1)
    expect(view.get('.strip .action').text()).toBe(en.state.retry)

    // A retry that failed the same way is an answer still: the strip says it again (C1).
    const before = view.findComponent(StatusStrip).props('attempt') as number
    await view.get('.strip .action button').trigger('click')
    await flushPromises()
    expect(view.findComponent(StatusStrip).props('attempt')).toBe(before + 1)
  })

  it('a tap on a row opens the sheet on that row, and a save asks the server again', async () => {
    advice.mockResolvedValue(answer([milk, mine]))
    const { view } = await render()

    await view.findComponent({ name: 'AdviceNeverRow' }).trigger('click')
    await flushPromises()

    const sheet = view.findComponent({ name: 'VerdictEditSheet' })
    expect(sheet.exists()).toBe(true)
    expect(sheet.props('itemId')).toBe(mine.itemId)
    // The scale opens on the person's own score, as the row carries it.
    expect(sheet.props('ownScore')).toBe(1)
    expect(sheet.props('ownReview')).toBe(mine.review)
    expect(sheet.props('mine')).toBe(true)

    // A saved verdict moves the row to another group, or out of the list: the screen asks the
    // server again rather than moving it itself.
    advice.mockResolvedValue(answer([milk]))
    sheet.vm.$emit('saved', { score: 5, review: mine.review })
    await flushPromises()

    expect(advice).toHaveBeenCalledTimes(2)
    expect(view.findAllComponents({ name: 'AdviceNeverRow' })).toHaveLength(0)
  })

  it('in the shared mode the sheet opens on one`s own score, never the average (MOL-202)', async () => {
    // «2,3 из 5» is three people's; the person gave 1, and the sheet says so (С-2, Ф-25).
    advice.mockResolvedValue(
      answer([{ ...sausage, rating: '2.3', ratingsCount: 3, ownScore: 1 }], {
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'shared',
      }),
    )
    const { view } = await render()

    await view.findComponent({ name: 'AdviceNeverRow' }).trigger('click')
    await flushPromises()

    const sheet = view.findComponent({ name: 'VerdictEditSheet' })
    expect(sheet.props('ownScore')).toBe(1)
    expect(sheet.props('shared')).toBe(true)
  })

  it('А2: a stranger`s row opens the sheet as «rate it», not as «amend»', async () => {
    advice.mockResolvedValue(
      answer([{ ...mine, isMine: false, ownScore: null }], {
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'shared',
      }),
    )
    const { view } = await render()

    await view.findComponent({ name: 'AdviceNeverRow' }).trigger('click')
    await flushPromises()

    const sheet = view.findComponent({ name: 'VerdictEditSheet' })
    expect(sheet.props('mine')).toBe(false)
    expect(sheet.props('ownScore')).toBeNull()
  })

  it('А4: the age of a remembered list is on the screen once the answer is late', async () => {
    advice.mockResolvedValue(answer([milk]))
    await render()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      advice.mockReturnValue(new Promise<AdviceResponse>(() => undefined))
      const { view } = await render()

      // A quick answer would replace the list in silence: nothing flashes under the field (В-1 «а»).
      expect(view.text()).toContain(milk.name)
      expect(strips(view)).toEqual([])

      vi.advanceTimersByTime(STRIP_LATE_MS - 1)
      await nextTick()
      expect(strips(view)).toEqual([])

      vi.advanceTimersByTime(1)
      await nextTick()
      expect(strips(view)).toEqual([
        { kind: 'refreshing', text: expect.stringContaining('Refreshing · the list as of today,') },
      ])
      // Nothing to press: the request it is waiting for is already in the air.
      expect(retries()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('must not fire: an answer in time puts no strip up at all', async () => {
    advice.mockResolvedValue(answer([milk]))
    await render()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let answered: (value: AdviceResponse) => void = () => undefined
      advice.mockReturnValue(new Promise<AdviceResponse>((resolve) => (answered = resolve)))
      const { view } = await render()

      vi.advanceTimersByTime(STRIP_LATE_MS - 1)
      answered(answer([milk]))
      await flushPromises()
      vi.advanceTimersByTime(STRIP_LATE_MS)
      await nextTick()
      expect(strips(view)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('С-4: an empty list from the phone is dated too', async () => {
    advice.mockResolvedValue(answer([]))
    await render()

    online(false)
    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(view.text()).toContain(en.advice.home.new_capture.title)
    // No field over the newcomer: the strip stands under the header.
    expect(strips(view)).toEqual([
      { kind: 'offline', text: expect.stringContaining('Offline · the list as of today,') },
    ])
  })

  it('without an identity the screen asks for nothing and shows no failure of its own', async () => {
    const { view } = await render({ identity: false })

    expect(advice).not.toHaveBeenCalled()
    expect(view.text()).not.toContain(en.advice.error.title)
    expect(view.text()).not.toContain(en.advice.offline.title)
    expect(view.find('.skeleton').exists()).toBe(false)
  })

  describe('the search (MOL-128, handoff `01`)', () => {
    const plait = {
      itemId: 'cccccccc-0000-4000-8000-000000000004',
      name: 'Сыр «Косичка»',
      advice: null,
    }
    const found = (
      items: AdviceSearchResponse['items'],
      over: Partial<AdviceSearchResponse> = {},
    ): AdviceSearchResponse => ({
      geography: { country: 'AM', city: 'Гюмри' },
      scope: 'own',
      near: true,
      items,
      ...over,
    })

    async function typed(view: Awaited<ReturnType<typeof render>>['view'], text: string) {
      await view.get('input[type="search"]').setValue(text)
      await vi.waitFor(() => {
        expect(view.find('.skeleton').exists()).toBe(false)
      })
      await flushPromises()
    }

    it('asks the server, and lays the found out by the list`s groups, «not rated» last', async () => {
      advice.mockResolvedValue(answer([milk]))
      adviceSearch.mockResolvedValue(
        found([
          { itemId: plait.itemId, name: plait.name, advice: null },
          { itemId: sausage.itemId, name: sausage.name, advice: sausage },
          { itemId: cheese.itemId, name: cheese.name, advice: cheese },
        ]),
      )
      const { view } = await render()
      await typed(view, 'syr')

      await vi.waitFor(() => {
        expect(adviceSearch).toHaveBeenCalledWith('syr')
      })
      await flushPromises()
      expect(view.findAll('h2').map((head) => head.text())).toEqual([
        en.advice.group_if_cheap,
        en.advice.group_never,
        en.advice.search.group_unrated,
      ])
      // The list gives way while something is typed.
      expect(view.text()).not.toContain(milk.name)
      // Here too «не брать нигде» has nothing to be cheap with, and no «no price on purpose» tail.
      expect(view.findComponent({ name: 'AdviceNeverRow' }).text()).not.toMatch(/֏/)
      expect(view.text()).not.toContain(en.advice.no_price_shown)
      // Nothing to propose: nothing was bought here.
      expect(view.text()).not.toContain(en.item.empty.action)
    })

    it('«Rate» on an item not rated opens the sheet for a first verdict', async () => {
      advice.mockResolvedValue(answer([milk]))
      adviceSearch.mockResolvedValue(found([{ ...plait }]))
      const { view } = await render()
      await typed(view, 'косичка')
      await vi.waitFor(() => {
        expect(view.text()).toContain(en.advice.search.rate)
      })

      // A row of the kit, its name the title and nothing under it: the caption says «not rated» (С-9).
      const row = view.getComponent({ name: 'ListRow' })
      expect(row.props('title')).toBe(plait.name)
      expect(row.props('meta')).toBe('')
      expect(row.props('next')).toBe(false)
      expect(row.text()).not.toContain(en.advice.search.group_unrated)
      await row.trigger('click')
      await flushPromises()
      const sheet = view.findComponent({ name: 'VerdictEditSheet' })
      expect(sheet.props('itemId')).toBe(plait.itemId)
      expect(sheet.props('name')).toBe(plait.name)
      expect(sheet.props('mine')).toBe(false)

      // A save asks again for the list and for what is found.
      advice.mockResolvedValue(answer([milk]))
      sheet.vm.$emit('saved', { score: 4, review: null })
      await vi.waitFor(() => {
        expect(adviceSearch).toHaveBeenCalledTimes(2)
      })
      expect(advice).toHaveBeenCalledTimes(2)
    })

    it('nothing found: «No … found», the quiet circle and no action', async () => {
      advice.mockResolvedValue(answer([milk]))
      adviceSearch.mockResolvedValue(found([], { near: false }))
      const { view } = await render()
      await typed(view, 'кускус')

      await vi.waitFor(() => {
        expect(view.text()).toContain('No «кускус» found')
      })
      expect(view.get('.state').classes()).toContain('quiet')
      expect(view.getComponent({ name: 'ScreenState' }).props('icon')).toBe(IconMagnify)
      expect(view.get('.state').find('button').exists()).toBe(false)
    })

    it('only far rows: said above them — the server`s word (MOL-46)', async () => {
      advice.mockResolvedValue(answer([milk]))
      adviceSearch.mockResolvedValue(found([{ ...plait }], { near: false }))
      const { view } = await render()
      await typed(view, 'пельмени')

      await vi.waitFor(() => {
        expect(view.get('.miss').text()).toBe('No «пельмени» found')
      })
      expect(view.text()).toContain(plait.name)
    })

    it('offline: the remembered list, searched on the phone with the transliteration (В-3)', async () => {
      advice.mockResolvedValue(answer([milk, cheese]))
      await render()
      online(false)
      advice.mockRejectedValue(broke())
      const { view } = await render()

      await view.get('input[type="search"]').setValue('syr')
      await flushPromises()

      expect(adviceSearch).not.toHaveBeenCalled()
      expect(view.findAllComponents({ name: 'AdviceCheapRow' })).toHaveLength(1)
      expect(view.text()).not.toContain(milk.name)
      expect(strips(view)).toEqual([
        {
          kind: 'offline',
          text: expect.stringContaining('Offline · searching only the list as of'),
        },
      ])
      expect(view.text()).toContain(en.advice.search.offline_more)
    })

    it('waiting for its first answer: the groups` shape, no second well', async () => {
      advice.mockResolvedValue(answer([milk]))
      adviceSearch.mockReturnValue(new Promise(() => undefined))
      const { view } = await render()

      await view.get('input[type="search"]').setValue('сыр')
      await vi.waitFor(() => {
        expect(adviceSearch).toHaveBeenCalled()
      })

      expect(view.find('.skeleton .ghost-take').exists()).toBe(true)
      expect(view.find('.skeleton-field').exists()).toBe(false)
    })

    it('clearing the field brings the list back and asks nothing', async () => {
      advice.mockResolvedValue(answer([milk]))
      adviceSearch.mockResolvedValue(found([{ ...plait }]))
      const { view } = await render()
      await typed(view, 'сыр')
      await vi.waitFor(() => {
        expect(view.text()).toContain(plait.name)
      })

      await view.get('.clear').trigger('click')
      await flushPromises()
      expect(view.text()).toContain(milk.name)
      expect(view.text()).not.toContain(plait.name)
      expect(view.find('.clear').exists()).toBe(false)
    })
  })
})

// The review of MOL-128 (adversarial В, Г, Д, Е; review Р-3, Р-12, Р-13, Р-14, Р-16).
describe('AdviceView after the review', () => {
  const lori: AdviceRow = {
    level: 'take',
    isMine: true,
    ownScore: 5,
    itemId: 'cccccccc-0000-4000-8000-000000000012',
    name: 'Сыр «Лори»',
    rating: '5.0',
    ratingsCount: 1,
    review: null,
    places: [],
  }
  const ours = (items: AdviceSearchResponse['items'], over: Partial<AdviceSearchResponse> = {}) =>
    ({
      geography: { country: 'AM', city: 'Гюмри' },
      scope: 'own',
      near: true,
      items,
      ...over,
    }) satisfies AdviceSearchResponse

  async function renderIn(city: string) {
    localStorage.setItem('molvia.actor', ME)
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({ country: 'AM', city, spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
    )
    const pinia = createPinia()
    setActivePinia(pinia)
    useActorStore().id = ME
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const view = mount(AdviceView, {
      global: { plugins: [router, pinia, createAppI18n('en')] },
      attachTo: document.body,
    })
    mounted.push(view)
    await flushPromises()
    return view
  }

  async function type(view: VueWrapper, text: string): Promise<void> {
    await view.get('input[type="search"]').setValue(text)
    await vi.waitFor(() => {
      expect(adviceSearch).toHaveBeenCalled()
    })
    await flushPromises()
  }

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    advice.mockReset()
    adviceSearch.mockReset()
    pendingVerdicts.mockReset()
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    vi.restoreAllMocks()
    online(true)
  })

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
  })

  describe('В: the newcomer`s headline speaks only of a queue known', () => {
    it('the queue still on its way — no «record your first», the skeleton in its place', async () => {
      advice.mockResolvedValue(answer([]))
      pendingVerdicts.mockReturnValue(new Promise(() => undefined))
      const view = await renderIn('Гюмри')

      expect(view.text()).not.toContain(en.advice.home.new_capture.title)
      expect(view.text()).not.toContain(en.advice.home.pending.title)
      expect(view.find('.skeleton').exists()).toBe(true)
      // The action is there all the same.
      expect(view.get('.dock').text()).toContain(en.purchases.capture)
    })

    it('offline with no queue remembered — no headline at all, the cycle still there', async () => {
      advice.mockResolvedValue(answer([]))
      pendingVerdicts.mockRejectedValue(broke())
      await renderIn('Гюмри')
      for (const view of mounted.splice(0)) view.unmount()

      online(false)
      advice.mockRejectedValue(broke())
      pendingVerdicts.mockRejectedValue(broke())
      const view = await renderIn('Гюмри')

      expect(view.text()).not.toContain(en.advice.home.new_capture.title)
      expect(view.text()).toContain(en.advice.home.step_verdicts_title)
    })

    it('the queue answered empty — «record your first»', async () => {
      advice.mockResolvedValue(answer([]))
      const view = await renderIn('Гюмри')
      expect(view.text()).toContain(en.advice.home.new_capture.title)
    })
  })

  it('Г: after a save from the search the answer stays, dimmed, while it is asked again', async () => {
    advice.mockResolvedValue(answer([milk, lori]))
    adviceSearch.mockResolvedValue(ours([{ itemId: lori.itemId, name: lori.name, advice: lori }]))
    const view = await renderIn('Гюмри')
    await type(view, 'сыр')

    await view.get('.tap').trigger('click')
    await flushPromises()
    adviceSearch.mockReturnValue(new Promise(() => undefined))
    view.findComponent({ name: 'VerdictEditSheet' }).vm.$emit('saved', { score: 5, review: null })
    await flushPromises()

    expect(view.find('.skeleton').exists()).toBe(false)
    expect(view.find('.found.stale').exists()).toBe(true)
    expect(view.text()).toContain(lori.name)
  })

  it('Д: the field back over a list asked again searches what it holds', async () => {
    advice.mockResolvedValue(answer([milk]))
    await renderIn('Гюмри')
    for (const view of mounted.splice(0)) view.unmount()

    online(false)
    advice.mockRejectedValue(broke())
    const view = await renderIn('Ереван')
    await view.get('input[type="search"]').setValue('мол')
    await flushPromises()
    expect(view.text()).toContain(milk.name)

    online(true)
    advice.mockResolvedValue(answer([milk], { geography: { country: 'AM', city: 'Ереван' } }))
    adviceSearch.mockResolvedValue(ours([{ itemId: milk.itemId, name: milk.name, advice: milk }]))
    window.dispatchEvent(new Event('online'))
    // The list asked again, then the search's own pause.
    await vi.waitFor(
      () => {
        expect(adviceSearch).toHaveBeenCalledWith('мол')
        expect(view.find('.found').exists()).toBe(true)
        expect(view.text()).toContain(milk.name)
      },
      { timeout: 3000 },
    )
  })

  it('Е: the sheet from the search reads whose figure it is from the search`s answer', async () => {
    const shared: AdviceRow = { ...lori, rating: '4.0', ratingsCount: 3 }
    advice.mockResolvedValue(answer([lori]))
    adviceSearch.mockResolvedValue(
      ours([{ itemId: shared.itemId, name: shared.name, advice: shared }], { scope: 'shared' }),
    )
    const view = await renderIn('Гюмри')
    await type(view, 'сыр')

    await view.get('.tap').trigger('click')
    await flushPromises()
    const sheet = view.findComponent({ name: 'VerdictEditSheet' })

    // «4,0» of three is not the person's 5: the sheet takes the score the row carries (MOL-202).
    expect(sheet.props('ownScore')).toBe(5)
    expect(sheet.props('shared')).toBe(true)
  })

  it('Р-12: «Clear» puts the focus back into the field', async () => {
    advice.mockResolvedValue(answer([milk]))
    adviceSearch.mockResolvedValue(ours([]))
    const view = await renderIn('Гюмри')
    await type(view, 'сыр')

    await view.get('.clear').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(view.get('input[type="search"]').element)
  })

  it('Р-16: searching with no connection — one strip of the age, the search`s, under the field', async () => {
    advice.mockResolvedValue(answer([milk]))
    await renderIn('Гюмри')
    for (const view of mounted.splice(0)) view.unmount()
    online(false)
    advice.mockRejectedValue(broke())
    const view = await renderIn('Гюмри')
    expect(strips(view).map((strip) => strip.text)).toEqual([
      expect.stringContaining('Offline · the list as of'),
    ])

    await view.get('input[type="search"]').setValue('мол')
    await flushPromises()

    expect(strips(view)).toEqual([
      { kind: 'offline', text: expect.stringContaining('Offline · searching only the list as of') },
    ])
  })

  it('a list of another city, offline: one strip, the cloud, naming both cities', async () => {
    advice.mockResolvedValue(answer([milk], { geography: { country: 'AM', city: 'Ереван' } }))
    await renderIn('Ереван')
    for (const view of mounted.splice(0)) view.unmount()
    online(false)
    advice.mockRejectedValue(broke())
    const view = await renderIn('Гюмри')

    expect(view.text()).toContain(milk.name)
    expect(strips(view)).toEqual([
      {
        kind: 'offline',
        text: expect.stringMatching(/^Offline · the list for .+ as of today, .+\. Prices for /u),
      },
    ])
  })

  // The field goes with the focus in it — a city moved in another tab: the focus is given to the
  // heading, never left on <body> (Б1: only a focus that was in the field).
  it('the city moved with the focus in the field: the focus goes to the heading', async () => {
    advice.mockResolvedValue(answer([milk]))
    const view = await renderIn('Гюмри')
    view.get<HTMLInputElement>('input[type="search"]').element.focus()
    await flushPromises()

    advice.mockReturnValue(new Promise<AdviceResponse>(() => undefined))
    const key = `molvia.settings.${ME}`
    localStorage.setItem(
      key,
      JSON.stringify({
        country: 'AM',
        city: 'Ереван',
        spendCurrency: 'AMD',
        incomeCurrency: 'RUB',
      }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key }))
    await flushPromises()

    expect(view.find('.skeleton').exists()).toBe(true)
    expect(view.find('input[type="search"]').exists()).toBe(false)
    expect(document.activeElement?.tagName).toBe('H1')
  })

  it('a city changed, its list late: «refreshing» for that city in one strip with the skeleton', async () => {
    advice.mockResolvedValue(answer([milk], { geography: { country: 'AM', city: 'Ереван' } }))
    await renderIn('Ереван')
    for (const view of mounted.splice(0)) view.unmount()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      advice.mockReturnValue(new Promise<AdviceResponse>(() => undefined))
      const view = await renderIn('Гюмри')
      expect(view.find('.skeleton').exists()).toBe(true)
      expect(strips(view)).toEqual([])

      vi.advanceTimersByTime(STRIP_LATE_MS)
      await nextTick()
      expect(strips(view)).toEqual([
        { kind: 'refreshing', text: 'Refreshing · the list for Gyumri' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // Two waits are two requests: a refresh already late, then a city moved in another tab — the new
  // city's list was asked a moment ago, and its strip waits its own second (adversarial А2).
  it('А2: a city moved after a late refresh — its strip waits its own second', async () => {
    advice.mockResolvedValue(answer([milk]))
    await renderIn('Гюмри')
    for (const view of mounted.splice(0)) view.unmount()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      advice.mockReturnValue(new Promise<AdviceResponse>(() => undefined))
      const view = await renderIn('Гюмри')
      vi.advanceTimersByTime(STRIP_LATE_MS)
      await nextTick()
      expect(strips(view).map((strip) => strip.kind)).toEqual(['refreshing'])

      let answered: (value: AdviceResponse) => void = () => undefined
      advice.mockReturnValue(new Promise<AdviceResponse>((resolve) => (answered = resolve)))
      const key = `molvia.settings.${ME}`
      localStorage.setItem(
        key,
        JSON.stringify({
          country: 'AM',
          city: 'Ереван',
          spendCurrency: 'AMD',
          incomeCurrency: 'RUB',
        }),
      )
      window.dispatchEvent(new StorageEvent('storage', { key }))
      await nextTick()
      await nextTick()
      expect(view.find('.skeleton').exists()).toBe(true)
      expect(strips(view)).toEqual([])

      vi.advanceTimersByTime(STRIP_LATE_MS - 1)
      await nextTick()
      expect(strips(view)).toEqual([])
      vi.advanceTimersByTime(1)
      await nextTick()
      expect(strips(view)).toEqual([
        { kind: 'refreshing', text: 'Refreshing · the list for Yerevan' },
      ])

      // A quick answer to a city never shows it: here it answers late, and the strip goes with it.
      answered(answer([milk], { geography: { country: 'AM', city: 'Ереван' } }))
      await flushPromises()
      expect(strips(view)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

// MOL-202, adversarial А1: after a save the rows stay as they were until they are asked for again,
// and a sheet opened on one of them said «Your rating: 1» over the 5 just saved — and refused the 1
// as «Nothing has changed». The real sheet here, its keys and its button pressed.
describe('AdviceView: the sheet after a save (MOL-202, А1)', () => {
  const ITEM = sausage.itemId
  /** «Не брать нигде» in the shared mode: 2.3 is three people's, the person's own is `own`. */
  const row = (own: number, rating = '2.3'): AdviceRow => ({
    ...sausage,
    rating,
    ratingsCount: 3,
    ownScore: own,
    review: null,
  })
  const shared = (rows: AdviceRow[]) =>
    answer(rows, { geography: { country: 'AM', city: 'Гюмри' }, scope: 'shared' })
  const card = (score: number): VerdictCard => {
    const at = new Date()
    return { itemId: ITEM, score, review: null, ratedAt: at, updatedAt: at }
  }
  let clock = 0

  beforeEach(() => {
    // Shelves a test blocked are given back before they are cleared.
    vi.restoreAllMocks()
    forgetPageWrites()
    localStorage.clear()
    sessionStorage.clear()
    advice.mockReset()
    adviceSearch.mockReset()
    amendVerdict.mockReset()
    withdrawVerdict.mockReset()
    rateItem.mockReset()
    pendingVerdicts.mockReset()
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    vi.restoreAllMocks()
    online(true)
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
    document.body.innerHTML = ''
  })

  /** A tap on the row, past the sheet's rise: until then it takes no tap. */
  async function open(view: VueWrapper): Promise<VueWrapper> {
    await view.findComponent({ name: 'AdviceNeverRow' }).trigger('click')
    await flushPromises()
    clock += 1000
    await new Promise((resolve) => setTimeout(resolve, 5))
    return view.findComponent({ name: 'VerdictEditSheet' })
  }

  const key = (sheet: VueWrapper, score: number) =>
    sheet.get(`button[aria-label="Rating ${String(score)} out of 5"]`)

  /** The sheet's main action, whatever its words. */
  const main = (sheet: VueWrapper) => sheet.get('button.large')

  /** Own 1 → 5, saved; what the list is asked for after the save is `next`. */
  async function saveFive(view: VueWrapper, next: () => void): Promise<void> {
    const sheet = await open(view)
    amendVerdict.mockResolvedValueOnce(card(5))
    next()
    await key(sheet, 5).trigger('click')
    await main(sheet).trigger('click')
    await flushPromises()
    ;(view.vm as unknown as { putAway(): void }).putAway()
    await flushPromises()
  }

  /** The sheet opened again stands on the 5, and the 1 put back over it is sent. */
  async function onFiveAndOneSent(view: VueWrapper): Promise<void> {
    const sheet = await open(view)
    expect(sheet.get('.current').text()).toBe('Your rating: 5')
    expect(key(sheet, 5).attributes('aria-pressed')).toBe('true')
    await key(sheet, 1).trigger('click')
    await main(sheet).trigger('click')
    await flushPromises()
    expect(amendVerdict).toHaveBeenLastCalledWith(ITEM, { score: 1 })
  }

  it('control: the list asked again came — the sheet opens on its row', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    await saveFive(view, () => advice.mockResolvedValue(shared([row(5, '3.7')])))

    await onFiveAndOneSent(view)
  })

  it('the list asked again failed — the sheet opens on what was saved, and the 1 goes', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    await saveFive(view, () => advice.mockRejectedValue(broke()))

    // The row still reads the answer before the save: the sheet does not.
    expect(advice).toHaveBeenCalledTimes(2)
    await onFiveAndOneSent(view)
  })

  it('the list asked again is on its way — the same', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    await saveFive(view, () => advice.mockReturnValue(new Promise(() => undefined)))

    await onFiveAndOneSent(view)
  })

  it('in the own mode too, where the row itself still says 1', async () => {
    advice.mockResolvedValue(answer([{ ...row(1, '1.0'), ratingsCount: 1 }]))
    const { view } = await render()
    await saveFive(view, () => advice.mockRejectedValue(broke()))

    await onFiveAndOneSent(view)
  })

  it('a refresh asked before the save lands after it with the old figures — still the 5', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    // The connection back asks again; its answer is held until after the save.
    let land: (value: AdviceResponse) => void = () => undefined
    advice.mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    await saveFive(view, () => advice.mockReturnValue(new Promise(() => undefined)))
    land(shared([row(1)]))
    await flushPromises()

    await onFiveAndOneSent(view)
  })

  it('a withdrawal: the row opened again offers «Rate it», not an amendment that answers 404', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    let sheet = await open(view)
    withdrawVerdict.mockResolvedValueOnce()
    advice.mockRejectedValue(broke())
    await sheet
      .findAll('button')
      .find((b) => b.text() === 'Withdraw the rating')
      ?.trigger('click')
    await flushPromises()
    ;(view.vm as unknown as { putAway(): void }).putAway()
    await flushPromises()

    sheet = await open(view)
    expect(sheet.text()).toContain(en.advice.edit.meta_new)
    expect(sheet.find('.current').exists()).toBe(false)
    rateItem.mockResolvedValueOnce({ verdict: card(2), created: false })
    await key(sheet, 2).trigger('click')
    await main(sheet).trigger('click')
    await flushPromises()
    expect(rateItem).toHaveBeenCalledWith(ITEM, { score: 2 })
    expect(amendVerdict).not.toHaveBeenCalled()
  })

  it('Б1: a step away and back while the list asked again failed — still the 5', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const first = await render()
    await saveFive(first.view, () => advice.mockRejectedValue(broke()))
    first.view.unmount()
    mounted.splice(mounted.indexOf(first.view), 1)

    // A new screen over the memory written before the save, the server still failing.
    const { view } = await render()
    expect(view.findAllComponents({ name: 'AdviceNeverRow' })).toHaveLength(1)
    await onFiveAndOneSent(view)
  })

  it('Б1: a step away and back while the list asked again is on its way — the same', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const first = await render()
    await saveFive(first.view, () => advice.mockReturnValue(new Promise(() => undefined)))
    first.view.unmount()
    mounted.splice(mounted.indexOf(first.view), 1)

    const { view } = await render()
    await onFiveAndOneSent(view)
  })

  it('Б1 control: back on a screen whose own answer came — the sheet is the server`s again', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const first = await render()
    await saveFive(first.view, () => advice.mockRejectedValue(broke()))
    first.view.unmount()
    mounted.splice(mounted.indexOf(first.view), 1)

    // Asked after the write, and saying 3 — set from elsewhere meanwhile: the answer wins.
    advice.mockResolvedValue(shared([row(3, '2.7')]))
    const { view } = await render()
    const sheet = await open(view)
    expect(sheet.get('.current').text()).toBe('Your rating: 3')
  })

  it('Б1 control: the memory written after the write is the server`s word, failing or not', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const first = await render()
    // Asked after the save and answered 3 — set elsewhere meanwhile; the phone keeps that answer.
    await saveFive(first.view, () => advice.mockResolvedValue(shared([row(3, '2.7')])))
    first.view.unmount()
    mounted.splice(mounted.indexOf(first.view), 1)

    advice.mockRejectedValue(broke())
    const { view } = await render()
    const sheet = await open(view)
    expect(sheet.get('.current').text()).toBe('Your rating: 3')
  })

  it('В1: a reload over the memory from before the save, the server failing — still the 5', async () => {
    forgetPageWrites()
    // What the page before left on the shelf: the list as it was, and the write it made after it.
    localStorage.setItem(
      `molvia.advice.${ME}`,
      JSON.stringify({
        answer: adviceResponseSchema.encode(shared([row(1)])),
        fetchedAt: new Date(),
      }),
    )
    localStorage.setItem(
      `molvia.advice-written.${ME}`,
      JSON.stringify({
        [ITEM]: { verdict: { score: 5, review: null }, page: 'the page before', after: 7 },
      }),
    )
    advice.mockRejectedValue(broke())
    const { view } = await render()

    await onFiveAndOneSent(view)
  })

  it('В1: the write is on the shelf beside the memory, and an answer asked after it lets it go', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    await saveFive(view, () => advice.mockRejectedValue(broke()))
    expect(JSON.parse(localStorage.getItem(`molvia.advice-written.${ME}`) ?? '{}')).toMatchObject({
      [ITEM]: { verdict: { score: 5, review: null } },
    })

    advice.mockResolvedValue(shared([row(5, '3.7')]))
    await view.vm.$nextTick()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(localStorage.getItem(`molvia.advice-written.${ME}`)).toBeNull()
  })

  it('В1: a write of the page before is let go by any answer of this one, whatever its number', async () => {
    forgetPageWrites()
    localStorage.setItem(
      `molvia.advice-written.${ME}`,
      JSON.stringify({
        [ITEM]: { verdict: { score: 5, review: null }, page: 'the page before', after: 1e9 },
      }),
    )
    advice.mockResolvedValue(shared([row(3, '2.7')]))
    const { view } = await render()

    expect(localStorage.getItem(`molvia.advice-written.${ME}`)).toBeNull()
    const sheet = await open(view)
    expect(sheet.get('.current').text()).toBe('Your rating: 3')
  })

  it('№5: an answer landing in the screen left lets nothing go — the new one still opens on the 5', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const first = await render()
    // The list asked again after the save is slow: it lands only once the person is back.
    let land: (value: AdviceResponse) => void = () => undefined
    await saveFive(first.view, () =>
      advice.mockReturnValueOnce(new Promise((resolve) => (land = resolve))),
    )
    first.view.unmount()
    mounted.splice(mounted.indexOf(first.view), 1)

    advice.mockRejectedValue(broke())
    const { view } = await render()
    land(shared([row(5, '3.7')]))
    await flushPromises()

    await onFiveAndOneSent(view)
  })

  it('Г2: a shelf full for the second write keeps the page`s word, and loses its own past', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    await saveFive(view, () => advice.mockRejectedValue(broke()))

    // `localStorage` is full now: it refuses the key and still answers with what it held.
    const real = window.localStorage
    const full: Storage = {
      getItem: (key) => real.getItem(key),
      removeItem: (key) => {
        real.removeItem(key)
      },
      setItem: (key, value) => {
        if (key.startsWith('molvia.advice-written'))
          throw new DOMException('full', 'QuotaExceededError')
        real.setItem(key, value)
      },
      clear: () => {
        real.clear()
      },
      key: (n) => real.key(n),
      get length() {
        return real.length
      },
    }
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full)
    const sheet = await open(view)
    amendVerdict.mockResolvedValueOnce(card(3))
    await key(sheet, 3).trigger('click')
    await main(sheet).trigger('click')
    await flushPromises()
    ;(view.vm as unknown as { putAway(): void }).putAway()
    await flushPromises()

    const again = await open(view)
    expect(again.get('.current').text()).toBe('Your rating: 3')
    // The next page reads the 3 from the shelf that took it, never the 5 the full one held.
    expect(real.getItem(`molvia.advice-written.${ME}`)).toBeNull()
    expect(sessionStorage.getItem(`molvia.advice-written.${ME}`)).toContain('"score":3')
  })

  it('Г1: a shelf blocked outright — the page keeps the write, still the 5', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    const { view } = await render()
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked)
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked)
    await saveFive(view, () => advice.mockRejectedValue(broke()))

    await onFiveAndOneSent(view)
  })

  it('a row found by the search, dimmed while it is asked again — the same', async () => {
    advice.mockResolvedValue(shared([row(1)]))
    adviceSearch.mockResolvedValue({
      geography: { country: 'AM', city: 'Гюмри' },
      scope: 'shared',
      near: true,
      items: [{ itemId: ITEM, name: sausage.name, advice: row(1) }],
    })
    const { view } = await render()
    await view.get('input[type="search"]').setValue('колб')
    await vi.waitFor(() => {
      expect(adviceSearch).toHaveBeenCalled()
    })
    await flushPromises()

    adviceSearch.mockReturnValue(new Promise(() => undefined))
    await saveFive(view, () => advice.mockReturnValue(new Promise(() => undefined)))
    expect(view.find('.found.stale').exists()).toBe(true)

    await onFiveAndOneSent(view)
  })
})
