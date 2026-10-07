import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type {
  AdvicePlace,
  AdviceResponse,
  AdviceRow,
  AdviceSearchResponse,
  PendingVerdicts,
} from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useReceiptQueueStore } from '@/stores/receiptQueue'
import AdviceView from '@/views/AdviceView.vue'

const advice = vi.fn<() => Promise<AdviceResponse>>()
const adviceSearch = vi.fn<(query: string) => Promise<AdviceSearchResponse>>()
const pendingVerdicts = vi.fn<() => Promise<PendingVerdicts>>()
vi.mock('@/api', () => ({
  api: {
    receipts: () => Promise.resolve({ receipts: [] }),
    advice: () => advice(),
    adviceSearch: (query: string) => adviceSearch(query),
    pendingVerdicts: () => pendingVerdicts(),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

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

  it('draws the skeleton while the answer is on its way', async () => {
    advice.mockReturnValue(new Promise(() => undefined))
    const { view } = await render()

    expect(view.find('.skeleton').exists()).toBe(true)
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
    expect(view.text()).toContain('The list as of today at')
    // The connection will come back by itself, so the strip offers nothing to press.
    expect(view.findAll('button').map((button) => button.text())).not.toContain(en.state.retry)
  })

  it('the server broke with a list remembered: the strip offers the retry the screen cannot make', async () => {
    advice.mockResolvedValue(answer([milk]))
    await render()

    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(view.text()).toContain('the server did not answer')
    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    expect(retry).toBeDefined()
  })

  it('a tap on a row opens the sheet on that row, and a save asks the server again', async () => {
    advice.mockResolvedValue(answer([milk, mine]))
    const { view } = await render()

    await view.findComponent({ name: 'AdviceNeverRow' }).trigger('click')
    await flushPromises()

    const sheet = view.findComponent({ name: 'VerdictEditSheet' })
    expect(sheet.exists()).toBe(true)
    expect(sheet.props('itemId')).toBe(mine.itemId)
    // Own mode: the figure on the row is this person's, so the scale opens on it.
    expect(sheet.props('ownScore')).toBe(1)
    expect(sheet.props('ownReview')).toBe(mine.review)
    expect(sheet.props('mine')).toBe(true)

    // A saved verdict moves the row to another group, or out of the list: the screen asks the
    // server again rather than moving it itself.
    advice.mockResolvedValue(answer([milk]))
    sheet.vm.$emit('saved')
    await flushPromises()

    expect(advice).toHaveBeenCalledTimes(2)
    expect(view.findAllComponents({ name: 'AdviceNeverRow' })).toHaveLength(0)
  })

  it('in the shared mode the sheet is opened with no score chosen', async () => {
    // The same row that opens pre-chosen in the own mode: here the figure is an average.
    advice.mockResolvedValue(
      answer([mine], { geography: { country: 'AM', city: 'Гюмри' }, scope: 'shared' }),
    )
    const { view } = await render()

    await view.findComponent({ name: 'AdviceNeverRow' }).trigger('click')
    await flushPromises()

    const sheet = view.findComponent({ name: 'VerdictEditSheet' })
    expect(sheet.props('ownScore')).toBeNull()
    expect(sheet.props('shared')).toBe(true)
  })

  it('А2: a stranger`s row opens the sheet as «rate it», not as «amend»', async () => {
    advice.mockResolvedValue(
      answer([{ ...mine, isMine: false }], {
        geography: { country: 'AM', city: 'Гюмри' },
        scope: 'shared',
      }),
    )
    const { view } = await render()

    await view.findComponent({ name: 'AdviceNeverRow' }).trigger('click')
    await flushPromises()

    expect(view.findComponent({ name: 'VerdictEditSheet' }).props('mine')).toBe(false)
  })

  it('А4: the age of a remembered list is on the screen while the answer is still coming', async () => {
    advice.mockResolvedValue(answer([milk]))
    await render()

    advice.mockReturnValue(new Promise<AdviceResponse>(() => undefined))
    const { view } = await render()

    expect(view.text()).toContain(milk.name)
    expect(view.find('.stale').exists()).toBe(true)
    expect(view.text()).toContain('The list as of today at')
    // Nothing to press: the request it is waiting for is already in the air.
    expect(view.findAll('button').map((button) => button.text())).not.toContain(en.state.retry)
  })

  it('С-4: an empty list from the phone is dated too', async () => {
    advice.mockResolvedValue(answer([]))
    await render()

    online(false)
    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(view.text()).toContain(en.advice.home.new_capture.title)
    expect(view.text()).toContain('The list as of today at')
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

      await view.get('.unrated-row').trigger('click')
      await flushPromises()
      const sheet = view.findComponent({ name: 'VerdictEditSheet' })
      expect(sheet.props('itemId')).toBe(plait.itemId)
      expect(sheet.props('name')).toBe(plait.name)
      expect(sheet.props('mine')).toBe(false)

      // A save asks again for the list and for what is found.
      advice.mockResolvedValue(answer([milk]))
      sheet.vm.$emit('saved')
      await vi.waitFor(() => {
        expect(adviceSearch).toHaveBeenCalledTimes(2)
      })
      expect(advice).toHaveBeenCalledTimes(2)
    })

    it('nothing found: «No … found», no circle and no action', async () => {
      advice.mockResolvedValue(answer([milk]))
      adviceSearch.mockResolvedValue(found([], { near: false }))
      const { view } = await render()
      await typed(view, 'кускус')

      await vi.waitFor(() => {
        expect(view.text()).toContain('No «кускус» found')
      })
      expect(view.find('.circle').exists()).toBe(false)
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
      expect(view.text()).toContain('Without a connection we search only the list as of')
      expect(view.text()).toContain(en.advice.search.offline_more)
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
    view.findComponent({ name: 'VerdictEditSheet' }).vm.$emit('saved')
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

    // An average of three is nobody's own score: nothing is chosen for the person.
    expect(sheet.props('ownScore')).toBeNull()
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
    expect(view.find('.stale').exists()).toBe(true)

    await view.get('input[type="search"]').setValue('мол')
    await flushPromises()

    expect(view.find('.stale').exists()).toBe(false)
    expect(view.text()).toContain('Without a connection we search only the list as of')
  })
})
