import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { RouterView, createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  ISSUE,
  moneyAccountsCodec,
  parseMoney,
  parseQuantity,
  tripViewCodec,
} from '@molvia/model'
import type {
  CatalogueEntry,
  Currency,
  MoneyAccountView,
  MoneyAccountsResponse,
  PendingVerdicts,
  TripHistory,
  TripView as TripViewModel,
  WireCode,
} from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useItemEntryStore } from '@/stores/itemEntry'
import { useSpendingHandoffStore } from '@/stores/spendingHandoff'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import TripNotices from '@/components/TripNotices.vue'

const currentTrip = vi.fn<() => Promise<TripViewModel | null>>()
const recentPlaces = vi.fn<() => Promise<{ id: string; kind: 'store'; name: string }[]>>()
const startTrip = vi.fn()
const addExpense = vi.fn()
const tripHistory = vi.fn<() => Promise<TripHistory>>()
const pendingVerdicts = vi.fn<() => Promise<PendingVerdicts>>()
const removeTrip = vi.fn<(tripId: string) => Promise<void>>()
const restoreTrip = vi.fn()
const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>(
  () => new Promise(() => undefined),
)
vi.mock('@/api', () => ({
  api: {
    receipts: () => Promise.resolve({ receipts: [] }),
    currentTrip: () => currentTrip(),
    // «Что взяли?», где оказываются «+ Позиция» и «Штрихкод», спрашивает прошлый раз места (MOL-209).
    previousItems: () => Promise.resolve({ previous: null, items: [] }),
    tripHistory: () => tripHistory(),
    pendingVerdicts: () => pendingVerdicts(),
    recentPlaces: () => recentPlaces(),
    addExpense: (...args: unknown[]) => addExpense(...args),
    updateExpense: () => new Promise(() => undefined),
    removeExpense: () => new Promise(() => undefined),
    startTrip: (...args: unknown[]) => startTrip(...args),
    finishTrip: () => new Promise(() => undefined),
    removeTrip: (tripId: string) => removeTrip(tripId),
    restoreTrip: (...args: unknown[]) => restoreTrip(...args),
    setTripReceipt: () => new Promise(() => undefined),
    // «Деньги», where an empty record is handed over as a spending (MOL-78, В-1).
    moneyMonth: () => new Promise(() => undefined),
    moneyAccounts: () => moneyAccounts(),
    // «Тут дешевле» on the purchase sheet (MOL-92): never answered here.
    ownPrices: () => new Promise(() => undefined),
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

/**
 * Кнопка полосы записи (Ф-22) по её имени для диктора — скрытое ведущее слово и видимое («Новая
 * Позиция»): «Закончить» шторки висит в дереве раньше и не в счёт.
 */
/** Имена кнопок полосы для диктора (ревью 3, №3). */
const ADD = `${ru.trip.add_lead} ${ru.trip.add_short}`
const SCAN = `${ru.trip.scan_lead} ${ru.trip.scan_short}`

function docked(view: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const name = (candidate: DOMWrapper<HTMLButtonElement>) =>
    candidate.element.textContent.replace(/\s+/g, ' ').trim()
  const found = view
    .get('.dock')
    .findAll('button')
    .find((candidate) => name(candidate) === text)
  if (!found) throw new Error(`нет кнопки «${text}» в полосе`)
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
  // Приложение с осевшей личностью: очередь отправляет только по ответу сервера (MOL-56).
  useActorStore().state = 'ready'
  const trips = useTripStore()
  const queue = useTripQueueStore()
  if (memory) trips.apply(memory)
  // The record as it is reached: «Покупки» underneath, so going up is the step back it is in the
  // app. With no record open the screen leaves for «Покупки» (MOL-128), and the app — a router
  // view, not the screen alone — shows what the person then sees.
  // A web history, as in the app: a sheet closes by a step back, and only the web history says
  // when that step has landed (`popstate`) — the record leaves after it, never under it.
  window.history.replaceState(null, '', '/purchases')
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push('/purchases')
  await router.push('/purchases/manual')
  const view = mount(App, {
    // The scanner the search opens over itself needs a camera and a worker, which happy-dom has
    // not; what it does with a code is ItemSearchView's test (MOL-99).
    global: {
      plugins: [router, pinia, createAppI18n('ru')],
      stubs: { BarcodeScannerSheet: true },
    },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router, trips, queue }
}

/** The app as far as screens go: whichever the router is on. */
const App = defineComponent(() => () => h(RouterView))

/** «Записать вручную»: with receipts the camera is the strip's first button (MOL-127, Р-1). */
function byHand(view: VueWrapper) {
  const found = view
    .findAll('.dock button')
    .find((node) => node.text().includes(ru.purchases.manual_by_hand))
  if (!found) throw new Error('нет «Записать вручную» в полосе')
  return found
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
    tripHistory.mockReset()
    tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
    pendingVerdicts.mockReset()
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    // Без связи: удаление ждёт в очереди, а «Вернуть» снимает его оттуда.
    removeTrip.mockReset()
    removeTrip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    restoreTrip.mockReset()
    restoreTrip.mockReturnValue(new Promise(() => undefined))
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
    expect(view.text()).toContain(ru.purchases.empty.title)
    expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
  })

  describe('без открытой записи — «Покупки» (MOL-77, MOL-128)', () => {
    it('«Начать поход» — в полосе над таб-баром, а круг на экране только тихий', async () => {
      const { view } = await render()
      expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
      expect(view.findAll('.circle').length).toBe(1)
      expect(view.get('.state').classes()).toContain('quiet')
      // Призрачную «Историю походов» заменяет «Вся история» главной.
      expect(view.findAll('button').some((b) => b.text() === ru.trip.history.title)).toBe(false)
    })

    it('«Начать поход» открывает шторку и при ошибке похода, и при ошибке истории', async () => {
      currentTrip.mockRejectedValue(new Error('HTTP 500'))
      tripHistory.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render()
      // No record known, so the screen is «Покупки», and its one red block says what failed.
      expect(view.text()).toContain(ru.purchases.error.title)
      await byHand(view).trigger('click')
      await flushPromises()
      expect(document.body.querySelector('dialog[open]')?.textContent).toContain(
        ru.trip.start.title,
      )
    })

    it('сервер лежит — одна «Повторить», и она перечитывает и поход, и историю (Д)', async () => {
      currentTrip.mockRejectedValue(new Error('HTTP 500'))
      tripHistory.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render()
      expect(view.findAll('button').filter((b) => b.text() === ru.state.retry)).toHaveLength(1)
      // Записи нет — и «позиции остались на телефоне» было бы неправдой.
      expect(view.text()).toContain(ru.purchases.error.title)
      expect(view.text()).not.toContain(ru.trip.error.body)

      currentTrip.mockResolvedValue(null)
      tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
      await button(view, ru.state.retry).trigger('click')
      await flushPromises()
      expect(view.text()).not.toContain(ru.purchases.error.title)
      expect(view.text()).toContain(ru.purchases.empty.title)
    })

    it('при открытом походе в полосе — итог, а «Начать поход» нет', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view } = await render()
      expect(view.get('.dock').text()).not.toContain(ru.purchases.manual_by_hand)
    })
  })

  it('пустая запись — тихий круг в карточке без кнопок, а действия в полосе (Ф-16, Ф-22)', async () => {
    currentTrip.mockResolvedValue(trip())
    const { view } = await render()
    const state = view.getComponent({ name: 'ScreenState' })
    expect(state.text()).toContain(ru.trip.empty.title)
    // Терракотовый круг над «Найти товар» читался кнопкой (MOL-77); тихий — нет (Ф-16).
    expect(state.classes()).toContain('quiet')
    expect(state.findAll('button')).toHaveLength(0)
    expect(state.element.closest('.card')).not.toBeNull()
    // Полоса та же, что у записи с позициями: она не меняется с первой позицией (77 v2, п. 5).
    expect(docked(view, SCAN).exists()).toBe(true)
    expect(docked(view, ADD).exists()).toBe(true)
    expect(docked(view, ru.trip.finish).exists()).toBe(true)
    // Итога у пустой записи нет: «—» — число без числа.
    expect(view.findComponent({ name: 'TripTotalCard' }).exists()).toBe(false)
  })

  it('кнопки полосы говорят диктору, что делают, и видимое слово — в имени (ревью 2 №3, ревью 3 №3)', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()
    for (const [name, word] of [
      [ADD, ru.trip.add_short],
      [SCAN, ru.trip.scan_short],
    ] as const) {
      const button = docked(view, name)
      expect(button.attributes('aria-label')).toBeUndefined()
      // WCAG 2.5.3: голос «нажать Позиция» находит кнопку — видимое слово стоит в имени как есть.
      expect(button.find('.hidden').exists()).toBe(true)
      expect(button.find('[aria-hidden="true"]:not(.glyph)').exists()).toBe(false)
      expect(name.endsWith(word)).toBe(true)
    }
  })

  it('в шапке «Закончить» нет: она в полосе, в зоне пальца (Ф-22)', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()
    expect(view.get('.bar').text()).not.toContain(ru.trip.finish)
    expect(view.get('.head').text()).not.toContain(ru.trip.finish)
    expect(view.findAll('button').filter((node) => node.text() === ru.trip.finish)).toHaveLength(
      // В полосе и в подвале закрытой шторки «Закончить запись?».
      2,
    )
  })

  it('сумма по чеку без покупок не пропадает: карточка «Итого по чеку» и «Изменить» (адверсариальное А1)', async () => {
    currentTrip.mockResolvedValue({
      ...trip(),
      receipt: parseMoney('5000', 'AMD'),
      total: [parseMoney('5000', 'AMD')],
    })
    const { view } = await render()
    // Пустая — и тихий круг, и деньги записи рядом: сервер сумму держит, она идёт в «Деньги».
    expect(view.getComponent({ name: 'ScreenState' }).text()).toContain(ru.trip.empty.title)
    const total = view.get('.total')
    expect(total.text()).toContain(ru.trip.receipt.total)
    expect(plain(total.text())).toContain('5 000 ֏')
    expect(view.get('.receipt').text()).toBe(ru.trip.receipt.edit)
    // Сноска о позициях — только при позициях.
    expect(view.text()).not.toContain(ru.trip.footnote)
  })

  describe('запись с одной суммой по чеку — не «ничего нет» (адверсариальное Б1)', () => {
    const sumOnly = () => ({
      ...trip(),
      receipt: parseMoney('5000', 'AMD'),
      total: [parseMoney('5000', 'AMD')],
    })

    it('«Закончить» спрашивает как обычно, без «Записать тратой»', async () => {
      currentTrip.mockResolvedValue(sumOnly())
      const { view } = await render()
      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      const finishing = document.body.querySelector('dialog[open]')?.textContent ?? ''
      expect(finishing).toContain(ru.trip.finish_confirm.title)
      expect(finishing).not.toContain(ru.trip.remove.empty.spending)
      // Слова о сумме, а не о покупках, которых нет (адверсариальное В1).
      expect(plain(finishing)).toContain('Сумма по чеку 5 000 ֏ останется в «Деньгах»')
      expect(finishing).not.toContain(ru.trip.finish_confirm.body)
    })

    it('«Удалить запись» сначала спрашивает: деньги записи уходят из «Денег» и счетов (MOL-76)', async () => {
      currentTrip.mockResolvedValue(sumOnly())
      const { view, queue } = await render()
      await button(view, ru.trip.remove.action).trigger('click')
      await flushPromises()
      const asking = document.body.querySelector('dialog[open]')?.textContent ?? ''
      expect(asking).toContain(ru.trip.remove.sheet.title)
      expect(plain(asking)).toContain('Сумма по чеку 5 000 ֏ уйдёт из «Денег» и счетов')
      expect(asking).not.toContain(ru.trip.remove.sheet.body)
      expect(queue.pending.some((write) => write.kind === 'delete')).toBe(false)
    })
  })

  it('строка без цены, удаляемая без связи, — не «без цены» в итоге, как и у «Закончить» (адверсариальное А2)', async () => {
    currentTrip.mockResolvedValue(trip([...handoff(), { id: BREAD, name: 'Хлеб «Матнакаш»' }]))
    const { view, queue } = await render()
    expect(plain(view.get('.total').text())).toContain('без цены — 1')
    queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: BREAD })
    await flushPromises()
    expect(plain(view.get('.total').text())).not.toContain('без цены')
    // «Закончить» по тому же счёту о сумме не спрашивает: цены у всех оставшихся.
    await docked(view, ru.trip.finish).trigger('click')
    await flushPromises()
    expect(document.body.querySelector('dialog[open]')?.textContent).toContain(
      ru.trip.finish_confirm.title,
    )
    expect(document.body.querySelector('dialog[open] input')).toBeNull()
  })

  it('строк-действий в списке нет — «+ Позиция» и «Штрихкод» только в полосе (С-8)', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()
    const list = view.get('.card.list')
    expect(list.text()).not.toContain(ru.trip.add_item)
    expect(list.text()).not.toContain(ru.item.barcode.scan)
    expect(list.findAll('.row')).toHaveLength(2)
    // Итог — карточкой под списком, а не в полосе.
    expect(view.get('.dock').findComponent({ name: 'TripTotalCard' }).exists()).toBe(false)
    expect(view.findComponent({ name: 'TripTotalCard' }).exists()).toBe(true)
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
    await router.push('/purchases')
    await router.push('/purchases/manual')
    const view = mount(App, {
      global: { plugins: [router, pinia, createAppI18n('ru')] },
      attachTo: document.body,
    })
    mounted.push(view)

    expect(view.findAll('.bar')).not.toHaveLength(0)
    // Not left for «Покупки» either: until the server is asked, «no record» is not known.
    expect(router.currentRoute.value.name).toBe('purchase-manual')

    // The answer's shape (Ф-13): the rows of the record and the card of its total, and no strip —
    // its buttons would act on a record nobody knows yet.
    const parts = view.findAllComponents({ name: 'SkeletonPart' }).map((part) => part.props('kind'))
    expect(parts).toEqual(['rows', 'figure'])
    expect(view.find('.dock').exists()).toBe(false)
    // What the queue says stands over the skeleton, so the answer coming in under it moves none of
    // its buttons from under a finger (MOL-311): a refused purchase, «Поправить» and «Убрать» on it.
    addExpense.mockRejectedValue(new ApiError(ERROR.INVALID_AMOUNT, undefined, true))
    const queue = useTripQueueStore(pinia)
    queue.enqueue({
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
    await queue.flush()
    await flushPromises()
    const notices = view.get('.notices').element
    const skeleton = view.getComponent({ name: 'ScreenSkeleton' }).element
    expect(
      notices.compareDocumentPosition(skeleton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  // Review Р-18: before the record going on is known, its own waiting purchases are not «не
  // отправлено» — they are its rows the moment the server answers.
  it('пока запись не известна, её ждущие покупки не названы неотправленными', async () => {
    currentTrip.mockReturnValue(new Promise(() => undefined))
    const { view, queue } = await render()
    queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000081'))
    await flushPromises()
    expect(view.text()).not.toContain('ещё не отправлена')
  })

  it('весь смысл продукта в двух числах: 520 ֏ за 0,9 л дороже 570 ֏ за литр', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()

    const rows = view.findAll('.row')
    expect(rows).toHaveLength(2)
    expect(plain(rows[0]?.text())).toContain('570 ֏ за л')
    // Дешевле на ценнике и дороже за литр — ради этой строки экран и существует.
    expect(plain(rows[1]?.text())).toContain('520 ֏')
    expect(plain(rows[1]?.text())).toContain('577,78 ֏ за л')
  })

  it('строка без цены говорит «без цены» и ведёт шевроном в шторку (7a)', async () => {
    currentTrip.mockResolvedValue(trip([{ id: BREAD, name: 'Хлеб «Матнакаш»' }]))
    const { view } = await render()
    expect(view.get('.row .meta').text()).toBe(ru.trip.unpriced)
    expect(view.get('.row .tail').text()).toBe('—')
    expect(view.get('.row').find('.chevron').exists()).toBe(true)
  })

  it('место и день в строке над заголовком', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()
    expect(view.get('h1').text()).toBe('Ереван Сити')
    expect(view.text()).toContain('Записываете вручную · сегодня, с')
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

  // Review Р-7: the record may end under a sheet — finished on another phone — and nothing else
  // would take the screen up once the sheet is away.
  describe('запись закончилась под шторкой (Р-7)', () => {
    const closeSheet = async () => {
      document.body
        .querySelector<HTMLButtonElement>(`dialog[open] button[aria-label="${ru.sheet.close}"]`)
        ?.click()
      await vi.waitFor(() => {
        expect(document.body.querySelector('dialog[open]')).toBeNull()
      })
    }

    it('под шторкой покупки экран стоит, а без неё уходит на «Покупки»', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, router, trips } = await render()
      await view.findAll('.row')[1]?.trigger('click')
      await flushPromises()
      clock += 1000

      trips.closed(TRIP)
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('purchase-manual')

      await closeSheet()
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('purchases')
      })
    })

    it('и под шторкой «Поправить» из того, что говорит очередь', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      addExpense.mockRejectedValue(new ApiError(ERROR.INVALID_AMOUNT, undefined, true))
      const { view, router, trips, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000003'))
      await queue.flush()
      await flushPromises()
      await button(view, ru.trip.rejected.fix).trigger('click')
      await flushPromises()
      clock += 1000

      trips.closed(TRIP)
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('purchase-manual')

      await closeSheet()
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('purchases')
      })
    })
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
      expect(plain(last?.text())).toContain('300 ֏ за л')
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
      expect(row?.attributes('aria-disabled')).toBe('true')
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

      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.ok).click()
      await flushPromises()

      expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
      // На iOS фонового обмена нет: молчание здесь — это покупка, о которой никто не узнает.
      expect(view.text()).toContain('1 покупка ещё не отправлена')
    })

    it('и не замолкает, стоит начать следующий поход (Т-11)', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      addExpense.mockReturnValue(new Promise(() => undefined))
      const { view, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000012'))
      await flushPromises()

      await docked(view, ru.trip.finish).trigger('click')
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
      // A real conflict, not a planted `elsewhere`: the answer is checked by what the queue
      // does with it, so a change inside the store cannot leave the screen silently broken.
      const open = trip([], { id: 'bbbbbbbb-0000-4000-8000-000000000031' })
      currentTrip.mockResolvedValue(null)
      startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_OPEN, undefined, true))
      const { view, queue } = await render()
      currentTrip.mockResolvedValue({ ...open, place: { ...open.place, name: 'SAS' } })
      queue.enqueue({
        kind: 'start',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000032',
        place: { kind: 'store', name: 'Ереван Сити' },
        startedAt: new Date(),
      })
      await flushPromises()

      expect(view.text()).toContain('Уже открыта запись в «SAS»')
      // The shops differ, so moving the purchases across is said in words (Р-2, З-4).
      expect(view.text()).toContain('цены одного магазина нельзя записывать другому')
      await button(view, ru.trip.elsewhere.choose).trigger('click')
      await flushPromises()
      clock += 1000
      const sheet = document.body.querySelector('dialog[open]')
      expect(sheet?.textContent).toContain('запишутся магазину «SAS»')
      inside(sheet, ru.trip.elsewhere.finish).click()
      await flushPromises()

      expect(queue.elsewhere).toBeNull()
      expect(queue.pending.some((write) => write.kind === 'finish')).toBe(true)
    })

    it('в том же магазине ничего не говорит про перенос цен в чужой', async () => {
      const open = trip([], { id: 'bbbbbbbb-0000-4000-8000-000000000035' })
      currentTrip.mockResolvedValue(null)
      startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_OPEN, undefined, true))
      const { view, queue } = await render()
      currentTrip.mockResolvedValue(open)
      queue.enqueue({
        kind: 'start',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000036',
        place: { kind: 'store', name: open.place.name },
        startedAt: new Date(),
      })
      await flushPromises()

      expect(view.text()).toContain(`Уже открыта запись в «${open.place.name}»`)
      expect(view.text()).not.toContain('цены одного магазина нельзя записывать другому')
    })

    it('тот же магазин, написанный иначе, — тоже тот же', async () => {
      // Сервер сводит места через `placeIdentity`; экран обязан отвечать так же, иначе он
      // обещает порчу данных, которой не будет (В3).
      currentTrip.mockResolvedValue(null)
      const { view, queue } = await render()
      const body = (
        view.findComponent(TripNotices).vm as unknown as { elsewhereBody: (a: unknown) => string }
      ).elsewhereBody
      const warning = 'цены одного магазина нельзя записывать другому'

      expect(body({ tripId: TRIP, place: 'Ереван Сити ', mine: 'ереван сити' })).not.toContain(
        warning,
      )
      // А два пробела внутри имени сервер как раз не схлопывает: это разные места.
      expect(body({ tripId: TRIP, place: 'Ереван  Сити', mine: 'Ереван Сити' })).toContain(warning)
      expect(body({ tripId: TRIP, place: 'SAS', mine: 'Ереван Сити' })).toContain(warning)
      expect(queue.elsewhere).toBeNull()
    })

    it('MOL-120, Б1: одно имя в двух городах — другой магазин, оба названы с городом', async () => {
      // Вчера в Гюмри открыта запись в «Ереван Сити»; сегодня в Ереване начата запись в «Ереван
      // Сити». Индекс мест берёт город: это два магазина, и перенос цен говорится словами.
      const open = trip([], { id: 'bbbbbbbb-0000-4000-8000-000000000037' })
      currentTrip.mockResolvedValue(null)
      startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_OPEN, undefined, true))
      const { view, queue } = await render()
      currentTrip.mockResolvedValue({
        ...open,
        place: { ...open.place, name: 'Ереван Сити' },
        placeCity: 'Гюмри',
      })
      queue.enqueue({
        kind: 'start',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000038',
        place: { kind: 'store', name: 'Ереван Сити' },
        context: { country: 'AM', city: 'Ереван', spendCurrency: 'AMD', incomeCurrency: 'RUB' },
        startedAt: new Date(),
      })
      await flushPromises()

      expect(view.text()).toContain('Уже открыта запись в «Ереван Сити» в Гюмри')
      expect(view.text()).toContain('Покупки новой записи («Ереван Сити» в Ереване)')
      expect(view.text()).toContain('цены одного магазина нельзя записывать другому')
    })

    it('MOL-120, Б1: тот же город в другом написании — тот же магазин; без города — по имени', async () => {
      currentTrip.mockResolvedValue(null)
      const { view } = await render()
      const body = (
        view.findComponent(TripNotices).vm as unknown as { elsewhereBody: (a: unknown) => string }
      ).elsewhereBody
      const warning = 'цены одного магазина нельзя записывать другому'
      const asked = { tripId: TRIP, place: 'Ереван Сити', mine: 'Ереван Сити' }

      // A place keeps its city as first written: «гюмри» is Gyumri.
      expect(body({ ...asked, placeCity: 'гюмри', mineCity: 'Гюмри' })).not.toContain(warning)
      // A server before MOL-120, or a start the old queue kept without a context: as before.
      expect(body({ ...asked, mineCity: 'Ереван' })).not.toContain(warning)
      expect(body({ ...asked, placeCity: 'Гюмри' })).not.toContain(warning)
      // Different names: another shop, and the city is noise.
      expect(body({ ...asked, mine: 'SAS', placeCity: 'Гюмри', mineCity: 'Ереван' })).toContain(
        'Покупки новой записи («SAS»)',
      )
    })

    it('тот же вопрос, заданный заново, не теряет ответ из уже открытой шторки', async () => {
      const open = trip([], { id: 'bbbbbbbb-0000-4000-8000-000000000033' })
      currentTrip.mockResolvedValue(null)
      startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_OPEN, undefined, true))
      const { view, queue } = await render()
      currentTrip.mockResolvedValue({ ...open, place: { ...open.place, name: 'SAS' } })
      queue.enqueue({
        kind: 'start',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000034',
        place: { kind: 'store', name: 'Ереван Сити' },
        startedAt: new Date(),
      })
      await flushPromises()
      await button(view, ru.trip.elsewhere.choose).trigger('click')
      await flushPromises()

      // The phone went into a pocket and came back: `useReconnect` sends `flush()` again, and
      // the same question is asked with a new object behind it (А3).
      await queue.flush()
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.elsewhere.join).click()
      await flushPromises()

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
      useActorStore().apply(whereAt('Москва', 'RU', '2026-09-22T00:00:00.000Z'))
      await flushPromises()
      clock += 1000
      await button(view, ru.settings.legacy.action).trigger('click')
      await flushPromises()
      expect(document.body.querySelector('dialog[open]')?.textContent).toContain('Москва')

      // Шторка закрыта, настройки переехали, шторка открыта снова.
      await view.findComponent({ name: 'TripContextSheet' }).vm.$emit('update:open', false)
      await flushPromises()
      useActorStore().apply(whereAt('Гюмри', 'AM', '2026-09-23T00:00:00.000Z'))
      await flushPromises()
      clock += 1000
      await button(view, ru.settings.legacy.action).trigger('click')
      await flushPromises()
      const sheet = document.body.querySelector('dialog[open]')
      expect(sheet?.textContent).not.toContain('Москва')
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
      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.ok).click()
      await flushPromises()

      // Поход закончился, а покупка так и не записана — спрятать её значит потерять.
      expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
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
    it('без сети — одна полоса связи над записью, которую помнит телефон, не красная и без «Повторить»', async () => {
      currentTrip.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const { view } = await render({ memory: trip(handoff()) })

      const strips = view.findAllComponents({ name: 'StatusStrip' })
      expect(strips).toHaveLength(1)
      expect(strips[0]?.props('kind')).toBe('offline')
      expect(strips[0]?.text()).toBe(ru.trip.offline.strip)
      expect(strips[0]?.find('button').exists()).toBe(false)
      // Карточки «Нет сети — и ладно» больше нет (Ф-14).
      expect(view.findAllComponents({ name: 'ScreenState' })).toHaveLength(0)
      // Запись остаётся на экране, и полоса пишет в очередь: покупки целы, ими продолжают пользоваться.
      expect(view.findAll('.row')).toHaveLength(2)
      expect(docked(view, ADD).exists()).toBe(true)
      expect(docked(view, ru.trip.finish).exists()).toBe(true)
    })

    it('похода нет и спросить не удалось — главная не молчит об этом', async () => {
      currentTrip.mockRejectedValue(new Error('Failed to fetch'))
      tripHistory.mockRejectedValue(new Error('Failed to fetch'))
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const { view } = await render()

      expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
      // Иначе поход, который сервер держит, но о котором не спросили, читается как «похода нет».
      // Своими словами главной: начать можно и без сети — и одно уведомление, а не два.
      expect(view.text()).toContain(ru.purchases.offline.title)
      expect(view.text()).not.toContain(ru.trip.offline.strip)
    })

    it('сеть есть, а сервер молчит — полоса «не ответил» над записью, и одна «Повторить», не залитая', async () => {
      currentTrip.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render({ memory: trip(handoff()) })

      const strip = view.getComponent({ name: 'StatusStrip' })
      expect(strip.props('kind')).toBe('unanswered')
      expect(strip.text()).toContain(ru.trip.error.strip)
      expect(view.findAll('.row')).toHaveLength(2)
      // Одна «Повторить», и она не основная: основная на экране одна — «+ Позиция» (Ф-15).
      const retries = view.findAll('button').filter((node) => node.text() === ru.state.retry)
      expect(retries).toHaveLength(1)
      expect(retries[0]?.classes()).toContain('ghost')
      expect(docked(view, ADD).classes()).toContain('primary')
      expect(docked(view, ru.trip.finish).exists()).toBe(true)

      currentTrip.mockResolvedValue(trip(handoff()))
      await button(view, ru.state.retry).trigger('click')
      await flushPromises()
      expect(view.findComponent({ name: 'StatusStrip' }).exists()).toBe(false)
    })

    it('повтор, упавший так же, — новая попытка: полоса скажет свои слова ещё раз (C1)', async () => {
      currentTrip.mockRejectedValue(new Error('HTTP 500'))
      const { view } = await render({ memory: trip(handoff()) })
      const before = view.getComponent({ name: 'StatusStrip' }).props('attempt') as number
      await button(view, ru.state.retry).trigger('click')
      await flushPromises()
      expect(view.getComponent({ name: 'StatusStrip' }).props('attempt')).toBe(before + 1)
    })
  })

  describe('начать и завершить (В-1, В-2)', () => {
    it('«Начать поход» пишет поход в очередь и рисует его сразу — сеть не ждём', async () => {
      recentPlaces.mockRejectedValue(new Error('Failed to fetch'))
      const { view, queue } = await render()
      await byHand(view).trigger('click')
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
      expect(view.get('h1').text()).toBe('Рынок')
      expect(view.text()).toContain('Записываете вручную · сегодня')
    })

    it('недавнее место начинает поход одним тапом', async () => {
      recentPlaces.mockResolvedValue([
        { id: 'aaaaaaaa-0000-4000-8000-000000000002', kind: 'store', name: 'Ереван Сити' },
      ])
      const { view, queue } = await render()
      await byHand(view).trigger('click')
      await flushPromises()
      clock += 1000

      await button(view, 'Ереван Сити').trigger('click')
      await flushPromises()

      expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe('Ереван Сити')
    })

    it('«Завершить» сначала спрашивает, и отмена ничего не пишет', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      await docked(view, ru.trip.finish).trigger('click')
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
      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
      inside(document.body.querySelector('dialog[open]'), ru.trip.finish_confirm.ok).click()
      await flushPromises()

      expect(queue.pending.some((write) => write.kind === 'finish')).toBe(true)
      expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
      expect(view.findAll('.row')).toHaveLength(0)
    })
  })

  it('«Добавить позицию» ведёт на поиск', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view, router } = await render()
    await docked(view, ADD).trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('item-search')
  })

  it('«Сканировать штрихкод» ведёт на поиск и просит поднять сканер сразу (MOL-99, В-4)', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view, router } = await render()
    const asked = vi.spyOn(useItemEntryStore(), 'askToScan')
    await docked(view, SCAN).trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('item-search')
    expect(asked).toHaveBeenCalledOnce()
  })

  it('«Добавить позицию» сканер не просит', async () => {
    currentTrip.mockResolvedValue(trip(handoff()))
    const { view } = await render()
    const asked = vi.spyOn(useItemEntryStore(), 'askToScan')
    await docked(view, ADD).trigger('click')
    await flushPromises()

    expect(asked).not.toHaveBeenCalled()
  })

  // MOL-312, В-3 «б»: finished is paid — the account is chosen in «Закончить» and goes before the finish
  describe('счёт записи вручную (MOL-312)', () => {
    const openSheets = () => [...document.body.querySelectorAll('dialog[open]')]
    let next = 0
    function account(name: string, currency: Currency): MoneyAccountView {
      next += 1
      return {
        id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
        name,
        currency,
        savings: false,
        start: parseMoney('0', currency),
        startOn: '2026-09-16',
        balance: parseMoney('1000', currency),
        approximate: false,
        uncounted: 0,
        inSpend: null,
        rate: null,
        lastCheckedOn: null,
        hasOperations: false,
        archivedAt: null,
        revision: 1,
      }
    }
    const cash = account('Наличные ֏', 'AMD')
    const card = account('Карта ֏', 'AMD')
    const roubles = account('Карта ₽', 'RUB')
    const page = (accounts: MoneyAccountView[]): MoneyAccountsResponse => {
      const zero = parseMoney('0', 'AMD')
      return {
        spendCurrency: 'AMD',
        accounts,
        totals: { total: zero, spendable: zero, savings: zero, uncounted: 0 },
        incomeTotals: null,
        unassigned: 0,
        countedAt: new Date(),
      }
    }

    beforeEach(() => {
      moneyAccounts.mockReset()
      moneyAccounts.mockResolvedValue(page([cash, card, roubles]))
      currentTrip.mockResolvedValue(trip(handoff()))
    })
    afterEach(() => {
      moneyAccounts.mockImplementation(() => new Promise(() => undefined))
    })

    async function askFinish(view: VueWrapper): Promise<void> {
      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      clock += 1000
    }
    const row = () => openSheets()[0]?.querySelector<HTMLButtonElement>('.account .row')
    async function typeSum(value: string): Promise<void> {
      const sum = openSheets()[0]?.querySelector<HTMLInputElement>('input[data-field="receipt"]')
      if (!sum) throw new Error('нет поля суммы')
      sum.value = value
      sum.dispatchEvent(new Event('input'))
      await flushPromises()
    }
    async function choose(name: string): Promise<void> {
      row()?.click()
      await flushPromises()
      clock += 1000
      const option = [...(openSheets().at(-1)?.querySelectorAll('[role="radio"]') ?? [])].find(
        (one) => one.textContent.includes(name),
      )
      if (!(option instanceof HTMLElement)) throw new Error(`нет счёта «${name}»`)
      option.click()
      await flushPromises()
    }
    const memory = () =>
      JSON.parse(localStorage.getItem(`molvia.payment-accounts.${ME}`) ?? 'null') as unknown

    it('ставит первый счёт валюты и отправляет его перед завершением', async () => {
      const { view, queue } = await render()
      await askFinish(view)
      expect(row()?.textContent).toContain('Наличные ֏')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.map((write) => write.kind)).toEqual(['payment', 'finish'])
      expect(queue.pending[0]).toMatchObject({ tripId: TRIP, body: { accountId: cash.id } })
      expect(memory()).toEqual({ AMD: { hand: cash.id } })
    })

    it('начинает со счёта, которым закончена прошлая запись, — не со счёта чеков', async () => {
      localStorage.setItem(
        `molvia.payment-accounts.${ME}`,
        JSON.stringify({ AMD: { hand: card.id, receipt: cash.id } }),
      )
      const { view } = await render()
      await askFinish(view)
      expect(row()?.textContent).toContain('Карта ֏')
    })

    it('счёт в другой валюте — «Списано» уходит с ним, ноль не уходит вовсе', async () => {
      const { view, queue } = await render()
      await askFinish(view)
      await choose('Карта ₽')
      const charged = openSheets()[0]?.querySelector<HTMLInputElement>('.charged input')
      if (!charged) throw new Error('нет поля «Списано»')
      charged.value = '0'
      charged.dispatchEvent(new Event('input'))
      await flushPromises()
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending).toEqual([])
      expect(openSheets()[0]?.textContent).toContain(ru.spending.sheet.bad_amount)
      charged.value = '1100,50'
      charged.dispatchEvent(new Event('input'))
      await flushPromises()
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending[0]).toMatchObject({
        kind: 'payment',
        body: { accountId: roubles.id, debited: parseMoney('1100.50', 'RUB') },
      })
    })

    it('«не должно сработать»: «Без счёта» — уходит одно завершение, умолчание не запоминается', async () => {
      const { view, queue } = await render()
      await askFinish(view)
      await choose('Без счёта')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.map((write) => write.kind)).toEqual(['finish'])
      expect(memory()).toBeNull()
    })

    it('запись уже на счёте — «Закончить» открывается на нём со «Списано» и счёт не трогает (Р1-1)', async () => {
      currentTrip.mockResolvedValue({
        ...trip(handoff()),
        accountId: roubles.id,
        debited: parseMoney('1100', 'RUB'),
      })
      const { view, queue } = await render()
      await askFinish(view)
      expect(row()?.textContent).toContain('Карта ₽')
      const charged = openSheets()[0]?.querySelector<HTMLInputElement>('.charged input')
      expect(charged?.value).toBe('1100')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      // must not: a payment of the same account and «Списано» — nothing to move
      expect(queue.pending.map((write) => write.kind)).toEqual(['finish'])
      expect(memory()).toBeNull()
    })

    it('запись уже на счёте — «Без счёта» снимает его, другая сумма «Списано» уходит', async () => {
      currentTrip.mockResolvedValue({
        ...trip(handoff()),
        accountId: roubles.id,
        debited: parseMoney('1100', 'RUB'),
      })
      const first = await render()
      await askFinish(first.view)
      await choose('Без счёта')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(first.queue.pending.map((write) => write.kind)).toEqual(['payment', 'finish'])
      expect(first.queue.pending[0]).toMatchObject({ body: { accountId: null } })
    })

    it('счёт, ждущий в очереди, — то, на чём открывается «Закончить», и его не вытесняет (Р2-2, А7)', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      currentTrip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
      const { view, queue } = await render({ memory: trip(handoff()) })
      // «Не попали» без связи: «Карта ₽» и «Списано» ждут в очереди
      queue.enqueue({
        kind: 'payment',
        tripId: TRIP,
        body: { accountId: roubles.id, debited: parseMoney('1100', 'RUB') },
      })
      await askFinish(view)
      expect(row()?.textContent).toContain('Карта ₽')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.filter((write) => write.kind === 'payment')).toEqual([
        expect.objectContaining({
          body: { accountId: roubles.id, debited: parseMoney('1100', 'RUB') },
        }),
      ])
      expect(queue.pending.at(-1)?.kind).toBe('finish')
      expect(memory()).toBeNull()
    })

    it('«не должно сработать»: поля «Списано» нет — тот же счёт ничего не шлёт (Р2-1, А8)', async () => {
      // the record's own currency, «Списано» for a purchase in a third one: the field is not shown
      currentTrip.mockResolvedValue({
        ...trip(handoff()),
        accountId: card.id,
        debited: parseMoney('41000', 'AMD'),
      })
      const first = await render()
      await askFinish(first.view)
      expect(row()?.textContent).toContain('Карта ֏')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(first.queue.pending.map((write) => write.kind)).toEqual(['finish'])
    })

    it('«не должно сработать»: счёта записи телефон не знает — «Закончить» его не трогает (А8)', async () => {
      // an account this phone does not know — made on another phone, «Счета» not answering at the shelf
      localStorage.setItem(
        `molvia.accounts.${ME}`,
        JSON.stringify({ overview: moneyAccountsCodec.encode(page([cash, card])) }),
      )
      moneyAccounts.mockReturnValue(new Promise(() => undefined))
      currentTrip.mockResolvedValue({
        ...trip(handoff()),
        accountId: roubles.id,
        debited: parseMoney('1100', 'RUB'),
      })
      const second = await render()
      await askFinish(second.view)
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(second.queue.pending.map((write) => write.kind)).toEqual(['finish'])
    })

    it('сумма по чеку в той же шторке — показанное «Списано» уходит снова, после неё (А9)', async () => {
      // the bread has no price: the sum is asked beside the account
      currentTrip.mockResolvedValue({
        ...trip([...handoff(), { id: BREAD, name: 'Хлеб' }]),
        accountId: roubles.id,
        debited: parseMoney('1100', 'RUB'),
      })
      const { view, queue } = await render()
      await askFinish(view)
      expect(row()?.textContent).toContain('Карта ₽')
      const sum = openSheets()[0]?.querySelector<HTMLInputElement>('input[data-field="receipt"]')
      if (!sum) throw new Error('нет поля суммы')
      sum.value = '12 400'
      sum.dispatchEvent(new Event('input'))
      await flushPromises()
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      // the sum takes «списано» off on the server: the account and the 1 100 shown go again after it
      expect(queue.pending.map((write) => write.kind)).toEqual(['receipt', 'payment', 'finish'])
      expect(queue.pending[1]).toMatchObject({
        body: { accountId: roubles.id, debited: parseMoney('1100', 'RUB') },
      })
    })

    it('«не должно сработать»: сумма по чеку, а поля «Списано» нет — его не возвращают (Р4-1)', async () => {
      // the record's own currency, «Списано» for a purchase in a third one: the sum takes it off, as on the server
      currentTrip.mockResolvedValue({
        ...trip([...handoff(), { id: BREAD, name: 'Хлеб' }]),
        accountId: card.id,
        debited: parseMoney('41000', 'AMD'),
      })
      const { view, queue } = await render()
      await askFinish(view)
      await typeSum('12 400')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.map((write) => write.kind)).toEqual(['receipt', 'finish'])
    })

    it('«не должно сработать»: сумма по чеку, а счёта записи телефон не знает — платежа нет (Р4-1)', async () => {
      localStorage.setItem(
        `molvia.accounts.${ME}`,
        JSON.stringify({ overview: moneyAccountsCodec.encode(page([cash, card])) }),
      )
      moneyAccounts.mockReturnValue(new Promise(() => undefined))
      currentTrip.mockResolvedValue({
        ...trip([...handoff(), { id: BREAD, name: 'Хлеб' }]),
        accountId: roubles.id,
        debited: parseMoney('1100', 'RUB'),
      })
      const { view, queue } = await render()
      await askFinish(view)
      await typeSum('15 000')
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.map((write) => write.kind)).toEqual(['receipt', 'finish'])
    })

    it('«Счета» читаются при «Закончить», а не при каждом открытии записи (Р1-2)', async () => {
      const { view } = await render()
      expect(moneyAccounts).not.toHaveBeenCalled()
      await askFinish(view)
      expect(moneyAccounts).toHaveBeenCalled()
    })

    it('«не должно сработать»: без счетов строки нет', async () => {
      moneyAccounts.mockResolvedValue(page([]))
      const { view, queue } = await render()
      await askFinish(view)
      expect(row()).toBeFalsy()
      inside(openSheets()[0] ?? null, ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.map((write) => write.kind)).toEqual(['finish'])
    })
  })

  describe('сумма по чеку (MOL-78)', () => {
    const openSheet = () => document.body.querySelector('dialog[open]')
    /** The handoff's two milks with a price, and bread without one. */
    const partly = (): Row[] => [...handoff(), { id: BREAD, name: 'Хлеб' }]
    const field = () => openSheet()?.querySelector<HTMLInputElement>('input[data-field="receipt"]')

    async function askFinish(view: VueWrapper): Promise<void> {
      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      clock += 1000
    }

    async function type(value: string): Promise<void> {
      const input = field()
      if (!input) throw new Error('нет поля суммы')
      input.value = value
      input.dispatchEvent(new Event('input'))
      await flushPromises()
    }

    it('у части покупок нет цены — «Закончить» спрашивает сумму, и она уходит перед завершением (В-4)', async () => {
      currentTrip.mockResolvedValue(trip(partly()))
      const { view, queue } = await render()
      await askFinish(view)
      expect(openSheet()?.textContent).toContain('Без цены 1 из 3')
      expect(openSheet()?.textContent).toContain(ru.trip.receipt.finish.label)

      await type('12 400')
      inside(openSheet(), ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.map((write) => write.kind)).toEqual(['receipt', 'finish'])
      expect(queue.pending[0]).toMatchObject({
        kind: 'receipt',
        tripId: TRIP,
        body: { receipt: parseMoney('12400', 'AMD') },
      })
    })

    it('поле пустое — закончить можно и без суммы', async () => {
      currentTrip.mockResolvedValue(trip(partly()))
      const { view, queue } = await render()
      await askFinish(view)
      inside(openSheet(), ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(queue.pending.map((write) => write.kind)).toEqual(['finish'])
    })

    it('ноль — не сумма: сказано у поля, и ничего не уходит', async () => {
      currentTrip.mockResolvedValue(trip(partly()))
      const { view, queue } = await render()
      await askFinish(view)
      await type('0')
      inside(openSheet(), ru.trip.finish_confirm.ok).click()
      await flushPromises()
      expect(openSheet()?.textContent).toContain(ru.spending.sheet.bad_amount)
      expect(queue.pending).toEqual([])
    })

    it('«не должно сработать»: цены у всех — поля нет; сумма уже есть — поля нет', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const first = await render()
      await askFinish(first.view)
      expect(field()).toBeFalsy()
      expect(openSheet()?.textContent).toContain(ru.trip.finish_confirm.body)
      first.view.unmount()
      mounted.pop()
      document.body.innerHTML = ''

      currentTrip.mockResolvedValue({ ...trip(partly()), receipt: parseMoney('12400', 'AMD') })
      const second = await render()
      await askFinish(second.view)
      expect(field()).toBeFalsy()
    })

    it('«+ Сумма по чеку» в итоге открывает шторку, «Сохранить» кладёт сумму в очередь', async () => {
      currentTrip.mockResolvedValue(trip(partly()))
      const { view, queue } = await render()
      await button(view, ru.trip.receipt.add).trigger('click')
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      clock += 1000
      expect(openSheet()?.textContent).toContain(ru.trip.receipt.sheet.title)
      await type('9870,50')
      inside(openSheet(), ru.trip.receipt.sheet.save).click()
      await flushPromises()
      expect(queue.pending).toEqual([
        { kind: 'receipt', tripId: TRIP, body: { receipt: parseMoney('9870.50', 'AMD') } },
      ])
      // Строкой в карточке итога, а кнопка под ней — уже «Изменить»: сумма в пути (MOL-206).
      expect(plain(view.get('.total').text())).toContain('Сумма по чеку 9 870,50 ֏ · отправляется')
      expect(view.get('.receipt').text()).toBe(ru.trip.receipt.edit)
      expect(view.get('.dock').text()).not.toContain('Сумма по чеку')
    })

    it('«Изменить сумму по чеку» открывает шторку на сумме, «Убрать сумму» кладёт null', async () => {
      currentTrip.mockResolvedValue({ ...trip(partly()), receipt: parseMoney('12400', 'AMD') })
      const { view, queue } = await render()
      await button(view, ru.trip.receipt.edit).trigger('click')
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      clock += 1000
      expect(field()?.value).toBe('12400')
      inside(openSheet(), ru.trip.receipt.sheet.remove).click()
      await flushPromises()
      expect(queue.pending).toEqual([{ kind: 'receipt', tripId: TRIP, body: { receipt: null } }])
      expect(view.get('.total').text()).toContain(ru.trip.receipt.removing)
      // Сумма уходит — под итогом снова «+ Сумма по чеку».
      expect(view.get('.receipt').text()).toBe(ru.trip.receipt.add)
    })

    it('у пустой записи суммы нет: «Закончить» предлагает записать тратой в «Деньгах» (В-1)', async () => {
      currentTrip.mockResolvedValue(trip())
      const { view, queue, router } = await render()
      expect(view.findAll('button').some((b) => b.text() === ru.trip.receipt.add)).toBe(false)
      await askFinish(view)
      inside(openSheet(), ru.trip.remove.empty.spending).click()
      await flushPromises()
      expect(queue.pending).toEqual([{ kind: 'delete', tripId: TRIP }])
      for (let step = 0; step < 20 && router.currentRoute.value.name !== 'money'; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        await flushPromises()
      }
      expect(router.currentRoute.value.name).toBe('money')
      // «Деньги» took what was handed over and opened the sheet on it.
      expect(useSpendingHandoffStore().handed).toBeNull()
    })
  })

  describe('удалить поход (MOL-76)', () => {
    const openSheet = () => document.body.querySelector('dialog[open]')

    it('пустой уходит сразу, без вопроса, и на главной стоит «Вернуть»', async () => {
      currentTrip.mockResolvedValue(trip())
      const { view, queue } = await render()

      await button(view, ru.trip.remove.action).trigger('click')
      await flushPromises()

      expect(openSheet()).toBeNull()
      expect(queue.pending).toEqual([{ kind: 'delete', tripId: TRIP }])
      expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
      expect(view.get('.undo-place').text()).toContain('Запись удалена: Ереван Сити')

      await button(view, ru.trip.remove.restore).trigger('click')
      await flushPromises()
      // Удаление ещё не ушло: «Вернуть» снимает его, и запись снова первой строкой «Покупок».
      expect(queue.pending.some((write) => write.kind === 'delete')).toBe(false)
      expect(view.text()).toContain(ru.purchases.continue)
    })

    it('с покупками — сначала вопрос: место, день и число позиций, ждущие тоже', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000041'))
      await flushPromises()

      await button(view, ru.trip.remove.action).trigger('click')
      await flushPromises()
      const sheet = openSheet()
      expect(sheet?.textContent).toContain(ru.trip.remove.sheet.title)
      expect(sheet?.textContent).toContain('Ереван Сити')
      expect(sheet?.textContent).toContain('3 позиции')
      expect(queue.pending.some((write) => write.kind === 'delete')).toBe(false)

      // The sheet may come up a task after the tap, and it takes no tap until it has (MOL-69).
      await new Promise((resolve) => setTimeout(resolve, 0))
      clock += 1000
      inside(sheet, ru.trip.remove.action).click()
      await flushPromises()
      expect(queue.pending).toEqual([{ kind: 'delete', tripId: TRIP }])
      expect(view.get('.dock').text()).toContain(ru.purchases.manual_by_hand)
    })

    it('«Завершить» у пустого похода предлагает удалить, а завершить — вторым (В-2)', async () => {
      currentTrip.mockResolvedValue(trip())
      const { view, queue } = await render()

      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      const sheet = openSheet()
      expect(sheet?.textContent).toContain(ru.trip.remove.empty.title)
      expect(sheet?.textContent).toContain(ru.trip.remove.empty.finish)

      await new Promise((resolve) => setTimeout(resolve, 0))
      clock += 1000
      inside(sheet, ru.trip.remove.action).click()
      await flushPromises()
      expect(queue.pending).toEqual([{ kind: 'delete', tripId: TRIP }])
    })

    it('у похода с покупками «Завершить» спрашивает как раньше', async () => {
      currentTrip.mockResolvedValue(trip(handoff()))
      const { view } = await render()
      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      expect(openSheet()?.textContent).toContain(ru.trip.finish_confirm.title)
      expect(openSheet()?.textContent).not.toContain(ru.trip.remove.empty.finish)
    })

    it('поход не вернулся — плашка называет его и причину', async () => {
      currentTrip.mockResolvedValue(null)
      const { view, queue } = await render()
      queue.rejected = [
        {
          key: 'r1',
          write: { kind: 'restore', tripId: TRIP, name: 'Ереван Сити' },
          code: ERROR.TRIP_OPEN,
        },
      ]
      await flushPromises()
      expect(view.text()).toContain('Запись не вернулась: Ереван Сити')
      expect(view.text()).toContain(ru.trip.remove.not_restored_open)
    })

    // MOL-254: the same receipt recorded again by a new shot — not «ten minutes are over»
    it.each([
      [ERROR.RECEIPT_RECORDED_BEFORE, ru.trip.remove.not_restored_recorded],
      [ERROR.NOT_FOUND, ru.trip.remove.not_restored_gone],
    ])('поход не вернулся с %s — своя причина', async (code, reason) => {
      currentTrip.mockResolvedValue(null)
      const { view, queue } = await render()
      queue.rejected = [
        { key: 'r1', write: { kind: 'restore', tripId: TRIP, name: 'Ереван Сити' }, code },
      ]
      await flushPromises()
      expect(view.text()).toContain('Запись не вернулась: Ереван Сити')
      expect(view.text()).toContain(reason)
    })

    it('новый поход убирает полоску «Вернуть» (Р-4)', async () => {
      currentTrip.mockResolvedValue(trip())
      const { view, queue } = await render()
      await button(view, ru.trip.remove.action).trigger('click')
      await flushPromises()
      expect(queue.lastRemoved?.tripId).toBe(TRIP)

      queue.enqueue({
        kind: 'start',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000051',
        place: { kind: 'store', name: 'Рынок' },
        startedAt: new Date(),
      })
      await flushPromises()
      expect(queue.lastRemoved).toBeNull()
      expect(view.text()).not.toContain('Запись удалена')
    })
  })
  describe('удалить поход: замечания ревью (MOL-76)', () => {
    const LAST = 'bbbbbbbb-0000-4000-8000-000000000061'
    const single: TripHistory = {
      trips: [
        {
          id: LAST,
          place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'SAS' },
          startedAt: new Date('2026-09-26T10:00:00Z'),
          finishedAt: new Date('2026-09-26T10:30:00Z'),
          finishedOnDeviceAt: null,
          itemCount: null,
          total: null,
          fromReceipt: false,
        },
      ],
      nextCursor: null,
    }

    it('удалён единственный поход истории — главная встречает знакомством, а не скелетом (А5)', async () => {
      tripHistory.mockResolvedValueOnce(single)
      const { view, queue } = await render()
      expect(view.findAll('.recorded .list-row')).toHaveLength(1)

      tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
      removeTrip.mockResolvedValue(undefined)
      queue.removeTrip(LAST, 'SAS')
      await flushPromises()

      expect(tripHistory).toHaveBeenCalledTimes(2)
      expect(view.find('.skeleton').exists()).toBe(false)
      expect(view.text()).toContain(ru.purchases.empty.title)
    })

    it('полоска считает десять секунд от удаления, а не от экрана (Р-1)', async () => {
      const { view, queue } = await render()
      // Без удаления места «Вернуть» на «Покупках» нет вовсе (MOL-179, Р-7).
      expect(view.find('.undo-place').exists()).toBe(false)
      queue.lastRemoved = {
        tripId: LAST,
        name: 'SAS',
        writes: [],
        refusals: [],
        stamp: Date.now() - 4_000,
      }
      await flushPromises()
      expect(view.get('.undo-place .count').text()).toBe('6')
    })

    it('истёкшая, пока её не было на экране, не показывается и забывается (Р-1)', async () => {
      const { view, queue } = await render()
      queue.lastRemoved = {
        tripId: LAST,
        name: 'SAS',
        writes: [],
        refusals: [],
        stamp: Date.now() - 11_000,
      }
      await flushPromises()
      expect(view.text()).not.toContain('Запись удалена')
      expect(queue.lastRemoved).toBeNull()
    })

    it('покупки не вернувшегося похода не обещаны «уйдут со связью» (раунд 2, Б1)', async () => {
      localStorage.setItem(
        `molvia.trip-rejected.${ME}`,
        JSON.stringify([
          {
            key: 'r1',
            write: { kind: 'restore', tripId: TRIP, name: 'Ереван Сити' },
            code: ERROR.NOT_FOUND,
          },
        ]),
      )
      const { view, queue } = await render()
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000071'))
      queue.enqueue(queued('eeeeeeee-0000-4000-8000-000000000072'))
      await flushPromises()
      expect(view.text()).toContain('Запись не вернулась: Ереван Сити')
      expect(view.text()).toContain('в ней 2 покупки')
      expect(view.text()).not.toContain('ещё не отправлен')
      expect(addExpense).not.toHaveBeenCalled()
    })

    it('отказ «Вернуть» единственного похода истории — главная перечитывает историю (раунд 2, Б2)', async () => {
      tripHistory.mockResolvedValueOnce(single)
      const { view, queue } = await render()
      expect(view.findAll('.recorded .list-row')).toHaveLength(1)

      let land: () => void = () => undefined
      removeTrip.mockReturnValueOnce(
        new Promise((resolve) => {
          land = () => {
            resolve()
          }
        }),
      )
      restoreTrip.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, undefined, true))
      tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
      const undo = queue.removeTrip(LAST, 'SAS')
      await flushPromises()
      queue.restoreTrip(undo)
      land()
      await flushPromises()

      expect(queue.rejected.map((item) => item.write.kind)).toEqual(['restore'])
      expect(tripHistory).toHaveBeenCalledTimes(2)
      expect(view.find('.skeleton').exists()).toBe(false)
      expect(view.text()).toContain(ru.purchases.empty.title)
    })

    it('единственная строка ждёт удаления — «Завершить» тоже зовёт поход пустым (Р-5)', async () => {
      currentTrip.mockResolvedValue(trip(handoff().slice(0, 1)))
      const { view, queue } = await render()
      queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: ASHKHAR })
      await flushPromises()

      await docked(view, ru.trip.finish).trigger('click')
      await flushPromises()
      expect(document.body.querySelector('dialog[open]')?.textContent).toContain(
        ru.trip.remove.empty.title,
      )
    })
  })
})
