import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { RouterView, createRouter, createWebHistory } from 'vue-router'
import { ERROR, currentTripResponseSchema, parseMoney, tripViewCodec } from '@molvia/model'
import type {
  AdviceResponse,
  PendingVerdicts,
  TripHistory,
  TripHistoryEntry,
  TripView as TripViewModel,
} from '@molvia/model'
import { ApiError } from '@molvia/client'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'

const tripHistory = vi.fn<() => Promise<TripHistory>>()
const pendingVerdicts = vi.fn<() => Promise<PendingVerdicts>>()
const currentTrip = vi.fn<() => Promise<TripViewModel | null>>()
const advice = vi.fn<() => Promise<AdviceResponse>>()
const addExpense = vi.fn<() => Promise<unknown>>()
vi.mock('@/api', () => ({
  api: {
    advice: () => advice(),
    tripHistory: () => tripHistory(),
    pendingVerdicts: () => pendingVerdicts(),
    currentTrip: () => currentTrip(),
    recentPlaces: () => Promise.resolve([]),
    startTrip: () => new Promise(() => undefined),
    finishTrip: () => new Promise(() => undefined),
    removeTrip: () => new Promise(() => undefined),
    addExpense: () => addExpense(),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const PLACE = 'aaaaaaaa-0000-4000-8000-000000000001'
const OPEN = 'bbbbbbbb-0000-4000-8000-0000000000aa'

function trip(n: number, name = 'Ереван Сити'): TripHistoryEntry {
  const finishedAt = new Date(Date.now() - n * 86_400_000)
  return {
    id: `bbbbbbbb-0000-4000-8000-00000000000${String(n)}`,
    place: { id: PLACE, kind: 'store', name },
    startedAt: new Date(finishedAt.getTime() - 3_600_000),
    finishedAt,
    finishedOnDeviceAt: null,
    itemCount: null,
    total: null,
  }
}

/** The record at «Рынок», with `bought` purchases in it. */
function openTrip(bought = 0): TripViewModel {
  return tripViewCodec.parse({
    id: OPEN,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currency: 'AMD',
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: { id: PLACE, kind: 'store', name: 'Рынок' },
    expenses: Array.from({ length: bought }, (_, n) => ({
      id: `eeeeeeee-0000-4000-8000-00000000000${String(n)}`,
      createdAt: new Date().toISOString(),
      item: {
        id: `dddddddd-0000-4000-8000-00000000000${String(n)}`,
        kind: 'product',
        name: `Товар ${String(n)}`,
        note: null,
        defaultUnit: 'piece',
        typicalQuantity: null,
      },
      quantity: null,
      amount: { amount: '500.00', currency: 'AMD' },
      unitPrice: null,
    })),
    total: bought > 0 ? [{ amount: `${String(bought * 500)}.00`, currency: 'AMD' }] : [],
    converted: null,
  })
}

// One moment for the whole file: two cards «bought yesterday» are bought at the same instant —
// read anew, the second was now and then a millisecond newer, and the order of places turned on CI
// (MOL-143 gave most tests one call; the one MOL-120 test it missed failed on MOL-171's CI).
const NOW = new Date()

function yesterday(): Date {
  const at = new Date(NOW)
  at.setDate(at.getDate() - 1)
  return at
}

const card = (n: number, placeName: string, boughtAt: Date, placeCity?: string) => ({
  itemId: `cccccccc-0000-4000-8000-00000000000${String(n)}`,
  name: `Товар ${String(n)}`,
  placeName,
  ...(placeCity === undefined ? {} : { placeCity }),
  boughtAt,
})

/** An answer held in flight until the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Пока шторка не поднялась, она не берёт нажатий: второй тап двойного не должен её закрыть. */
let clock = 0

const mounted: VueWrapper[] = []

/** The app as far as screens go: whichever the router is on. */
const App = defineComponent(() => () => h(RouterView))

async function render({
  before,
  path = '/purchases',
}: { before?: () => void; path?: string } = {}) {
  localStorage.setItem('molvia.actor', ME)
  localStorage.setItem(
    `molvia.settings.${ME}`,
    JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().state = 'ready'
  before?.()
  window.history.replaceState(null, '', '/')
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push(path)
  const view = mount(App, {
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router, queue: useTripQueueStore() }
}

/** A history the server answered on an earlier launch, as the phone keeps it. */
function remember(trips: TripHistoryEntry[] = []) {
  localStorage.setItem(
    `molvia.trip-history.${ME}`,
    JSON.stringify({
      page: {
        trips: trips.map((row) => ({
          id: row.id,
          place: row.place,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt.toISOString(),
          finishedOnDeviceAt: null,
        })),
        nextCursor: null,
      },
      selected: null,
      local: [],
    }),
  )
  if (trips.length === 0) localStorage.setItem(`molvia.trip-history-empty.${ME}`, '1')
}

const rows = (view: VueWrapper) => view.findAll('.recorded .purchase-row')
const openSheet = () => document.body.querySelector('dialog[open]')

function inside(sheet: Element | null, text: string): HTMLButtonElement {
  const found = [...(sheet?.querySelectorAll('button') ?? [])].find((node) =>
    node.textContent.includes(text),
  )
  if (!found) throw new Error(`нет кнопки «${text}» в шторке`)
  return found
}

describe('PurchasesView (MOL-128)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    tripHistory.mockReset()
    tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
    pendingVerdicts.mockReset()
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    currentTrip.mockReset()
    currentTrip.mockResolvedValue(null)
    addExpense.mockReset()
    addExpense.mockReturnValue(new Promise(() => undefined))
    advice.mockReset()
    advice.mockResolvedValue({
      geography: { country: 'AM', city: 'Гюмри' },
      scope: 'own',
      rows: [],
      total: 0,
    })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  describe('пусто — только когда это известно (MOL-77)', () => {
    it('сервер ответил: записей нет — «Здесь будут ваши покупки», без круга, кнопка внизу', async () => {
      const { view } = await render()
      expect(view.text()).toContain(ru.purchases.empty.title)
      expect(view.find('.circle').exists()).toBe(false)
      expect(view.get('.dock').text()).toContain(ru.purchases.manual)
    })

    it('до ответа — скелет, а не «пусто»; кнопка внизу уже есть', async () => {
      tripHistory.mockReturnValue(new Promise(() => undefined))
      const { view } = await render()
      expect(view.find('.skeleton').exists()).toBe(true)
      expect(view.text()).not.toContain(ru.purchases.empty.title)
      expect(view.get('.dock').text()).toContain(ru.purchases.manual)
    })

    it('ошибка без памяти — красное с одной «Повторить», «пусто» нет', async () => {
      tripHistory.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render()
      expect(view.text()).toContain(ru.purchases.error.title)
      expect(view.text()).not.toContain(ru.purchases.empty.title)
      const retries = view.findAll('button').filter((b) => b.text() === ru.state.retry)
      expect(retries).toHaveLength(1)

      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      await retries[0]?.trigger('click')
      await flushPromises()
      expect(view.text()).not.toContain(ru.purchases.error.title)
      expect(rows(view)).toHaveLength(1)
    })

    it('офлайн без памяти — не красное, без «Повторить» и не «пусто»', async () => {
      tripHistory.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const { view } = await render()
      expect(view.text()).toContain(ru.trip.history.offline_title)
      expect(view.find('.state.bad').exists()).toBe(false)
      expect(view.text()).not.toContain(ru.state.retry)
      expect(view.text()).not.toContain(ru.purchases.empty.title)
    })

    it('кэш, записанный одной правкой записи, — не ответ', async () => {
      tripHistory.mockReturnValue(new Promise(() => undefined))
      const { view } = await render({
        before: () => {
          localStorage.setItem(
            `molvia.trip-history.${ME}`,
            JSON.stringify({ page: { trips: [], nextCursor: null }, selected: null, local: [] }),
          )
        },
      })
      expect(view.text()).not.toContain(ru.purchases.empty.title)
    })

    it('вчерашний пустой ответ слабее сегодняшней ошибки (адверсариальное Г)', async () => {
      tripHistory.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render({
        before: () => {
          remember()
        },
      })
      expect(view.text()).toContain(ru.purchases.error.title)
      expect(view.text()).not.toContain(ru.purchases.empty.title)
    })

    it('покупки ждут оценки — значит, не пусто', async () => {
      tripHistory.mockReturnValue(new Promise(() => undefined))
      const day = yesterday()
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'Ереван Сити', day), card(2, 'Ереван Сити', day)],
        total: 2,
      })
      const { view } = await render({
        before: () => {
          remember()
        },
      })
      expect(view.text()).toContain('2 покупки ждут оценки')
      expect(view.text()).not.toContain(ru.purchases.empty.title)
    })
  })

  describe('«Записаны»', () => {
    it('место, число позиций, день и сумма — от сервера; тап открывает записанные покупки', async () => {
      const first = {
        ...trip(1),
        itemCount: 12,
        total: [parseMoney('9870', 'AMD'), parseMoney('12', 'USD')],
      }
      tripHistory.mockResolvedValue({ trips: [first, trip(2, 'SAS')], nextCursor: null })
      const { view, router } = await render()

      const [row, other] = rows(view)
      expect(row?.text()).toContain('Ереван Сити')
      expect(row?.text()).toContain('12 позиций · вчера')
      expect(row?.get('.sum').text().replaceAll('\u00a0', ' ')).toBe('9 870,00 ֏ · 12,00 $')
      // A row read back from the phone, or from an older server, says where and when, nothing more.
      expect(other?.find('.sum').exists()).toBe(false)
      expect(other?.text()).not.toContain('позиц')

      await row?.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('purchase')
      expect(router.currentRoute.value.params.tripId).toBe(first.id)
    })

    it('офлайн: запись, законченная на телефоне, — строка с пометкой', async () => {
      tripHistory.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const now = new Date()
      const { view, queue } = await render({
        before: () => {
          localStorage.setItem(
            `molvia.trip-history.${ME}`,
            JSON.stringify({
              page: { trips: [], nextCursor: null },
              selected: null,
              local: [
                {
                  id: 'bbbbbbbb-0000-4000-8000-000000000009',
                  name: 'SAS',
                  startedAt: now.toISOString(),
                  completedAt: now.toISOString(),
                  currency: 'AMD',
                  view: null,
                },
              ],
            }),
          )
        },
      })
      queue.enqueue({
        kind: 'finish',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000009',
        finishedOnDeviceAt: now,
      })
      await flushPromises()
      expect(rows(view)).toHaveLength(1)
      expect(rows(view)[0]?.text()).toContain(ru.trip.history.local_finish)
      expect(view.text()).not.toContain(ru.purchases.empty.title)
    })
  })

  describe('ответ, под которым сдвинулся список (адверсариальное А)', () => {
    // The pauses before asking again run on a fake clock: the whole ladder is checked, and no
    // test waits for real seconds (review Р-11). `flushPromises` goes through `setImmediate`.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const key = `molvia.trip-history.${ME}`
    /** Another window writes the history cache, as every answer to its purchases does. */
    const neighbourWrites = () => {
      localStorage.setItem(
        key,
        JSON.stringify({ page: { trips: [], nextCursor: null }, selected: null, local: [] }),
      )
      window.dispatchEvent(new StorageEvent('storage', { key }))
    }
    /** Lets every pause of the ladder run out: 400 + 800 + 1600 ms. */
    const pausesPass = async () => {
      await vi.advanceTimersByTimeAsync(3000)
      await flushPromises()
    }

    it('запись другого окна в полёте — ответ спрошен заново после паузы, а не вечный скелет', async () => {
      const first = deferred<TripHistory>()
      tripHistory.mockReturnValueOnce(first.promise)
      tripHistory.mockResolvedValue({ trips: [trip(1), trip(2)], nextCursor: null })
      const { view } = await render()

      neighbourWrites()
      first.resolve({ trips: [trip(1), trip(2)], nextCursor: null })
      await flushPromises()
      expect(tripHistory).toHaveBeenCalledTimes(1)

      await pausesPass()
      expect(tripHistory).toHaveBeenCalledTimes(2)
      expect(rows(view)).toHaveLength(2)
      expect(view.find('.skeleton').exists()).toBe(false)
    })

    it('завершение, взятое назад в полёте (forgetLocal), — тоже спрошено заново', async () => {
      const first = deferred<TripHistory>()
      tripHistory.mockReturnValueOnce(first.promise)
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      const { view } = await render()

      useTripHistoryStore().capture(
        'bbbbbbbb-0000-4000-8000-0000000000fe',
        'SAS',
        new Date(),
        new Date(),
        'AMD',
        null,
      )
      useTripHistoryStore().forgetLocal('bbbbbbbb-0000-4000-8000-0000000000fe')
      first.resolve({ trips: [trip(1)], nextCursor: null })
      await pausesPass()

      expect(rows(view)).toHaveLength(1)
    })

    it('список сдвигается под каждым ответом — в конце ошибка, никого не винящая', async () => {
      tripHistory.mockImplementation(() => {
        neighbourWrites()
        return Promise.resolve({ trips: [trip(1)], nextCursor: null })
      })
      const { view } = await render()
      await pausesPass()

      expect(tripHistory).toHaveBeenCalledTimes(4)
      expect(view.text()).toContain(ru.purchases.error.title)
      // The server answered every time: nothing on screen says it did not.
      expect(view.text()).not.toContain('Сервер не ответил')
    })

    it('экран снят во время паузы повтора — больше ничего не спрашивается', async () => {
      tripHistory.mockImplementation(() => {
        neighbourWrites()
        return Promise.resolve({ trips: [trip(1)], nextCursor: null })
      })
      const { view } = await render()
      expect(tripHistory).toHaveBeenCalledTimes(1)
      view.unmount()
      mounted.splice(mounted.indexOf(view), 1)

      await pausesPass()
      expect(tripHistory).toHaveBeenCalledTimes(1)
    })
  })

  describe('ждут оценки — прежние слова MOL-77 (П-9)', () => {
    it('нет покупок без оценки — карточки нет', async () => {
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      const { view } = await render()
      expect(view.find('.pending').exists()).toBe(false)
    })

    it('одно место: «Из «Ереван Сити», последняя — вчера», тап ведёт в «Оценки»', async () => {
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      const earlier = yesterday()
      earlier.setDate(earlier.getDate() - 3)
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'Ереван Сити', earlier), card(2, 'Ереван Сити', yesterday())],
        total: 2,
      })
      const { view, router } = await render()
      expect(view.get('.pending').text()).toContain('2 покупки ждут оценки')
      expect(view.get('.pending .meta').text()).toBe('Из «Ереван Сити», последняя — вчера')

      await view.get('.pending .purchase-row').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('verdicts')
    })

    it('неполная страница из одного места — место не называется за всех (В2)', async () => {
      pendingVerdicts.mockResolvedValue({
        items: Array.from({ length: 50 }, (_, i) => ({
          ...card(1, 'Ереван Сити', yesterday()),
          itemId: `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
        total: 60,
      })
      const { view } = await render()
      expect(view.text()).toContain('60 покупок ждут оценки')
      expect(view.find('.pending .meta').exists()).toBe(false)
    })

    it('два места — оба по имени, новое первым, без счёта (И2)', async () => {
      const earlier = yesterday()
      earlier.setHours(earlier.getHours() - 2)
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'Ереван Сити', earlier), card(2, 'SAS', yesterday())],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toBe('Из «SAS» и «Ереван Сити»')
    })

    it('одно имя в двух городах — два места, у обоих город (MOL-120)', async () => {
      const earlier = yesterday()
      earlier.setHours(earlier.getHours() - 2)
      pendingVerdicts.mockResolvedValue({
        items: [
          card(1, 'Ереван Сити', earlier, 'Ереван'),
          card(2, 'Ереван Сити', yesterday(), 'Гюмри'),
        ],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toBe(
        'Из «Ереван Сити» в Гюмри и «Ереван Сити» в Ереване',
      )
    })

    it('город — только у повторяющегося имени, повтор — по всей очереди (MOL-120)', async () => {
      const earlier = yesterday()
      earlier.setHours(earlier.getHours() - 2)
      pendingVerdicts.mockResolvedValue({
        items: [
          card(1, 'Ереван Сити', yesterday(), 'Гюмри'),
          card(2, 'SAS', yesterday(), 'Ереван'),
          card(3, 'Ереван Сити', earlier, 'Ереван'),
        ],
        total: 3,
      })
      const { view } = await render()
      // The third place is «and others», yet the first is still told from it by its city.
      expect(view.get('.pending .meta').text()).toBe(
        'Из «Ереван Сити» в Гюмри, «SAS» и других мест',
      )
    })

    it('одно имя в одном городе — одно место, без города (MOL-120)', async () => {
      const day = yesterday()
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'SAS', day, 'Ереван'), card(2, 'sas', day, 'ереван')],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toBe('Из «SAS», последняя — вчера')
    })

    it('город не из словаря — в скобках (MOL-120)', async () => {
      const day = yesterday()
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'SAS', day, 'Ванадзор'), card(2, 'SAS', day, 'Гюмри')],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toBe('Из «SAS» (Ванадзор) и «SAS» в Гюмри')
    })

    it('город настроек в другом написании — падеж по городу настроек (адверсариальный А2)', async () => {
      // A place keeps the spelling its city was first written in: «гюмри» is Gyumri.
      const day = yesterday()
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'SAS', day, 'гюмри'), card(2, 'SAS', day, 'Ереван')],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toBe('Из «SAS» в Гюмри и «SAS» в Ереване')
    })

    it('без городов два написания — два места, как до MOL-120 (адверсариальный А1)', async () => {
      // Two rows of `places` the phone cannot tell apart without their cities: the queue
      // remembered by the version before, or a card refused before the update among new ones.
      const day = yesterday()
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'Ереван Сити', day), card(2, 'ЕРЕВАН СИТИ', day)],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toBe('Из «Ереван Сити» и «ЕРЕВАН СИТИ»')
    })

    it('карточка без города — подпись по именам, как до MOL-120 (Р-6)', async () => {
      const day = yesterday()
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'Ереван Сити', day, 'Гюмри'), card(2, 'Ереван Сити', day)],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toBe('Из «Ереван Сити», последняя — вчера')
    })

    it('больше двух мест — «и других мест», без числа (И2)', async () => {
      pendingVerdicts.mockResolvedValue({
        items: [
          card(1, 'Ереван Сити', yesterday()),
          card(2, 'SAS', yesterday()),
          card(3, 'Рынок', yesterday()),
        ],
        total: 3,
      })
      const { view } = await render()
      expect(view.get('.pending .meta').text()).toMatch(/и других мест$/)
      expect(view.get('.pending .meta').text()).not.toMatch(/\d/)
    })
  })

  describe('открытая запись и «Записать покупки»', () => {
    it('открытая запись — первой строкой, с «Продолжить», и ведёт в неё', async () => {
      currentTrip.mockResolvedValue(openTrip())
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      const { view, router } = await render()

      const open = view.get('.open')
      expect(open.text()).toContain('Рынок')
      expect(open.text()).toContain('0 позиций · записываете вручную')
      expect(open.text()).toContain(ru.purchases.continue)
      // Before the recorded rows, whatever else is on the screen.
      expect(view.html().indexOf('class="block open"')).toBeLessThan(
        view.html().indexOf('recorded'),
      )

      await open.get('.purchase-row').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('purchase-manual')
    })

    it('запись, начатая на телефоне без связи, — тоже открытая', async () => {
      const { view, queue } = await render()
      queue.enqueue({
        kind: 'start',
        tripId: OPEN,
        place: { kind: 'store', name: 'Рынок' },
        startedAt: new Date(),
      })
      await flushPromises()
      expect(view.get('.open').text()).toContain('Рынок')
    })

    it('без открытой — «Где вы?», и после старта открывается сама запись', async () => {
      const { view, router, queue } = await render()
      await view.get('.dock button').trigger('click')
      await flushPromises()
      clock += 1000
      const sheet = openSheet()
      expect(sheet?.textContent).toContain(ru.trip.start.title)

      const field = sheet?.querySelector('input')
      if (!field) throw new Error('нет поля места')
      field.value = 'Рынок'
      field.dispatchEvent(new Event('input'))
      await flushPromises()
      inside(sheet, ru.trip.none.action).click()
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('purchase-manual')
      })
      await flushPromises()

      expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe('Рынок')
      expect(view.get('h1').text()).toBe('Рынок')
      // Up from the record is «Покупки», the step it came from.
      expect(router.options.history.state.back).toBe('/purchases')
    })

    it('есть открытая — спрашивает; «Продолжить» ведёт в неё и ничего не пишет', async () => {
      currentTrip.mockResolvedValue(openTrip())
      const { view, router, queue } = await render()
      await view.get('.dock button').trigger('click')
      await flushPromises()
      clock += 1000
      const sheet = openSheet()
      expect(sheet?.textContent).toContain('Уже записываете «Рынок»')

      inside(sheet, 'Продолжить «Рынок»').click()
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('purchase-manual')
      })
      expect(queue.pending).toEqual([])
    })

    it('«Закончить и начать новую» puts nothing away until the new one starts (Р-2)', async () => {
      currentTrip.mockResolvedValue(openTrip())
      const { view, queue } = await render()
      await view.get('.dock button').trigger('click')
      await flushPromises()
      clock += 1000

      inside(openSheet(), ru.purchases.manual_ask.finish).click()
      await vi.waitFor(() => {
        expect(openSheet()?.textContent).toContain(ru.trip.start.title)
      })
      // «Где вы?» may still be dismissed: the open record is as it was.
      expect(queue.pending).toEqual([])

      const sheet = openSheet()
      const field = sheet?.querySelector('input')
      if (!field) throw new Error('нет поля места')
      field.value = 'SAS'
      field.dispatchEvent(new Event('input'))
      await flushPromises()
      clock += 1000
      inside(sheet, ru.trip.none.action).click()
      await flushPromises()

      // Nothing in it, so removed with «Вернуть» rather than finished into a row of nothing —
      // and before the start, so the server meets one open record at a time.
      expect(queue.pending.map((write) => write.kind)).toEqual(['delete', 'start'])
    })

    it('«Где вы?» dismissed after «Закончить и начать новую» — the open record stays', async () => {
      currentTrip.mockResolvedValue(openTrip())
      const { view, queue } = await render()
      await view.get('.dock button').trigger('click')
      await flushPromises()
      clock += 1000
      inside(openSheet(), ru.purchases.manual_ask.finish).click()
      await vi.waitFor(() => {
        expect(openSheet()?.textContent).toContain(ru.trip.start.title)
      })
      clock += 1000

      openSheet()
        ?.querySelector<HTMLButtonElement>(`button[aria-label="${ru.sheet.close}"]`)
        ?.click()
      await vi.waitFor(() => {
        expect(openSheet()).toBeNull()
      })

      expect(queue.pending).toEqual([])
      expect(view.get('.open').text()).toContain('Рынок')
    })

    /** «Записать покупки» → «Закончить и начать новую» → «Где вы?» at `place`. */
    async function replaceWith(view: VueWrapper, place: string, asked?: () => void): Promise<void> {
      await view.get('.dock button').trigger('click')
      await flushPromises()
      clock += 1000
      expect(openSheet()?.textContent).toContain('Уже записываете «Рынок»')
      inside(openSheet(), ru.purchases.manual_ask.finish).click()
      await vi.waitFor(() => {
        expect(openSheet()?.textContent).toContain(ru.trip.start.title)
      })
      await flushPromises()
      asked?.()
      const sheet = openSheet()
      const field = sheet?.querySelector('input')
      if (!field) throw new Error('нет поля места')
      field.value = place
      field.dispatchEvent(new Event('input'))
      await flushPromises()
      clock += 1000
      inside(sheet, ru.trip.none.action).click()
      await flushPromises()
    }

    it('a record with purchases is finished, before the start (Р-25)', async () => {
      currentTrip.mockResolvedValue(openTrip(3))
      const { view, queue } = await render()
      await replaceWith(view, 'SAS')
      expect(queue.pending.map((write) => write.kind)).toEqual(['finish', 'start'])
    })

    // The phone saw the record empty; three purchases went in from another phone. «Что брать»
    // never asks for the record, so «empty» is asked of the server at the choice (Р-21).
    it('on «Что брать» a record remembered empty is asked for, and finished (Р-21)', async () => {
      currentTrip.mockResolvedValue(openTrip(3))
      const { view, queue } = await render({
        path: '/',
        before: () => {
          localStorage.setItem(
            `molvia.trip.${ME}`,
            JSON.stringify(currentTripResponseSchema.encode({ trip: openTrip() })),
          )
        },
      })
      expect(currentTrip).not.toHaveBeenCalled()
      await replaceWith(view, 'SAS', () => {
        expect(currentTrip).toHaveBeenCalledTimes(1)
      })
      expect(queue.pending.map((write) => write.kind)).toEqual(['finish', 'start'])
    })

    it('with no answer at the choice an empty record is finished, not removed (Р-21)', async () => {
      currentTrip.mockResolvedValueOnce(openTrip())
      currentTrip.mockRejectedValue(new TypeError('Failed to fetch'))
      const { view, queue } = await render()
      await replaceWith(view, 'SAS')
      expect(queue.pending.map((write) => write.kind)).toEqual(['finish', 'start'])
    })

    // Adversarial М: a purchase the server refused waits on «Покупки» to be put right; a record
    // removed as empty would take it along.
    it('a purchase the server refused keeps the record from being removed as empty', async () => {
      currentTrip.mockResolvedValue(openTrip())
      addExpense.mockRejectedValue(new ApiError(ERROR.INVALID_AMOUNT, undefined, true))
      const { view, queue } = await render()
      queue.enqueue({
        kind: 'add',
        tripId: OPEN,
        entry: null,
        body: {
          id: 'eeeeeeee-0000-4000-8000-000000000003',
          itemId: 'dddddddd-0000-4000-8000-000000000001',
          amount: parseMoney('600', 'AMD'),
        },
      })
      await queue.flush()
      await flushPromises()
      expect(queue.rejected).toHaveLength(1)

      await replaceWith(view, 'SAS')

      expect(queue.pending.map((write) => write.kind)).toEqual(['finish', 'start'])
      expect(queue.rejected).toHaveLength(1)
    })

    it('a record started here and not yet sent needs no answer to be removed', async () => {
      const { view, queue } = await render()
      queue.enqueue({
        kind: 'start',
        tripId: OPEN,
        place: { kind: 'store', name: 'Рынок' },
        startedAt: new Date(),
      })
      await flushPromises()
      currentTrip.mockClear()
      await replaceWith(view, 'SAS', () => {
        expect(currentTrip).not.toHaveBeenCalled()
      })
      expect(queue.pending.map((write) => write.kind)).toEqual(['delete', 'start'])
    })
  })

  it('без открытой записи очередь говорит своё и здесь: неотправленное не молчит (В1)', async () => {
    const { view, queue } = await render()
    queue.enqueue({
      kind: 'add',
      tripId: 'bbbbbbbb-0000-4000-8000-000000000077',
      entry: null,
      body: {
        id: 'eeeeeeee-0000-4000-8000-000000000077',
        itemId: 'dddddddd-0000-4000-8000-000000000001',
        amount: parseMoney('600', 'AMD'),
      },
    })
    await flushPromises()
    expect(view.text()).toContain('1 покупка ещё не отправлена')
  })
})
