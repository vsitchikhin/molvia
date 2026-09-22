import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, tripViewCodec } from '@molvia/model'
import type { TripHistory, TripView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import ru from '@/i18n/ru.json'
import { routes } from '@/router'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripStore } from '@/stores/trip'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import TripHistoryView from './TripHistoryView.vue'
import FinishedTripView from './FinishedTripView.vue'

const history = vi.fn<() => Promise<TripHistory>>()
const trip = vi.fn<(id: string) => Promise<TripView>>()
vi.mock('@/api', () => ({ api: { tripHistory: () => history(), trip: (id: string) => trip(id) } }))
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001'
const ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000003'
const ITEM = 'aaaaaaaa-0000-4000-8000-000000000004'
function answer(): TripView {
  return tripViewCodec.parse({
    id: ID,
    startedAt: '2026-09-01T10:00:00Z',
    finishedAt: '2026-09-01T12:00:00Z',
    finishedOnDeviceAt: '2026-09-01T11:00:00Z',
    currency: 'EUR',
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: { id: OWNER, name: 'Рынок', kind: 'store' },
    expenses: [
      {
        id: ITEM,
        createdAt: '2026-09-01T10:01:00Z',
        item: {
          id: ITEM,
          name: 'Сыр',
          kind: 'product',
          defaultUnit: 'kg',
          note: null,
          typicalQuantity: null,
        },
        quantity: null,
        amount: null,
        unitPrice: null,
      },
    ],
    total: [],
    converted: null,
  })
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('molvia.actor', OWNER)
  setActivePinia(createPinia())
  vi.resetAllMocks()
})
afterEach(() => vi.restoreAllMocks())
async function render(detail = false) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(detail ? `/trip/history/${ID}` : '/trip/history')
  const view = mount(detail ? FinishedTripView : TripHistoryView, {
    global: { plugins: [router, createAppI18n('ru')], stubs: { ItemDetailsSheet: true } },
  })
  return { view, router }
}
it('shows loading, then an actionable empty history', async () => {
  history.mockReturnValue(new Promise(() => undefined))
  const { view } = await render()
  expect(view.findComponent({ name: 'ScreenSkeleton' }).exists()).toBe(true)
  view.unmount()
  history.mockResolvedValue({ trips: [], nextCursor: null })
  const empty = await render()
  await flushPromises()
  expect(empty.view.text()).toContain(ru.trip.history.empty_title)
  expect(empty.view.findAll('button').length).toBeGreaterThan(1)
  empty.view.unmount()
})
it('keeps cached rows during an offline failure and opens that exact trip', async () => {
  useTripHistoryStore().apply(answer())
  history.mockRejectedValue(new Error('offline'))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const { view, router } = await render()
  await flushPromises()
  expect(view.text()).toContain('Рынок')
  expect(view.findComponent({ name: 'ScreenState' }).props('kind')).toBe('offline')
  await view.get('.history-row').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.params.tripId).toBe(ID)
  view.unmount()
})
it('shows a retry on a failed history read', async () => {
  history.mockRejectedValue(new Error('server'))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  const { view } = await render()
  await flushPromises()
  expect(view.findComponent({ name: 'ScreenState' }).props('kind')).toBe('error')
  view.unmount()
})
it('edits the selected completed trip and keeps a different active trip untouched', async () => {
  const old = answer()
  useTripStore().apply({ ...old, id: OTHER, currency: 'AMD', finishedAt: null })
  trip.mockResolvedValue(old)
  const { view } = await render(true)
  await flushPromises()
  await view.get('button.row').trigger('click')
  const sheet = view.getComponent(ItemDetailsSheet)
  expect(sheet.props('tripId')).toBe(ID)
  expect(sheet.props('tripContext')).toEqual(old)
  expect(sheet.props('expense')?.id).toBe(ITEM)
  expect(useTripStore().current?.id).toBe(OTHER)
  view.unmount()
})
it('does not offer writing into a missing or foreign trip', async () => {
  trip.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, undefined, true))
  const { view } = await render(true)
  await flushPromises()
  expect(view.find('button.add').exists()).toBe(false)
  expect(view.findComponent({ name: 'ScreenState' }).props('kind')).toBe('attention')
  view.unmount()
})
