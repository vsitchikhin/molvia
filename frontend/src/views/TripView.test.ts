import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, parseMoney, parseQuantity, tripViewCodec } from '@molvia/model'
import type { CatalogueEntry, TripView as TripViewModel, WireCode } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import TripView from '@/views/TripView.vue'

const currentTrip = vi.fn<() => Promise<TripViewModel | null>>()
const recentPlaces = vi.fn<() => Promise<{ id: string; kind: 'store'; name: string }[]>>()
const startTrip = vi.fn()
const addExpense = vi.fn()
vi.mock('@/api', () => ({
  api: {
    currentTrip: () => currentTrip(),
    recentPlaces: () => recentPlaces(),
    addExpense: (...args: unknown[]) => addExpense(...args),
    updateExpense: () => new Promise(() => undefined),
    removeExpense: () => new Promise(() => undefined),
    startTrip: (...args: unknown[]) => startTrip(...args),
    finishTrip: () => new Promise(() => undefined),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'
const ASHKHAR = 'aa000000-0000-4000-8000-000000000001'
const MARIANNA = 'aa000000-0000-4000-8000-000000000002'
const BREAD = 'aa000000-0000-4000-8000-000000000003'

const milk: CatalogueEntry = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  kind: 'product',
  name: 'Молоко «Ашхар»',
  note: null,
  defaultUnit: 'l',
  typicalQuantity: parseQuantity('1', 'l'),
}

interface Row {
  readonly id: string
  readonly name: string
  readonly value?: string
  readonly quantity?: [string, 'kg' | 'l' | 'piece']
  readonly unitPrice?: string
}

function trip(rows: readonly Row[] = [], over: Partial<Record<'id', string>> = {}): TripViewModel {
  return tripViewCodec.parse({
    id: over.id ?? TRIP,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currency: 'AMD',
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'store',
      name: 'Ереван Сити',
      country: 'AM',
      city: 'Гюмри',
    },
    expenses: rows.map((row) => ({
      id: row.id,
      createdAt: new Date().toISOString(),
      item: {
        id: `dddddddd-0000-4000-8000-0000000000${row.id.slice(-2)}`,
        kind: 'product',
        name: row.name,
        note: null,
        defaultUnit: row.quantity?.[1] ?? 'piece',
        typicalQuantity: null,
      },
      quantity: row.quantity ? { value: row.quantity[0], unit: row.quantity[1] } : null,
      amount: row.value ? { amount: row.value, currency: 'AMD' } : null,
      unitPrice: row.unitPrice
        ? { amount: row.unitPrice, currency: 'AMD', unit: row.quantity?.[1] ?? 'piece' }
        : null,
    })),
    total: [],
    converted: null,
  })
}

/** The handoff's own fixture: 520 ֏ for 0,9 l is dearer than 570 ֏ for a litre. */
const handoff = (): Row[] => [
  {
    id: ASHKHAR,
    name: 'Молоко «Ашхар»',
    value: '570',
    quantity: ['1', 'l'],
    unitPrice: '570',
  },
  {
    id: MARIANNA,
    name: 'Молоко «Марианна»',
    value: '520',
    quantity: ['0.9', 'l'],
    unitPrice: '577.777778',
  },
]

/** Прочитанное с экрана: деньги печатаются с неразрывным пробелом, тесты — обычным. */
const plain = (value: string | null | undefined): string => (value ?? '').replaceAll('\u00a0', ' ')

/** Кнопка в поднятой шторке: закрытые `<dialog>` висят в дереве и не в счёт. */
function inside(sheet: Element | null, text: string): HTMLButtonElement {
  const found = [...(sheet?.querySelectorAll('button') ?? [])].find((node) =>
    node.textContent.includes(text),
  )
  if (!found) throw new Error(`нет кнопки «${text}» в шторке`)
  return found
}

function button(view: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`нет кнопки «${text}»`)
  return found
}

/** Пока шторка не поднялась, она не берёт нажатий: второй тап двойного не должен её закрыть. */
let clock = 0

const queued = (id: string, price = '600') =>
  ({
    kind: 'add' as const,
    tripId: TRIP,
    entry: milk,
    body: {
      id,
      itemId: milk.id,
      quantity: parseQuantity('2', 'l'),
      amount: parseMoney(price, 'AMD'),
    },
  }) as const

const mounted: VueWrapper[] = []

async function render({ memory = null as TripViewModel | null, settings = true } = {}) {
  localStorage.setItem('molvia.actor', ME)
  if (settings)
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
    )
  const pinia = createPinia()
  setActivePinia(pinia)
  const trips = useTripStore()
  const queue = useTripQueueStore()
  if (memory) trips.apply(memory)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const view = mount(TripView, {
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router, trips, queue }
}

describe('TripView', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    currentTrip.mockReset()
    currentTrip.mockResolvedValue(null)
    recentPlaces.mockReset()
    recentPlaces.mockResolvedValue([])
    startTrip.mockReset()
    startTrip.mockReturnValue(new Promise(() => undefined))
    addExpense.mockReset()
    addExpense.mockReturnValue(new Promise(() => undefined))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('без похода предлагает начать, а не показывает пустой список', async () => {
    const { view } = await render()
    expect(view.text()).toContain(ru.trip.none.title)
    expect(button(view, ru.trip.none.action).exists()).toBe(true)
  })

  it('поход без позиций зовёт добавить первую', async () => {
    currentTrip.mockResolvedValue(trip())
    const { view } = await render()
    expect(view.text()).toContain(ru.trip.empty.title)
    expect(button(view, ru.trip.empty.action).exists()).toBe(true)
  })

  it('пока сервера не спросили и памяти нет — скелетон, а не «Новый поход»', async () => {
    currentTrip.mockReturnValue(new Promise(() => undefined))
    localStorage.setItem('molvia.actor', ME)
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
    )
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const view = mount(TripView, {
      global: { plugins: [router, pinia, createAppI18n('ru')] },
      attachTo: document.body,
    })
    mounted.push(view)

    expect(view.findAll('.bar')).not.toHaveLength(0)
    expect(view.text()).not.toContain(ru.trip.none.title)
  })

  it('весь смысл продукта в двух числах: 520 ֏ за 0,9 л дороже 570 ֏ за литр', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()

    const rows = view.findAll('.row')
    expect(rows).toHaveLength(2)
    expect(plain(rows[0]?.text())).toContain('570,00 ֏ за л')
    // Дешевле на ценнике и дороже за литр — ради этой строки экран и существует.
    expect(plain(rows[1]?.text())).toContain('520,00 ֏')
    expect(plain(rows[1]?.text())).toContain('577,78 ֏ за л')
  })

  it('строка без цены зовёт её дописать', async () => {
    currentTrip.mockResolvedValue(trip([{ id: BREAD, name: 'Хлеб «Матнакаш»' }]))
    const { view } = await render()
    expect(view.get('.row').text()).toContain(ru.trip.add_price)
  })

  it('место и день в строке над заголовком', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()
    expect(view.text()).toContain('Ереван Сити · сегодня')
  })

  it('тап по строке открывает шторку той же позиции', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()
    await view.findAll('.row')[1]?.trigger('click')
    await flushPromises()

    const sheet = document.body.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain('Молоко «Марианна»')
    expect(sheet?.textContent).toContain(ru.item.save_edit)
  })

  describe('очередь на экране', () => {
    it('правка ещё не ушедшей покупки заменяет её, а не добавляет вторую', async () => {
      currentTrip.mockResolvedValue(trip())
      const { view, queue } = await render()
      const purchase = 'eeeeeeee-0000-4000-8000-000000000005'
      queue.enqueue(queued(purchase, '600'))
      await flushPromises()

      await view.get('.row').trigger('click')
      await flushPromises()
      clock += 1000

      // Шторка открыта той же покупкой: те же числа и та же кнопка, что при добавлении.
      const sheet = document.body.querySelector('dialog[open]')
      expect(sheet?.querySelector<HTMLInputElement>('[data-field="amount"]')?.value).toBe('600')
      const field = sheet?.querySelector<HTMLInputElement>('[data-field="amount"]')
      if (!field) throw new Error('нет поля цены')
      field.value = '750'
      field.dispatchEvent(new Event('input'))
      await flushPromises()
      inside(sheet, ru.item.save).click()
      await flushPromises()

      const added = queue.pending.filter((write) => write.kind === 'add')
      expect(added).toHaveLength(1)
      expect(added[0]?.body.id).toBe(purchase)
      expect(added[0]?.body.amount?.minor).toBe(75_000n)
    })

    it('«ещё не ушло» — строка с ценой за единицу, посчитанной на телефоне', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000001'))
      await flushPromises()

      const rows = view.findAll('.row')
      expect(rows).toHaveLength(3)
      const last = rows[2]
      expect(last?.text()).toContain(ru.trip.queued.waiting)
      expect(plain(last?.text())).toContain('300,00 ֏ за л')
    })

    it('правка и удаление помечают серверную строку, а не заводят новую', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      queue.enqueue({
        kind: 'update',
        tripId: TRIP,
        expenseId: ASHKHAR,
        patch: { amount: parseMoney('580', 'AMD') },
      })
      queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: MARIANNA })
      await flushPromises()

      const rows = view.findAll('.row')
      expect(rows).toHaveLength(2)
      expect(rows[0]?.text()).toContain(ru.trip.queued.editing)
      expect(rows[1]?.text()).toContain(ru.trip.queued.removing)
    })

    it('строку, которая удаляется, не открыть: правка ушла бы следом за удалением', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: ASHKHAR })
      await flushPromises()

      const row = view.findAll('.row')[0]
      expect(row?.element.tagName).toBe('DIV')
      await row?.trigger('click')
      await flushPromises()
      expect(document.body.querySelector('dialog[open]')).toBeNull()
    })

    it('покупка, чей ответ потерялся, показана один раз, а не дважды', async () => {
      // Связь оборвалась после записи, но до ответа: очередь держит запись, а сервер строку уже
      // отдал (адверсариальная В2-2).
      currentTrip.mockResolvedValue(
        trip([{ id: ASHKHAR, name: 'Молоко «Ашхар»', value: '570', quantity: ['1', 'l'] }]),
      )
      const { view, queue } = await render()
      queue.enqueue({ ...queued(ASHKHAR), body: { ...queued(ASHKHAR).body, id: ASHKHAR } })
      await flushPromises()

      expect(view.findAll('.row')).toHaveLength(1)
      expect(view.get('.row').text()).not.toContain(ru.trip.queued.waiting)
    })

    it('ждущую покупку можно убрать прямо из шторки', async () => {
      currentTrip.mockResolvedValue(trip())
      const { view, queue } = await render()
      const purchase = 'eeeeeeee-0000-4000-8000-000000000007'
      queue.enqueue(queued(purchase))
      await flushPromises()

      await view.get('.row').trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.item.delete).click()
      await flushPromises()

      expect(queue.pending.filter((write) => write.kind === 'add')).toEqual([])
      // Строки списка — те, что в карточке: у шторки свой `.row` для количества и единицы.
      expect(view.findAll('.card .row')).toHaveLength(0)
      expect(view.text()).toContain(ru.trip.empty.title)
    })

    it('правка, ушедшая правкой, помечает строку — иначе она невидима (Т-12)', async () => {
      currentTrip.mockResolvedValue(
        trip([{ id: ASHKHAR, name: 'Молоко «Ашхар»', value: '570', quantity: ['1', 'l'] }]),
      )
      const { view, queue } = await render()
      queue.enqueue({
        ...queued(ASHKHAR, '750'),
        body: { ...queued(ASHKHAR, '750').body, id: ASHKHAR },
      })
      await flushPromises()

      const rows = view.findAll('.card .row')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.text()).toContain(ru.trip.queued.editing)
    })

    it('строка, чья запись уже ушла, не открывает пустую покупку (Т-10)', async () => {
      currentTrip.mockResolvedValue(trip())
      const { view, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000011'))
      await flushPromises()
      const row = view.get('.card .row')

      // Запись ушла ровно между отрисовкой и тапом.
      queue.dropPurchase(TRIP, 'eeeeeeee-0000-4000-8000-000000000011')
      await row.trigger('click')
      await flushPromises()

      expect(document.body.querySelector('dialog[open]')).toBeNull()
    })

    it('записи чужого похода в список не попадают', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      queue.enqueue({
        ...queued('eeeeeeee-0000-4000-8000-000000000002'),
        tripId: 'bbbbbbbb-0000-4000-8000-000000000009',
      })
      await flushPromises()

      expect(view.findAll('.row')).toHaveLength(2)
    })
  })

  describe('после «Завершить» и в чужом магазине (адверсариальные В1, Б1)', () => {
    it('неотправленные покупки не исчезают вместе с завершённым походом', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      addExpense.mockReturnValue(new Promise(() => undefined))
      const { view, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000009'))
      await flushPromises()

      await button(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.ok).click()
      await flushPromises()

      expect(view.text()).toContain(ru.trip.none.title)
      // На iOS фонового обмена нет: молчание здесь — это покупка, о которой никто не узнает.
      expect(view.text()).toContain('1 покупка ещё не отправлена')
    })

    it('и не замолкает, стоит начать следующий поход (Т-11)', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      addExpense.mockReturnValue(new Promise(() => undefined))
      const { view, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000012'))
      await flushPromises()

      await button(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.ok).click()
      await flushPromises()

      queue.enqueue({
        kind: 'start',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000021',
        place: { kind: 'store', name: 'Рынок' },
        startedAt: new Date(),
      })
      await flushPromises()

      expect(view.text()).toContain('Рынок')
      expect(view.text()).toContain('1 покупка ещё не отправлена')
    })

    it('поход открыт в другом магазине — экран называет оба и предлагает выбор', async () => {
      currentTrip.mockResolvedValue(null)
      const { view, queue } = await render()
      queue.elsewhere = { tripId: TRIP, place: 'SAS', mine: 'Ереван Сити' }
      await flushPromises()

      expect(view.text()).toContain('Уже открыт поход в «SAS»')
      expect(button(view, ru.trip.elsewhere.join).exists()).toBe(true)
      await button(view, ru.trip.elsewhere.finish).trigger('click')
      expect(queue.elsewhere).toBeNull()
    })
  })

  describe('старый старт без контекста (MOL-65)', () => {
    const LEGACY = 'bbbbbbbb-0000-4000-8000-000000000031'
    const legacy = () => ({
      kind: 'start' as const,
      tripId: LEGACY,
      place: { kind: 'store' as const, name: 'Рынок' },
      startedAt: new Date('2026-09-19T08:00:00.000Z'),
    })

    /** Сервер отвечает «назовите город и валюты», очередь встаёт и ждёт человека. */
    async function held(settings = true) {
      startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_CONTEXT_REQUIRED, undefined, true))
      const rendered = await render({ settings })
      rendered.queue.enqueue(legacy())
      await flushPromises()
      return rendered
    }

    it('экран зовёт уточнить, а шторка отправляет поход с настройками телефона', async () => {
      const { view, queue } = await held()
      expect(view.text()).toContain(ru.settings.legacy.title)
      expect(queue.needsContext).toBe(LEGACY)

      clock += 1000
      await button(view, ru.settings.legacy.action).trigger('click')
      await flushPromises()
      clock += 1000
      startTrip.mockReturnValue(new Promise(() => undefined))
      inside(document.body.querySelector('dialog[open]'), ru.settings.legacy.confirm).click()
      await flushPromises()

      expect(queue.needsContext).toBeNull()
      expect(queue.pending.find((write) => write.kind === 'start')?.context).toEqual({
        country: 'AM',
        city: 'Гюмри',
        spendCurrency: 'AMD',
        incomeCurrency: 'RUB',
      })
      // Одна запись, а не вторая рядом: уточнение заменяет старт на месте.
      expect(queue.pending.filter((write) => write.kind === 'start')).toHaveLength(1)
    })

    it('Ж2: второе открытие показывает нынешний город, а не город первого', async () => {
      // Город вне списка виден в шторке, потому что человек мог покупать именно там. Но стоит
      // настройкам переехать — предлагать его дальше значит предлагать единственный город,
      // который сервер откажется принять.
      const { view } = await held()
      const whereAt = (city: string, country: string, day: string) => ({
        id: ME,
        country,
        city,
        spendCurrency: 'AMD' as const,
        incomeCurrency: 'RUB' as const,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date(day),
      })
      useActorStore().apply(whereAt('Тбилиси', 'GE', '2026-09-22T00:00:00.000Z'))
      await flushPromises()
      clock += 1000
      await button(view, ru.settings.legacy.action).trigger('click')
      await flushPromises()
      expect(document.body.querySelector('dialog[open]')?.textContent).toContain('Тбилиси')

      // Шторка закрыта, настройки переехали, шторка открыта снова.
      await view.findComponent({ name: 'TripContextSheet' }).vm.$emit('update:open', false)
      await flushPromises()
      useActorStore().apply(whereAt('Гюмри', 'AM', '2026-09-23T00:00:00.000Z'))
      await flushPromises()
      clock += 1000
      await button(view, ru.settings.legacy.action).trigger('click')
      await flushPromises()
      const sheet = document.body.querySelector('dialog[open]')
      expect(sheet?.textContent).not.toContain('Тбилиси')
      expect(sheet?.textContent).toContain('Гюмри')
    })

    it('без подтверждённых настроек шторка не отправляет ничего', async () => {
      const { view, queue } = await held(false)
      expect(useActorStore().settings).toBeNull()

      clock += 1000
      await button(view, ru.settings.legacy.action).trigger('click')
      await flushPromises()
      const sheet = document.body.querySelector('dialog[open]')
      expect(sheet?.textContent).toContain(ru.settings.context_missing)
      inside(sheet, ru.settings.legacy.confirm).click()
      await flushPromises()

      expect(queue.needsContext).toBe(LEGACY)
      expect(queue.pending.find((write) => write.kind === 'start')?.context).toBeUndefined()
    })
  })

  describe('«не принято» (В-3)', () => {
    const refused = async (code: WireCode = ERROR.INVALID_AMOUNT) => {
      currentTrip.mockResolvedValue(trip(handoff()))
      addExpense.mockRejectedValue(new ApiError(code, undefined, true))
      const rendered = await render()
      rendered.queue.enqueue({
        kind: 'add',
        tripId: TRIP,
        entry: milk,
        body: {
          id: 'eeeeeeee-0000-4000-8000-000000000003',
          itemId: milk.id,
          quantity: parseQuantity('1', 'l'),
          amount: parseMoney('600', 'AMD'),
        },
      })
      await rendered.queue.flush()
      await flushPromises()
      return rendered
    }

    it('называет позицию и причину отказа, а не «что-то пошло не так»', async () => {
      const { view } = await refused()
      expect(view.text()).toContain('«Молоко «Ашхар»» — сервер не принял')
      expect(view.text()).toContain(ru.error.invalid_amount)
    })

    it('код не из словаря показывается как есть — для отчёта', async () => {
      const { view } = await refused(ISSUE.BODY_INVALID)
      expect(view.text()).toContain(ISSUE.BODY_INVALID)
    })

    it('«Поправить» открывает шторку с теми же числами и тем же id покупки', async () => {
      const { view, queue } = await refused()
      await button(view, ru.trip.rejected.fix).trigger('click')
      await flushPromises()
      clock += 1000

      const sheet = document.body.querySelector('dialog[open]')
      expect(sheet?.querySelector<HTMLInputElement>('[data-field="amount"]')?.value).toBe('600')
      // Добавление, а не правка: строки на сервере нет.
      expect(sheet?.textContent).toContain(ru.item.save)

      addExpense.mockReturnValue(new Promise(() => undefined))
      await button(view, ru.item.save).trigger('click')
      await flushPromises()

      expect(queue.rejected).toEqual([])
      const written = queue.pending.filter((write) => write.kind === 'add')
      expect(written).toHaveLength(1)
      expect(written[0]?.body.id).toBe('eeeeeeee-0000-4000-8000-000000000003')
    })

    it('отвергнутая покупка не исчезает вместе с завершённым походом', async () => {
      const { view, queue } = await refused()
      await button(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.ok).click()
      await flushPromises()

      // Поход закончился, а покупка так и не записана — спрятать её значит потерять.
      expect(view.text()).toContain(ru.trip.none.title)
      expect(view.text()).toContain(ru.trip.rejected.drop)
      expect(queue.rejected).toHaveLength(1)
    })

    it('отвергнутый поход говорит, что держит покупки, и уносит их вместе с собой (З1)', async () => {
      currentTrip.mockResolvedValue(null)
      // Сервер отказал в самом походе: покупки в нём никуда не уйдут.
      startTrip.mockRejectedValue(new ApiError(ERROR.CONFLICT, undefined, true))
      const { view, queue } = await render()
      const own = 'bbbbbbbb-0000-4000-8000-000000000041'
      queue.enqueue({
        kind: 'start',
        tripId: own,
        place: { kind: 'store', name: 'Рынок' },
        startedAt: new Date(),
      })
      queue.enqueue({ ...queued('eeeeeeee-0000-4000-8000-000000000042'), tripId: own })
      await queue.flush()
      await flushPromises()

      expect(view.text()).toContain('ждёт решения')
      // И обещания «уйдут, когда появится сеть» про них больше нет.
      expect(view.text()).not.toContain('покупка ещё не отправлена')

      await button(view, ru.trip.rejected.drop_trip).trigger('click')
      await flushPromises()
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toEqual([])
    })

    it('«Убрать» снимает запись с телефона', async () => {
      const { view, queue } = await refused()
      await button(view, ru.trip.rejected.drop).trigger('click')
      await flushPromises()

      expect(queue.rejected).toEqual([])
      expect(view.text()).not.toContain(ru.trip.rejected.fix)
    })
  })

  describe('сервер не ответил', () => {
    it('без сети — зелёная плашка поверх похода, который помнит телефон', async () => {
      currentTrip.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const { view } = await render({ memory: trip(handoff()) })

      expect(view.text()).toContain(ru.trip.offline.title)
      // Поход остаётся на экране: покупки целы, и ими продолжают пользоваться.
      expect(view.findAll('.row')).toHaveLength(2)
    })

    it('похода нет и спросить не удалось — «Новый поход» не молчит об этом', async () => {
      currentTrip.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const { view } = await render()

      expect(view.text()).toContain(ru.trip.none.title)
      // Иначе поход, который сервер держит, но о котором не спросили, читается как «похода нет».
      expect(view.text()).toContain(ru.trip.offline.title)
    })

    it('сеть есть, а сервер молчит — ошибка, тоже поверх похода, и «Повторить»', async () => {
      currentTrip.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render({ memory: trip(handoff()) })

      expect(view.text()).toContain(ru.trip.error.title)
      expect(view.findAll('.row')).toHaveLength(2)

      currentTrip.mockResolvedValue(trip(handoff()))
      await button(view, ru.state.retry).trigger('click')
      await flushPromises()
      expect(view.text()).not.toContain(ru.trip.error.title)
    })
  })

  describe('начать и завершить (В-1, В-2)', () => {
    it('«Начать поход» пишет поход в очередь и рисует его сразу — сеть не ждём', async () => {
      recentPlaces.mockRejectedValue(new Error('Failed to fetch'))
      const { view, queue } = await render()
      await button(view, ru.trip.none.action).trigger('click')
      await flushPromises()
      clock += 1000

      const sheet = document.body.querySelector('dialog[open]')
      const field = sheet?.querySelector('input')
      if (!field) throw new Error('нет поля места')
      field.value = 'Рынок'
      field.dispatchEvent(new Event('input'))
      await flushPromises()
      inside(sheet, ru.trip.none.action).click()
      await flushPromises()

      const start = queue.pending.find((write) => write.kind === 'start')
      expect(start?.place.name).toBe('Рынок')
      expect(start?.tripId).toMatch(/^[0-9a-f-]+$/)
      // Поход виден с местом и днём, хотя сервер о нём ещё не знает.
      expect(view.text()).toContain('Рынок · сегодня')
    })

    it('недавнее место начинает поход одним тапом', async () => {
      recentPlaces.mockResolvedValue([
        { id: 'aaaaaaaa-0000-4000-8000-000000000002', kind: 'store', name: 'Ереван Сити' },
      ])
      const { view, queue } = await render()
      await button(view, ru.trip.none.action).trigger('click')
      await flushPromises()
      clock += 1000

      await button(view, 'Ереван Сити').trigger('click')
      await flushPromises()

      expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe('Ереван Сити')
    })

    it('«Завершить» сначала спрашивает, и отмена ничего не пишет', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      await button(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000

      expect(document.body.textContent).toContain(ru.trip.finish_confirm.title)
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.cancel).click()
      await flushPromises()
      expect(queue.pending).toEqual([])
    })

    it('подтверждённое завершение уходит в очередь, и экран зовёт начать новый', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      await button(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.ok).click()
      await flushPromises()

      expect(queue.pending.some((write) => write.kind === 'finish')).toBe(true)
      expect(view.text()).toContain(ru.trip.none.title)
      expect(view.findAll('.row')).toHaveLength(0)
    })
  })

  it('«Добавить позицию» ведёт на поиск', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view, router } = await render()
    await button(view, ru.trip.add_item).trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('item-search')
  })
})
