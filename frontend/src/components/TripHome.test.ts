import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { PendingVerdicts, TripHistory, TripHistoryEntry } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useTripHistoryStore } from '@/stores/tripHistory'
import TripHome from '@/components/TripHome.vue'

const tripHistory = vi.fn<() => Promise<TripHistory>>()
const pendingVerdicts = vi.fn<() => Promise<PendingVerdicts>>()
vi.mock('@/api', () => ({
  api: {
    tripHistory: () => tripHistory(),
    pendingVerdicts: () => pendingVerdicts(),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const PLACE = 'aaaaaaaa-0000-4000-8000-000000000001'

function trip(n: number, name = 'Ереван Сити', finishedOnDeviceAt: Date | null = null) {
  const finishedAt = new Date(Date.now() - n * 86_400_000)
  return {
    id: `bbbbbbbb-0000-4000-8000-00000000000${String(n)}`,
    place: { id: PLACE, kind: 'store' as const, name },
    startedAt: new Date(finishedAt.getTime() - 3_600_000),
    finishedAt,
    finishedOnDeviceAt,
  } satisfies TripHistoryEntry
}

function yesterday(): Date {
  const at = new Date()
  at.setDate(at.getDate() - 1)
  return at
}

const card = (n: number, placeName: string, boughtAt: Date) => ({
  itemId: `cccccccc-0000-4000-8000-00000000000${String(n)}`,
  name: `Товар ${String(n)}`,
  placeName,
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

const mounted: VueWrapper[] = []

async function render({
  offline = false,
  before,
}: { offline?: boolean; before?: () => void } = {}) {
  localStorage.setItem('molvia.actor', ME)
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().state = 'ready'
  before?.()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const view = mount(TripHome, {
    props: { offline },
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router }
}

/** A history the server answered on an earlier launch, as the phone keeps it. */
function remember(trips: TripHistoryEntry[] = [], local: unknown[] = []) {
  localStorage.setItem(
    `molvia.trip-history.${ME}`,
    JSON.stringify({
      page: {
        trips: trips.map((row) => ({
          ...row,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt.toISOString(),
          finishedOnDeviceAt: row.finishedOnDeviceAt?.toISOString() ?? null,
        })),
        nextCursor: null,
      },
      selected: null,
      local,
    }),
  )
  if (trips.length === 0) localStorage.setItem(`molvia.trip-history-empty.${ME}`, '1')
}

describe('TripHome', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    tripHistory.mockReset()
    tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
    pendingVerdicts.mockReset()
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  describe('новый человек', () => {
    it('вступление и цикл из четырёх шагов, когда сервер ответил: походов нет', async () => {
      const { view } = await render()
      expect(view.get('h2').text()).toBe(ru.trip.home.intro.title)
      expect(view.text()).toContain(ru.trip.home.intro.body)
      expect(view.findAll('ol > li')).toHaveLength(4)
      expect(view.text()).not.toContain(ru.trip.home.recent.caption)
    })

    it('шаги 1 и 2 — не кнопки; 3 и 4 — кнопки, и ведут сменой таба', async () => {
      const { view, router } = await render()
      const steps = view.findAll('ol > li')
      expect(steps[0]?.find('button').exists()).toBe(false)
      expect(steps[1]?.find('button').exists()).toBe(false)
      expect(steps[0]?.find('.chevron').exists()).toBe(false)

      await steps[2]?.get('button').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('verdicts')
    })

    it('«Что брать» — четвёртый шаг', async () => {
      const { view, router } = await render()
      await view.findAll('ol > li')[3]?.get('button').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('advice')
    })

    it('ответ, запомненный на прошлом запуске, знает, что походов нет, и без сети', async () => {
      tripHistory.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const { view } = await render({
        before: () => {
          remember()
        },
      })
      expect(view.text()).toContain(ru.trip.home.intro.title)
    })
  })

  describe('не новый человек, пока это не известно (главный запрет брифа)', () => {
    it('до ответа — скелетон, а не вступление', async () => {
      tripHistory.mockReturnValue(new Promise(() => undefined))
      const { view } = await render()
      expect(view.find('.skeleton').exists()).toBe(true)
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
    })

    it('ошибка без памяти — тихая карточка с «Повторить», вступления нет', async () => {
      tripHistory.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render()
      expect(view.text()).toContain(ru.trip.home.error.title)
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
      // Не красный блок: его «Повторить» спорил бы с «Начать поход».
      expect(view.find('.state').exists()).toBe(false)

      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      await view.get('.retry').trigger('click')
      await flushPromises()
      expect(view.text()).not.toContain(ru.trip.home.error.title)
      expect(view.findAll('.history-row')).toHaveLength(1)
    })

    it('офлайн без памяти — «появятся со связью», зелёное уведомление и без «Повторить»', async () => {
      tripHistory.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const { view } = await render({ offline: true })
      expect(view.text()).toContain(ru.trip.home.no_memory.title)
      expect(view.text()).toContain(ru.trip.home.offline.body_no_memory)
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
      expect(view.get('.state').classes()).toContain('good')
      expect(view.text()).not.toContain(ru.state.retry)
    })

    it('кэш, записанный одной правкой похода, — не ответ', async () => {
      tripHistory.mockReturnValue(new Promise(() => undefined))
      const { view } = await render({
        before: () => {
          localStorage.setItem(
            `molvia.trip-history.${ME}`,
            JSON.stringify({ page: { trips: [], nextCursor: null }, selected: null, local: [] }),
          )
        },
      })
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
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
      // Not at once: the first pause is still running.
      expect(tripHistory).toHaveBeenCalledTimes(1)

      await pausesPass()
      expect(tripHistory).toHaveBeenCalledTimes(2)
      expect(view.findAll('.history-row')).toHaveLength(2)
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

      expect(view.findAll('.history-row')).toHaveLength(1)
    })

    // Another window sends its queue one purchase at a time once the connection is back: every
    // answer of the first two lands on a list it has just written. The pause lets it finish, and
    // the third answer is taken (round 2, Ж2).
    it('поток записей соседнего окна — пауза перед повтором, и ответ принят', async () => {
      tripHistory.mockImplementation(() => {
        if (tripHistory.mock.calls.length <= 2) neighbourWrites()
        return Promise.resolve({ trips: [trip(1), trip(2)], nextCursor: null })
      })
      const { view } = await render()
      await pausesPass()

      expect(tripHistory).toHaveBeenCalledTimes(3)
      expect(view.findAll('.history-row')).toHaveLength(2)
      expect(view.text()).not.toContain(ru.trip.home.error.title)
    })

    it('список сдвигается под каждым ответом — в конце тихая ошибка, никого не винящая', async () => {
      tripHistory.mockImplementation(() => {
        neighbourWrites()
        return Promise.resolve({ trips: [trip(1)], nextCursor: null })
      })
      const { view } = await render()
      await pausesPass()

      expect(tripHistory).toHaveBeenCalledTimes(4)
      expect(view.text()).toContain(ru.trip.home.error.title)
      expect(view.find('.skeleton').exists()).toBe(false)
      // The server answered every time: nothing on screen says it did not.
      expect(view.text()).not.toContain('Сервер не ответил')
    })

    // A retry asleep in its pause when the screen goes — «Начать поход», a tab — must not wake
    // and ask again for nobody (round 3, И1).
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

  describe('вчерашний пустой ответ не сильнее сегодняшнего (адверсариальное Г)', () => {
    it('сервер отвечает ошибкой — видна ошибка с «Повторить», а не вступление', async () => {
      tripHistory.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render({
        before: () => {
          remember()
        },
      })
      expect(view.text()).toContain(ru.trip.home.error.title)
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
      expect(view.find('.retry').exists()).toBe(true)
    })

    it('покупки ждут оценки — значит, не новичок: карточка есть, вступления нет', async () => {
      tripHistory.mockReturnValue(new Promise(() => undefined))
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'Ереван Сити', yesterday()), card(2, 'Ереван Сити', yesterday())],
        total: 2,
      })
      const { view } = await render({
        before: () => {
          remember()
        },
      })
      expect(view.text()).toContain('2 покупки ждут оценки')
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
    })
  })

  describe('человек с историей', () => {
    it.each([
      [1, 1],
      [3, 3],
      [4, 3],
    ])('%i похода — %i строки и «Вся история»', async (count, shown) => {
      tripHistory.mockResolvedValue({
        trips: Array.from({ length: count }, (_, i) => trip(i + 1)),
        nextCursor: null,
      })
      const { view } = await render()
      expect(view.findAll('.history-row')).toHaveLength(shown)
      expect(view.text()).toContain(ru.trip.home.recent.all)
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
    })

    it('тап по строке открывает поход, «Вся история» — историю', async () => {
      const first = trip(1)
      tripHistory.mockResolvedValue({ trips: [first], nextCursor: null })
      const { view, router } = await render()
      await view.get('.history-row').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('finished-trip')
      expect(router.currentRoute.value.params.tripId).toBe(first.id)

      await router.push('/')
      await view.get('.all').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('trip-history')
    })

    it('строка без времени устройства берёт серверное', async () => {
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      const { view } = await render()
      expect(view.get('.history-row').text()).toContain('Завершён · вчера')
    })

    it('офлайн: поход, завершённый на телефоне, — это история, с пометкой', async () => {
      tripHistory.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const now = new Date()
      const { view } = await render({
        offline: true,
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
      expect(view.findAll('.history-row')).toHaveLength(1)
      expect(view.text()).toContain('SAS')
      expect(view.text()).toContain(ru.trip.home.offline.body)
      expect(view.text()).not.toContain(ru.trip.home.intro.title)
    })
  })

  describe('ждут оценки', () => {
    it('нет покупок без оценки — карточки нет', async () => {
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      const { view } = await render()
      expect(view.text()).not.toContain('ждут оценки')
      expect(view.text()).not.toContain('ждёт оценки')
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
      expect(view.text()).toContain('2 покупки ждут оценки')
      expect(view.get('.pending .sub').text()).toBe('Из «Ереван Сити», последняя — вчера')

      await view.get('.pending button').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('verdicts')
    })

    // Покупка без связи уходит с очередью через часы: по времени один поход читался двумя
    // (раунд 2, З1). Место — точное, поэтому подпись о местах, а не о походах.
    it('одно место, покупки получены сервером с разрывом в часы — всё ещё одно место (З1, В1)', async () => {
      const first = new Date(Date.now() - 8 * 3_600_000)
      const rest = new Date(Date.now() - 60_000)
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      pendingVerdicts.mockResolvedValue({
        items: [
          card(1, 'Ереван Сити', first),
          card(2, 'Ереван Сити', rest),
          card(3, 'Ереван Сити', rest),
        ],
        total: 3,
      })
      const { view } = await render()
      expect(view.get('.pending .sub').text()).toMatch(/^Из «Ереван Сити»/)
    })

    it('неполная страница из одного места — место не называется за всех (В2)', async () => {
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      pendingVerdicts.mockResolvedValue({
        items: Array.from({ length: 50 }, (_, i) => ({
          ...card(1, 'Ереван Сити', yesterday()),
          itemId: `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
        total: 60,
      })
      const { view } = await render()
      expect(view.text()).toContain('60 покупок ждут оценки')
      expect(view.find('.pending .sub').exists()).toBe(false)
    })

    it('два места — оба по имени, новое первым, без счёта (И2)', async () => {
      const earlier = yesterday()
      earlier.setHours(earlier.getHours() - 2)
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      pendingVerdicts.mockResolvedValue({
        items: [card(1, 'Ереван Сити', earlier), card(2, 'SAS', yesterday())],
        total: 2,
      })
      const { view } = await render()
      expect(view.get('.pending .sub').text()).toBe('Из «SAS» и «Ереван Сити»')
    })

    it('неполная страница из двух мест — подписи нет: есть ли другие, телефон не знает (Л2)', async () => {
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      pendingVerdicts.mockResolvedValue({
        items: Array.from({ length: 50 }, (_, i) => ({
          ...card(1, i % 2 === 0 ? 'SAS' : 'Ереван Сити', yesterday()),
          itemId: `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
        total: 60,
      })
      const { view } = await render()
      expect(view.text()).toContain('60 покупок ждут оценки')
      expect(view.find('.pending .sub').exists()).toBe(false)
    })

    it('больше двух мест — «и других мест», без числа (И2)', async () => {
      tripHistory.mockResolvedValue({ trips: [trip(1)], nextCursor: null })
      pendingVerdicts.mockResolvedValue({
        items: [
          card(1, 'Ереван Сити', yesterday()),
          card(2, 'SAS', yesterday()),
          card(3, 'Рынок', yesterday()),
        ],
        total: 3,
      })
      const { view } = await render()
      expect(view.get('.pending .sub').text()).toMatch(/и других мест$/)
      expect(view.get('.pending .sub').text()).not.toMatch(/\d/)
    })
  })
})
