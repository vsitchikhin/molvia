/**
 * «Записанные покупки» and «Сумма по чеку» (MOL-78): the screen offers the sum only over a trip the
 * server answered with. A finished record read back from the phone's cache does not keep the
 * receipt yet — the previous build reads that cache strictly — so its total may be a receipt with
 * nothing saying so, and a «+ Сумма по чеку» over it would open an empty sheet (review 4).
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney, tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { dayOfAnyYear, timeOfDay } from '@/days'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'

const trip = vi.fn<(id: string) => Promise<TripView>>()
vi.mock('@/api', () => ({
  api: {
    trip: (id: string) => trip(id),
    tripHistory: () => new Promise(() => undefined),
    pendingVerdicts: () => new Promise(() => undefined),
    currentTrip: () => new Promise(() => undefined),
    receipts: () => new Promise(() => undefined),
    // The trip's queue: nothing leaves — no signal at the shelf.
    removeExpense: () => new Promise(() => undefined),
    removeTrip: () => new Promise(() => undefined),
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
  placeCity: 'Гюмри',
  expenses: [row({ amount: '570', currency: 'AMD' }, 1), row(null, 2)],
  total: [{ amount: '1400', currency: 'AMD' }],
  receipt: { amount: '1400', currency: 'AMD' },
  prices: [{ amount: '570', currency: 'AMD' }],
  gap: { kind: 'unpriced', amount: { amount: '830', currency: 'AMD' } },
  converted: null,
})

const App = defineComponent(() => () => h(RouterView))
const views: VueWrapper[] = []

async function render(cached: TripView | null = finished): Promise<VueWrapper> {
  // The record was opened once, and the app launched anew: the cache is all the phone has.
  setActivePinia(createPinia())
  useActorStore().id = ME
  if (cached) useTripHistoryStore().apply(cached)
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
    // Its total is the receipt with nothing saying so: «С ценой — 1 из 2» beside it read as the prices.
    expect(view.text().replaceAll('\u00a0', ' ')).not.toContain('С ценой')
  })

  /** Another window — its own pinia, the same phone storage — wrote this record to the shelf. */
  async function otherWindowWrites(written: TripView): Promise<void> {
    const here = getActivePinia()
    setActivePinia(createPinia())
    useActorStore().id = ME
    useTripHistoryStore().apply(written)
    if (here) setActivePinia(here)
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${ME}` }))
    await flushPromises()
  }

  it('соседнее окно записало ту же запись — ответ на экране остаётся, с суммой и разбором (ревью Е, Е2)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(finished)
    const view = await render()
    expect(view.text()).toContain(ru.trip.receipt.edit)

    await otherWindowWrites(finished)

    expect(view.text()).toContain(ru.trip.receipt.total)
    expect(view.text().replaceAll('\u00a0', ' ')).toContain('без цены — 830 ֏')
    expect(view.text()).toContain(ru.trip.receipt.edit)
    expect(view.text()).not.toContain(ru.trip.receipt.add)
    // Nothing was asked again from here: two windows on one trip would ask each other in a circle.
    expect(trip).toHaveBeenCalledTimes(1)
  })

  it('соседнее окно записало запись новее — она на экране, а сумма не предлагается: полка её не знает', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(finished)
    const view = await render()

    // The other window added a purchase and got the answer; the shelf keeps it without the receipt.
    const fresher = tripViewCodec.parse({
      ...tripViewCodec.encode(finished),
      expenses: [...tripViewCodec.encode(finished).expenses, row(null, 3)],
    })
    await otherWindowWrites(fresher)

    expect(view.text()).toContain('Товар 3')
    expect(view.text()).not.toContain(ru.trip.receipt.add)
    expect(view.text()).not.toContain(ru.trip.receipt.edit)
  })

  it('контроль: с ответом сервера — «Итого по чеку», разбор и «Изменить сумму по чеку»', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(finished)
    const view = await render()
    expect(view.text()).toContain(ru.trip.receipt.total)
    expect(view.text().replaceAll('\u00a0', ' ')).toContain('без цены — 830 ֏')
    expect(view.text()).toContain(ru.trip.receipt.edit)
  })
})

describe('FinishedTripView: код из чека уже у другой позиции (MOL-234)', () => {
  it('называет код и позицию, у которой он есть, один раз — по приходу из чека', async () => {
    trip.mockResolvedValue(finished)
    window.history.replaceState(
      { recorded: 2, codesHeld: [{ code: '8600000000004', holder: 'Печенье' }] },
      '',
    )
    const view = await render()
    expect(view.text()).toContain('Код 8600000000004 уже у «Печенье»')
    expect(window.history.state).toMatchObject({ recorded: null, codesHeld: null })
  })

  it('без кодов в состоянии — ничего не говорит, и мусор в нём не роняет экран', async () => {
    trip.mockResolvedValue(finished)
    window.history.replaceState({ recorded: 1, codesHeld: 'garbage' }, '')
    const view = await render()
    expect(view.text()).not.toContain('уже у «')
  })
})

// Е-4 of MOL-207: a finished record is never «ещё не закончена», and what the screen knows of it is
// said in the header — the place, its city and its day — while the connection is one strip.
describe('FinishedTripView: шапка и состояния (MOL-207)', () => {
  const NOT_FINISHED = 'ещё не закончена'
  const at = new Date('2026-09-19T09:00:00.000Z')
  const subtitle = (view: VueWrapper) => view.find('.subtitle')

  it('загрузка без памяти — «Покупки» без строки под ним, скелетон строк и карточки итога', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockReturnValue(new Promise(() => undefined))
    const view = await render(null)
    expect(view.get('h1').text()).toBe(ru.trip.history.title)
    expect(subtitle(view).exists()).toBe(false)
    expect(view.find('.skeleton-rows').exists()).toBe(true)
    expect(view.find('.skeleton-figure').exists()).toBe(true)
    expect(view.text()).not.toContain(NOT_FINISHED)
  })

  it('ошибка без памяти — «Покупки», ни строки под ним, ни «ещё не закончена»; полосы нет', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'boom'))
    const view = await render(null)
    expect(view.get('h1').text()).toBe(ru.trip.history.title)
    expect(subtitle(view).exists()).toBe(false)
    expect(view.text()).toContain(ru.trip.history.error_title)
    expect(view.findAll('.strip')).toHaveLength(0)
    expect(view.text()).not.toContain(NOT_FINISHED)
  })

  it('офлайн с памятью — место, город и день в шапке, одна полоса без «Повторить»', async () => {
    trip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const view = await render()
    expect(view.get('h1').text()).toBe('Ереван Сити')
    expect(subtitle(view).text()).toBe(`Гюмри · ${dayOfAnyYear(at, 'ru')}, ${timeOfDay(at, 'ru')}`)
    const strips = view.findAll('.strip')
    expect(strips).toHaveLength(1)
    expect(strips[0]?.classes()).toContain('offline')
    expect(strips[0]?.text()).toContain(ru.trip.offline.strip)
    expect(view.text()).not.toContain(ru.state.retry)
    // «Показаны данные…» and the offline card were two more ways of the same word (Е-4).
    expect(view.text()).not.toContain('Показаны данные')
    expect(view.text()).not.toContain(ru.trip.history.offline_title)
    expect(view.text()).not.toContain(NOT_FINISHED)
  })

  it('сервер не ответил при памяти — полоса «Сервер не ответил» с одной «Повторить», и она читает снова', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'boom'))
    const view = await render()
    const strips = view.findAll('.strip')
    expect(strips).toHaveLength(1)
    expect(strips[0]?.classes()).toContain('unanswered')
    const retry = view.findAll('button').filter((button) => button.text() === ru.state.retry)
    expect(retry).toHaveLength(1)

    trip.mockResolvedValue(finished)
    await retry[0]?.trigger('click')
    await flushPromises()
    expect(view.findAll('.strip')).toHaveLength(0)
    expect(trip).toHaveBeenCalledTimes(2)
  })

  it('с ответом — одно крупное число: карточка итога под списком, в полосе внизу ничего', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(finished)
    const view = await render()
    expect(view.findAll('.sum')).toHaveLength(1)
    expect(view.findComponent({ name: 'TripTotalCard' }).exists()).toBe(true)
    expect(view.find('.dock').exists()).toBe(false)
    // Everything under the total, in this order (owner's В-2 «а»).
    const words = view.findAll('button').map((button) => button.text())
    const places = [ru.trip.receipt.edit, ru.trip.add_item, ru.trip.remove.action].map((word) =>
      words.findIndex((text) => text.includes(word)),
    )
    expect(places[0]).toBeGreaterThanOrEqual(0)
    expect(places[1]).toBeGreaterThan(places[0] ?? Infinity)
    expect(places[2]).toBeGreaterThan(places[1] ?? Infinity)
  })

  it('записанная из чека — «· из чека» после дня; без города — один день', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const fromReceipt = tripViewCodec.parse({
      ...tripViewCodec.encode(finished),
      placeCity: undefined,
      receiptId: 'cccccccc-0000-4000-8000-000000000001',
    })
    trip.mockResolvedValue(fromReceipt)
    const view = await render(null)
    expect(subtitle(view).text()).toBe(
      `${dayOfAnyYear(at, 'ru')}, ${timeOfDay(at, 'ru')} · ${ru.receipt.recorded.from_receipt}`,
    )
  })
})

describe('FinishedTripView: строка чека и удаление записи одной суммы (MOL-207, адверсариальное)', () => {
  const plainText = (view: VueWrapper) => view.text().replaceAll('\u00a0', ' ')
  const parts = (view: VueWrapper) =>
    view.findAll('.total .line .part').map((part) => part.text().replaceAll('\u00a0', ' '))
  const stale = (view: VueWrapper) =>
    view.findAll('.total .line .part.stale').map((part) => part.text().replaceAll('\u00a0', ' '))
  const removeButton = (view: VueWrapper) =>
    view.findAll('button').find((button) => button.text().includes(ru.trip.remove.action))
  const BREAD = row(null, 2).id

  /** A receipt with no items (MOL-227): the record is its sum alone. */
  const sumOnly = tripViewCodec.parse({
    ...tripViewCodec.encode(finished),
    receiptId: 'cccccccc-0000-4000-8000-000000000001',
    expenses: [],
    total: [{ amount: '5000', currency: 'AMD' }],
    receipt: { amount: '5000', currency: 'AMD' },
    prices: [],
    gap: null,
  })

  it('А1: хлеб без цены удаляется без связи — строка чека прежняя, приглушена; сумма чека стоит', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(finished)
    const view = await render(null)
    expect(parts(view)).toEqual(['по ценам 570 ֏ — 1 из 2', 'без цены — 830 ֏'])

    useTripQueueStore().enqueue({ kind: 'remove', tripId: TRIP, expenseId: BREAD })
    await flushPromises()

    expect(view.findAll('.row')[1]?.classes()).toContain('gone')
    expect(stale(view)).toEqual(['по ценам 570 ֏ — 1 из 2', 'без цены — 830 ֏'])
    expect(plainText(view)).toContain('1 400 ֏')
  })

  // Round 2, Б1: milk swapped for cheese keeps both counts — the list is judged by its rows.
  it('Б1: молоко заменено сыром без связи — счёт строк тот же, а строка чека приглушена', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(finished)
    const view = await render(null)
    const queue = useTripQueueStore()
    queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: row(null, 1).id })
    queue.enqueue({
      kind: 'add',
      tripId: TRIP,
      entry: {
        id: row(null, 9).item.id,
        kind: 'product',
        name: 'Сыр',
        note: null,
        defaultUnit: 'piece',
        typicalQuantity: null,
      },
      body: {
        id: row(null, 9).id,
        itemId: row(null, 9).item.id,
        amount: parseMoney('900', 'AMD'),
      },
    })
    await flushPromises()
    expect(view.findAll('.row')).toHaveLength(3)
    expect(stale(view)).toEqual(['по ценам 570 ֏ — 1 из 2', 'без цены — 830 ֏'])
    expect(plainText(view)).toContain('1 400 ֏')
  })

  // Round 2, Б2: read back from the shelf the total of a record whose purchases are being removed may
  // be its receipt — asked about, with no sum named, since the shelf cannot say which.
  it('Б2: с полки все покупки удаляются, итог остался — удаление спрашивает, суммы не называя', async () => {
    trip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const view = await render()
    const queue = useTripQueueStore()
    queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: row(null, 1).id })
    queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: BREAD })
    await flushPromises()
    await removeButton(view)?.trigger('click')
    await flushPromises()
    const sheet = view.findComponent({ name: 'TripRemoveSheet' })
    expect(sheet.props('open')).toBe(true)
    expect(sheet.props('receipt')).toBeNull()
    expect(queue.pending.some((write) => write.kind === 'delete')).toBe(false)
  })

  it('А2: запись одной суммы по чеку спрашивает перед удалением и называет сумму', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    trip.mockResolvedValue(sumOnly)
    const view = await render(null)
    await removeButton(view)?.trigger('click')
    await flushPromises()
    const sheet = view.findComponent({ name: 'TripRemoveSheet' })
    expect(sheet.props('open')).toBe(true)
    expect(String(sheet.props('receipt')).replaceAll('\u00a0', ' ')).toBe('5 000 ֏')
    expect(useTripQueueStore().pending).toEqual([])
  })

  it('А2: и с полки, где суммы чека нет, — итог записи без покупок и есть сумма', async () => {
    trip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const view = await render(sumOnly)
    await removeButton(view)?.trigger('click')
    await flushPromises()
    expect(view.findComponent({ name: 'TripRemoveSheet' }).props('open')).toBe(true)
    expect(useTripQueueStore().pending).toEqual([])
  })

  it('А2 (К): без суммы, все покупки уже в удалении — уходит сразу, без вопроса', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const priced = tripViewCodec.parse({
      ...tripViewCodec.encode(finished),
      expenses: [row({ amount: '570', currency: 'AMD' }, 1)],
      total: [{ amount: '570', currency: 'AMD' }],
      receipt: null,
      prices: [{ amount: '570', currency: 'AMD' }],
      gap: null,
    })
    trip.mockResolvedValue(priced)
    const view = await render(null)
    useTripQueueStore().enqueue({ kind: 'remove', tripId: TRIP, expenseId: row(null, 1).id })
    await flushPromises()
    await removeButton(view)?.trigger('click')
    await flushPromises()
    // Gone at once: the screen stepped back with no sheet, the removal is in the queue.
    const sheet = view.findComponent({ name: 'TripRemoveSheet' })
    expect(sheet.exists() && sheet.props('open')).toBe(false)
    expect(useTripQueueStore().pending.some((write) => write.kind === 'delete')).toBe(true)
  })
})
