import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { AdvicePlace, AdviceResponse, AdviceRow } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import AdviceView from '@/views/AdviceView.vue'

const advice = vi.fn<() => Promise<AdviceResponse>>()
vi.mock('@/api', () => ({ api: { advice: () => advice() } }))

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
  itemId: 'cccccccc-0000-4000-8000-000000000001',
  name: 'Молоко «Ашхар»',
  rating: '4.6',
  ratingsCount: 3,
  review: null,
  places: [place('Ереван Сити', 57_000_000_000n)],
}

const cheese: AdviceRow = {
  level: 'if_cheap',
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
  itemId: 'cccccccc-0000-4000-8000-000000000003',
  name: 'Колбаса «Молочная»',
  rating: '1.4',
  ratingsCount: 3,
  review: 'Пахнет крахмалом, а не мясом',
}

function answer(rows: AdviceRow[], over: Partial<AdviceResponse> = {}): AdviceResponse {
  return { scope: 'own', rows, total: rows.length, ...over }
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const broke = () => new ApiError(ERROR.INTERNAL, 'HTTP 502')

const mounted: VueWrapper[] = []

async function render({ identity = true } = {}) {
  localStorage.setItem('molvia.actor', ME)
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = identity ? ME : null
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/advice')
  const view = mount(AdviceView, {
    global: { plugins: [router, pinia, createAppI18n('en')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router }
}

describe('AdviceView', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    advice.mockReset()
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

    advice.mockResolvedValue(answer([milk], { scope: 'shared' }))
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

  it('nothing rated yet: the empty state explains «rate one → it shows up here»', async () => {
    advice.mockResolvedValue(answer([]))
    const { view, router } = await render()

    expect(view.text()).toContain(en.advice.empty.title)
    const action = view.findAll('button').find((button) => button.text() === en.advice.empty.action)
    await action?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('verdicts')
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
    expect(view.findAll('button')).toHaveLength(0)
  })

  it('offline with a remembered list shows the rows and names their age exactly', async () => {
    advice.mockResolvedValue(answer([milk]))
    await render()

    online(false)
    advice.mockRejectedValue(broke())
    const { view } = await render()

    expect(view.text()).toContain(milk.name)
    expect(view.text()).toContain('The list as of today at')
    // The list is there, so there is nothing to press: it refreshes by itself.
    expect(view.findAll('button')).toHaveLength(0)
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

  it('without an identity the screen asks for nothing and shows no failure of its own', async () => {
    const { view } = await render({ identity: false })

    expect(advice).not.toHaveBeenCalled()
    expect(view.text()).not.toContain(en.advice.error.title)
    expect(view.text()).not.toContain(en.advice.offline.title)
    expect(view.find('.skeleton').exists()).toBe(false)
  })
})
