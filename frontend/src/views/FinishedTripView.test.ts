/**
 * «Записанные покупки» and «Сумма по чеку» (MOL-78): the screen offers the sum only over a trip the
 * server answered with. A finished record read back from the phone's cache does not keep the
 * receipt yet — the previous build reads that cache strictly — so its total may be a receipt with
 * nothing saying so, and a «+ Сумма по чеку» over it would open an empty sheet (review 4).
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useTripHistoryStore } from '@/stores/tripHistory'

const trip = vi.fn<(id: string) => Promise<TripView>>()
vi.mock('@/api', () => ({
  api: {
    trip: (id: string) => trip(id),
    tripHistory: () => new Promise(() => undefined),
    pendingVerdicts: () => new Promise(() => undefined),
    currentTrip: () => new Promise(() => undefined),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'

const row = (amount: { amount: string; currency: 'AMD' } | null, n: number) => ({
  id: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`,
  createdAt: '2026-09-19T08:05:00.000Z',
  item: {
    id: `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind: 'product',
    name: `Товар ${String(n)}`,
    note: null,
    defaultUnit: 'piece',
    typicalQuantity: null,
  },
  quantity: null,
  amount,
  unitPrice: null,
})

/** Milk at 570 ֏, bread with no price, and the receipt of 1 400 ֏. */
const finished: TripView = tripViewCodec.parse({
  id: TRIP,
  startedAt: '2026-09-19T08:00:00.000Z',
  finishedAt: '2026-09-19T09:00:00.000Z',
  currency: 'AMD',
  rate: null,
  rateProvider: null,
  rateJump: null,
  rateStale: false,
  place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
  expenses: [row({ amount: '570', currency: 'AMD' }, 1), row(null, 2)],
  total: [{ amount: '1400', currency: 'AMD' }],
  receipt: { amount: '1400', currency: 'AMD' },
  prices: [{ amount: '570', currency: 'AMD' }],
  gap: { kind: 'unpriced', amount: { amount: '830', currency: 'AMD' } },
  converted: null,
})

const App = defineComponent(() => () => h(RouterView))
const views: VueWrapper[] = []

async function render(): Promise<VueWrapper> {
  // The record was opened once, and the app launched anew: the cache is all the phone has.
  setActivePinia(createPinia())
  useActorStore().id = ME
  useTripHistoryStore().apply(finished)
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ME
  actor.state = 'ready'
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/purchases')
  await router.push(`/purchases/${TRIP}`)
  const view = mount(App, { global: { plugins: [router, pinia, createAppI18n('ru')] } })
  views.push(view)
  await flushPromises()
  return view
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('molvia.actor', ME)
  trip.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.restoreAllMocks()
})

describe('FinishedTripView: «Сумма по чеку» (MOL-78)', () => {
  it('из памяти телефона без связи — суммы не знает: ни «+», ни «Изменить» (ревью 4)', async () => {
    trip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const view = await render()
    expect(view.text()).toContain('Ереван Сити')
    expect(view.text()).not.toContain(ru.trip.receipt.add)
    expect(view.text()).not.toContain(ru.trip.receipt.edit)
  })

  it('контроль: с ответом сервера — «Итого по чеку», разбор и «Изменить сумму по чеку»', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(finished)
    const view = await render()
    expect(view.text()).toContain(ru.trip.receipt.total)
    expect(view.text()).toContain('Без цены — 1')
    expect(view.text()).toContain(ru.trip.receipt.edit)
  })
})
