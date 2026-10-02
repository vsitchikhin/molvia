import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parseMoney, parseQuantity, tripViewCodec } from '@molvia/model'
import type {
  CatalogueEntry,
  OwnPricesQuery,
  OwnPricesResponse,
  TripExpenseView,
  TripView,
} from '@molvia/model'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useTripStore } from '@/stores/trip'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'

// Every write fails as a dropped connection would, so what the sheet queued stays to be read.
const offline = vi.hoisted(() => () => Promise.reject(new Error('Failed to fetch')))
const currentTrip = vi.hoisted(() => vi.fn<() => Promise<unknown>>())
const readTrip = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>())
const detachBarcode = vi.hoisted(() => vi.fn<(itemId: string, code: string) => Promise<void>>())
const ownPrices = vi.hoisted(() => vi.fn<(query: OwnPricesQuery) => Promise<OwnPricesResponse>>())
vi.mock('@/api', async () => {
  const { ApiError } = await import('@molvia/client')
  const { ERROR } = await import('@molvia/model')
  const fail = () =>
    offline().catch((error: unknown) => {
      throw new ApiError(ERROR.INTERNAL, String(error))
    })
  return {
    api: {
      addExpense: fail,
      updateExpense: fail,
      removeExpense: fail,
      detachBarcode,
      ownPrices: (query: OwnPricesQuery) => ownPrices(query),
      currentTrip,
      trip: (id: string) => readTrip(id),
    },
  }
})

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'

const milk: CatalogueEntry = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  kind: 'product',
  name: 'Молоко «Ашхар»',
  note: 'ультрапастеризованное, 2,5%',
  defaultUnit: 'l',
  typicalQuantity: null,
}

function trip(rate: string | null = null): TripView {
  return tripViewCodec.parse({
    id: TRIP,
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate: rate && {
      base: 'RUB',
      quote: 'AMD',
      rate,
      source: 'official',
      asOf: '2026-09-19T00:00:00.000Z',
    },
    rateProvider: rate && 'cba',
    rateJump: null,
    rateStale: false,
    place: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'store',
      name: 'Ереван Сити',
    },
    expenses: [],
    total: [],
    converted: null,
  })
}

let clock = 0
let pinia: Pinia

beforeEach(() => {
  // Both shelves: storage.ts writes to each, and reads the second where the first has nothing.
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('molvia.actor', ME)
  pinia = createPinia()
  setActivePinia(pinia)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  currentTrip.mockReset()
  currentTrip.mockResolvedValue(null)
  readTrip.mockReset()
  readTrip.mockRejectedValue(new Error('Failed to fetch'))
  ownPrices.mockReset()
  ownPrices.mockRejectedValue(new Error('Failed to fetch'))
})

afterEach(() => {
  vi.restoreAllMocks()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

interface Options {
  readonly entry?: CatalogueEntry
  readonly query?: string | null
  readonly expense?: TripExpenseView | null
  readonly closeSteps?: 1 | 2
  readonly trip?: TripView | null
  /** What `GET /trips/current` answers; the trip in memory unless said otherwise. */
  readonly server?: TripView | null | 'down'
  readonly locale?: 'ru' | 'en'
  readonly selected?: TripView
  readonly code?: string
}

async function router() {
  const made = createRouter({ history: createMemoryHistory(), routes })
  await made.push('/')
  await made.push('/trip/add')
  return made
}

async function render(options: Options = {}) {
  if (options.trip !== null) useTripStore().apply(options.trip ?? trip())
  // The sheet asks the server every time it opens; unless a test says otherwise, the server
  // agrees with the memory.
  if (options.server === 'down') currentTrip.mockRejectedValue(new Error('Failed to fetch'))
  else {
    const memory = options.trip === undefined ? trip() : options.trip
    currentTrip.mockResolvedValue(options.server === undefined ? memory : options.server)
  }
  const made = await router()
  const go = vi.spyOn(made, 'go')

  const view = mount(ItemDetailsSheet, {
    props: {
      ...(options.selected ? { tripId: options.selected.id, tripContext: options.selected } : {}),
      entry: options.entry ?? milk,
      query: options.query ?? null,
      expense: options.expense ?? null,
      closeSteps: options.closeSteps ?? 1,
      code: options.code ?? null,
    },
    attachTo: document.body,
    global: { plugins: [made, pinia, createAppI18n(options.locale ?? 'ru')] },
  })
  // Past the moment the sheet rises: until then it takes no tap at all.
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { view, go, queue: useTripQueueStore() }
}

function input(view: VueWrapper, field: 'quantity' | 'amount') {
  return view.get(`[data-field="${field}"]`)
}

async function type(view: VueWrapper, field: 'quantity' | 'amount', value: string) {
  await input(view, field).setValue(value)
}

async function pickUnit(view: VueWrapper, unit: 'kg' | 'l' | 'piece') {
  await view.get(`input[type="radio"][value="${unit}"]`).setValue(true)
}

function button(view: VueWrapper, text: string) {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`no button «${text}»`)
  return found
}

const perUnit = (view: VueWrapper) =>
  view
    .get('.per-unit-value')
    .text()
    .replace(/[\s\u00a0\u202f]/g, '')

describe('ItemDetailsSheet', () => {
  it('uses the selected completed trip currency and rate, never the active trip', async () => {
    const selected = {
      ...trip('400'),
      id: 'bbbbbbbb-0000-4000-8000-000000000009',
      finishedAt: new Date('2026-09-19T09:00:00Z'),
    }
    const active = { ...trip(), currency: 'EUR' as const }
    const { view, queue } = await render({ trip: active, selected })
    await type(view, 'quantity', '1')
    await type(view, 'amount', '800')
    expect(perUnit(view)).toBe('800,00֏/л')
    expect(view.text().replace(/\s/g, ' ')).toContain('≈ 2 ₽')
    await button(view, 'Записать').trigger('click')
    const write = queue.pending.find((row) => row.kind === 'add')
    expect(write?.tripId).toBe(selected.id)
    expect(write?.body.amount?.currency).toBe('AMD')
    expect(useTripStore().current?.id).toBe(TRIP)
  })

  it('opens on the item, with nothing to show per unit yet', async () => {
    const { view } = await render()
    expect(view.get('dialog').element.open).toBe(true)
    expect(view.text()).toContain('Молоко «Ашхар»')
    expect(view.text()).toContain('ультрапастеризованное, 2,5%')
    expect(perUnit(view)).toBe('—')
    expect(view.text()).toContain('Считается само, вводить не надо')
  })

  it.each([
    ['570', '1', 'l', '570,00֏/л'],
    ['520', '0,9', 'l', '577,78֏/л'],
    ['5 403,12', '1,128', 'kg', '4790,00֏/кг'],
    ['250', '1', 'piece', '250,00֏/шт'],
  ] as const)('%s ֏ for %s %s shows %s', async (price, qty, unit, shown) => {
    const { view } = await render()
    await pickUnit(view, unit)
    await type(view, 'quantity', qty)
    await type(view, 'amount', price)
    expect(perUnit(view)).toBe(shown)
    expect(view.get('.per-unit').text()).not.toContain('AMD')
  })

  it('recomputes the moment the unit changes', async () => {
    const { view } = await render()
    await type(view, 'quantity', '2')
    await type(view, 'amount', '500')
    expect(perUnit(view)).toBe('250,00֏/л')
    await pickUnit(view, 'kg')
    expect(perUnit(view)).toBe('250,00֏/кг')
  })

  it('shows the error of half a piece at once, under the field', async () => {
    const { view } = await render()
    await type(view, 'quantity', '0,5')
    await pickUnit(view, 'piece')
    await nextTick()
    expect(view.text()).toContain('Это не похоже на количество')
    expect(perUnit(view)).toBe('—')
  })

  it('adds the item alone when nothing else is filled in, with the query it was found by', async () => {
    const { view, queue } = await render({ query: 'мол' })
    await button(view, 'Записать').trigger('click')

    expect(queue.pending).toHaveLength(1)
    const [write] = queue.pending
    expect(write).toMatchObject({ kind: 'add', tripId: TRIP, entry: milk })
    if (write?.kind !== 'add') return
    expect(write.body).toEqual({ id: expect.any(String), itemId: milk.id, query: 'мол' })
    expect(view.emitted('added')).toEqual([[milk]])
  })

  it('adds the quantity and the price, and closes the sheet and the search under it', async () => {
    const { view, queue, go } = await render({ closeSteps: 2 })
    await type(view, 'quantity', '0,9')
    await type(view, 'amount', '520')
    await button(view, 'Записать').trigger('click')

    const [write] = queue.pending
    if (write?.kind !== 'add') throw new Error('no add queued')
    expect(write.body.quantity).toEqual(parseQuantity('0.9', 'l'))
    expect(write.body.amount).toEqual(parseMoney('520', 'AMD'))
    expect(go).toHaveBeenCalledWith(-2)
  })

  it('does not send what was typed as a price and is not one (В-5)', async () => {
    const { view, queue } = await render()
    await type(view, 'amount', '57о')
    await button(view, 'Записать').trigger('click')

    expect(queue.pending).toEqual([])
    expect(view.text()).toContain('Это не похоже на сумму')
    expect(document.activeElement).toBe(input(view, 'amount').element)
    expect(view.emitted('added')).toBeUndefined()
  })

  it('queues one purchase for a double tap', async () => {
    const { view, queue } = await render()
    const add = button(view, 'Записать')
    await add.trigger('click')
    await add.trigger('click')
    expect(queue.pending).toHaveLength(1)
  })

  it('writes nothing when closed with ×', async () => {
    const { view, queue } = await render()
    await type(view, 'amount', '520')
    await button(view, '').trigger('click')
    expect(queue.pending).toEqual([])
    expect(view.emitted('added')).toBeUndefined()
  })

  it('says, without red, that the purchase stays on the phone when there is no connection', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { view } = await render()
    const note = view.get('.offline')
    expect(note.text()).toBe('Сохранится на телефоне, отправим со связью')

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(view.find('.offline').exists()).toBe(false)
  })

  it('asks the server for the trip when it has none in memory', async () => {
    const { view } = await render({ trip: null, server: trip() })
    await vi.waitFor(() => {
      expect(view.findAll('button').some((b) => b.text() === 'Записать')).toBe(true)
    })
    expect(currentTrip).toHaveBeenCalledTimes(1)
  })

  it('asks the server even when it remembers a trip, and the answer wins', async () => {
    // Finished on another device: the memory would otherwise take purchases for ever (Р-2).
    const { view } = await render({ server: null })
    expect(currentTrip).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(view.text()).toContain('Сначала начните запись')
    })
  })

  it('asks about the current trip when a refusal being corrected names an older one', async () => {
    // «Исправить» on «Поход» carries the trip that refused the purchase, and that trip is not
    // the one going on. Asked through the history, the sheet put the selected trip out and
    // skipped the very check the branch exists for (А5). Only a screen handing the sheet a trip
    // of its own — the finished one — reads through the history.
    const older = 'bbbbbbbb-0000-4000-8000-000000000099'
    const history = useTripHistoryStore()
    history.selected = { ...trip(), id: TRIP, finishedAt: new Date('2026-09-19T09:00:00.000Z') }
    const view = mount(ItemDetailsSheet, {
      props: {
        entry: milk,
        tripId: older,
        retry: {
          id: 'eeeeeeee-0000-4000-8000-000000000001',
          quantity: null,
          amount: null,
          query: null,
        },
        closeSteps: 1,
      },
      attachTo: document.body,
      global: { plugins: [await router(), pinia, createAppI18n('ru')] },
    })
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(currentTrip).toHaveBeenCalledTimes(1)
    expect(readTrip).not.toHaveBeenCalled()
    expect(history.selected.id).toBe(TRIP)
    view.unmount()
  })

  it('keeps the trip it remembers when the server cannot be asked', async () => {
    const { view } = await render({ server: 'down' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(view.text()).toContain('Записать')
  })

  it('asks for a trip first when there is none, and leads back to it (В-6)', async () => {
    const { view, go, queue } = await render({ trip: null, closeSteps: 2 })
    expect(view.text()).toContain('Сначала начните запись')
    expect(view.findAll('button').some((b) => b.text() === 'Записать')).toBe(false)
    await button(view, 'К покупкам').trigger('click')
    expect(go).toHaveBeenCalledWith(-2)
    expect(queue.pending).toEqual([])
  })

  // MOL-22, Р-2: у полки без сети поход есть — он лежит в очереди стартом. Шторка, которая
  // смотрит только в ответ сервера, отправила бы человека «сначала начать поход» посреди похода.
  it('пишет в поход, начатый без сети, — по его телефонному id', async () => {
    const own = 'bbbbbbbb-0000-4000-8000-000000000042'
    const queue = useTripQueueStore()
    queue.enqueue({
      kind: 'start',
      tripId: own,
      place: { kind: 'store', name: 'Рынок' },
      startedAt: new Date('2026-09-19T12:00:00.000Z'),
    })
    const { view } = await render({ trip: null, server: null })

    expect(view.text()).not.toContain('Сначала начните запись')
    await type(view, 'amount', '520')
    await button(view, 'Записать').trigger('click')

    const written = queue.pending.filter((write) => write.kind === 'add')
    expect(written).toHaveLength(1)
    expect(written[0]?.tripId).toBe(own)
  })

  it('refuses, under the field, a price the trip could not add to what is queued (A9)', async () => {
    const first = await render()
    await type(first.view, 'amount', '50 000 000 000 000 000')
    await button(first.view, 'Записать').trigger('click')
    // Its own purchase, once queued, is not counted against it while the sheet goes.
    expect(first.view.text()).not.toContain('Это не похоже на сумму')
    expect(first.queue.pending).toHaveLength(1)

    const second = await render()
    await type(second.view, 'amount', '50 000 000 000 000 000')
    await button(second.view, 'Записать').trigger('click')
    expect(second.view.text()).toContain('Это не похоже на сумму')
    expect(second.queue.pending).toHaveLength(1)
  })

  it('with a receipt sum, a price must fit beside the prices, not beside the receipt (MOL-78, A9)', async () => {
    const withReceipt = (prices: string): TripView => ({
      ...trip(),
      total: [parseMoney('100', 'AMD')],
      receipt: parseMoney('100', 'AMD'),
      prices: [parseMoney(prices, 'AMD')],
    })
    // The receipt is small, the prices are near what money holds: the prices are what it adds to.
    const full = await render({ trip: withReceipt('90 000 000 000 000 000') })
    await type(full.view, 'amount', '5 000 000 000 000 000')
    await button(full.view, 'Записать').trigger('click')
    expect(full.view.text()).toContain('Это не похоже на сумму')
    expect(full.queue.pending).toHaveLength(0)
  })

  describe('the estimate in roubles (В-7)', () => {
    it('shows the package in the income currency by the rate of the trip', async () => {
      const { view } = await render({ trip: trip('4.82') })
      await type(view, 'quantity', '0,9')
      await type(view, 'amount', '520')
      expect(view.text()).toContain('≈')
      // 520 / 4,82 = 107,88 ₽, and an estimate is whole roubles («Валюты»).
      expect(view.text()).toMatch(/≈\s108\s₽/)
      expect(view.text()).not.toContain('107,88')
      expect(view.text()).toContain('пересчёт приблизительный')
    })

    it('shows it with no quantity yet — the price of the package is enough (A6)', async () => {
      const { view } = await render({ trip: trip('4.82') })
      await type(view, 'amount', '520')
      expect(perUnit(view)).toBe('—')
      expect(view.text()).toMatch(/≈\s108\s₽/)
    })

    it('does not say the comparison is in drams — the price may be in any currency (A8)', async () => {
      const { view } = await render({ trip: trip('4.82') })
      await type(view, 'amount', '520')
      expect(view.text()).not.toContain('в драмах')
      expect(view.text()).toContain('по цене на ценнике')
    })

    it('shows none for a price in another currency, and prices it per unit in that one', async () => {
      const { view } = await render({ trip: trip('4.82') })
      await view.get('select').setValue('RUB')
      await type(view, 'quantity', '0,25')
      await pickUnit(view, 'kg')
      await type(view, 'amount', '390')
      expect(perUnit(view)).toBe('1560,00₽/кг')
      expect(view.text()).not.toContain('≈')
    })
  })

  describe('amending a row (В-3)', () => {
    const row: TripExpenseView = {
      id: 'cccccccc-0000-4000-8000-000000000001',
      createdAt: new Date('2026-09-19T08:10:00.000Z'),
      item: milk,
      quantity: parseQuantity('0.35', 'kg'),
      amount: parseMoney('1540', 'AMD'),
      unitPrice: null,
    }

    it('opens with the row, and saves only what changed', async () => {
      const { view, queue } = await render({ expense: row })
      expect((input(view, 'quantity').element as HTMLInputElement).value).toBe('0,35')
      expect(perUnit(view)).toBe('4400,00֏/кг')

      await type(view, 'amount', '1600')
      await button(view, 'Сохранить').trigger('click')
      expect(queue.pending).toEqual([
        {
          kind: 'update',
          tripId: TRIP,
          expenseId: row.id,
          patch: { amount: { minor: 160000n, currency: 'AMD' } },
        },
      ])
      expect(view.emitted('saved')).toHaveLength(1)
    })

    it('closes without a write when nothing changed', async () => {
      const { view, queue } = await render({ expense: row })
      await button(view, 'Сохранить').trigger('click')
      expect(queue.pending).toEqual([])
      expect(view.emitted('saved')).toBeUndefined()
    })

    it('removes the row without asking again', async () => {
      const { view, queue } = await render({ expense: row })
      await button(view, 'Удалить позицию').trigger('click')
      expect(queue.pending).toEqual([{ kind: 'remove', tripId: TRIP, expenseId: row.id }])
      expect(view.emitted('removed')).toHaveLength(1)
    })
  })

  it('writes the English interface with its own point', async () => {
    const { view } = await render({ locale: 'en' })
    await type(view, 'quantity', '0.9')
    await type(view, 'amount', '520')
    expect(perUnit(view)).toMatch(/577\.78.*\/l$/)
  })
})

describe('«не этот товар?» (MOL-100)', () => {
  it('must not be offered for an item that did not come by a code', async () => {
    const { view } = await render()

    expect(view.text()).toContain('Молоко «Ашхар»')
    expect(view.text()).not.toMatch(/не этот товар/)
  })

  it('keeps the sheet and says so when the code could not be let go', async () => {
    detachBarcode.mockRejectedValue(new Error('Failed to fetch'))
    const { view } = await render({ code: '4850001234562' })

    const line = view
      .findAll('button')
      .find((button) => button.text() === 'Код 4850001234562 — не этот товар?')
    await line?.trigger('click')
    await nextTick()
    // Asked before it is done (review Ж): the question, then «Отвязать».
    expect(view.text()).toContain('Отвязать код 4850001234562 от «Молоко «Ашхар»»?')
    await view
      .findAll('button')
      .find((button) => button.text() === 'Отвязать')
      ?.trigger('click')
    await flushPromises()

    expect(detachBarcode).toHaveBeenCalledWith(milk.id, '4850001234562')
    expect(view.text()).toContain('Не получилось отвязать код — проверьте связь')
    expect(view.get('dialog').element.open).toBe(true)
    expect(view.emitted('detached')).toBeUndefined()
  })

  it('lets nothing go on the first tap, and «Отменить» takes the question back', async () => {
    const { view } = await render({ code: '4850001234562' })

    await view
      .findAll('button')
      .find((button) => button.text() === 'Код 4850001234562 — не этот товар?')
      ?.trigger('click')
    await nextTick()
    await view
      .findAll('button')
      .find((button) => button.text() === 'Отменить')
      ?.trigger('click')
    await nextTick()

    expect(detachBarcode).not.toHaveBeenCalled()
    expect(view.text()).not.toContain('Отвязать код')
    expect(view.text()).toContain('Код 4850001234562 — не этот товар?')
    // Back on the line that asked, inside the sheet — not the body (adversarial О).
    expect(document.activeElement?.textContent.trim()).toBe('Код 4850001234562 — не этот товар?')
  })

  it('asks with «Отменить» in focus, and «Отвязать» is not the filled button (review Л)', async () => {
    const { view } = await render({ code: '4850001234562' })

    await view
      .findAll('button')
      .find((button) => button.text() === 'Код 4850001234562 — не этот товар?')
      ?.trigger('click')
    await nextTick()
    await nextTick()

    expect(document.activeElement?.textContent.trim()).toBe('Отменить')
    const detach = view.findAll('button').find((button) => button.text() === 'Отвязать')
    expect(detach?.classes()).toContain('danger-ghost')
  })
})

describe('ItemDetailsSheet · «Тут дешевле» (MOL-92)', () => {
  const ZOVUNI = 'cccccccc-0000-4000-8000-000000000001'
  const HERE = 'aaaaaaaa-0000-4000-8000-000000000001'
  const MARIANNA = 'dddddddd-0000-4000-8000-000000000002'
  const litre = (amount: number) => ({
    scaledMinor: BigInt(amount) * 100_000_000n,
    currency: 'AMD' as const,
    unit: 'l' as const,
  })
  const place = (placeId: string, amount: number, day = '2026-09-12') => ({
    placeId,
    name: placeId === ZOVUNI ? 'Зовуни' : 'Ереван Сити',
    unitPrice: litre(amount),
    day,
    observations: 1,
  })
  const history = (
    places = [place(ZOVUNI, 540)],
    alternatives: Extract<OwnPricesResponse, { level: 'take' }>['alternatives'] = [],
  ): OwnPricesResponse => ({ itemId: milk.id, level: 'take', rating: '4.0', places, alternatives })

  function inErevan() {
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({
        settings: { country: 'AM', city: 'Ереван', spendCurrency: 'AMD', incomeCurrency: 'RUB' },
        updatedAt: '2026-09-19T08:00:00.000Z',
      }),
    )
  }

  const hint = (view: VueWrapper, which: 'item' | 'alternative' = 'item') =>
    view.find(`[data-hint="${which}"]`)
  const spaced = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')

  async function priced(answer: OwnPricesResponse, options: Options = {}) {
    inErevan()
    ownPrices.mockResolvedValue(answer)
    const rendered = await render(options)
    await flushPromises()
    return rendered
  }

  it('asks for the item in the record’s city, and names the cheapest place before a price is typed (В-1)', async () => {
    const { view } = await priced(history())

    expect(ownPrices).toHaveBeenCalledWith({ item: milk.id, country: 'AM', city: 'Ереван' })
    expect(hint(view).classes()).toContain('hint-best')
    expect(spaced(hint(view).text())).toBe('Дешевле всего брали в Зовуни — 540,00 ֏/л, 12.09')
  })

  it('says where it was cheaper once a dearer price is typed — the example of the task', async () => {
    const { view } = await priced(history())
    await type(view, 'quantity', '1')
    await type(view, 'amount', '620')

    expect(hint(view).classes()).toContain('hint-there')
    expect(spaced(hint(view).text())).toBe('В Зовуни брали по 540,00 ֏/л — 12.09')
  })

  it('says «как в …» at the same price and «тут дешевле» below it (В-2)', async () => {
    const { view } = await priced(history())
    await type(view, 'quantity', '1')
    await type(view, 'amount', '540')
    expect(hint(view).classes()).toContain('hint-same')

    await type(view, 'amount', '510')
    expect(hint(view).classes()).toContain('hint-cheaper')
    expect(spaced(hint(view).text())).toBe('Тут дешевле — в Зовуни было 540,00 ֏/л, 12.09')
  })

  it('says «здесь же» when the record’s own place was the cheapest (Р-3)', async () => {
    const { view } = await priced(history([place(HERE, 600, '2026-09-03')]))
    await type(view, 'quantity', '1')
    await type(view, 'amount', '650')

    expect(spaced(hint(view).text())).toBe('Здесь же брали по 600,00 ֏/л — 03.09')
  })

  it('names a cheaper item of the kind rated no worse, second (В-3)', async () => {
    const marianna = {
      itemId: MARIANNA,
      name: 'Молоко Марианна',
      level: 'take' as const,
      rating: '4.5',
      places: [place(ZOVUNI, 480, '2026-09-28')],
    }
    const { view } = await priced(history([place(ZOVUNI, 540)], [marianna]))
    await type(view, 'quantity', '1')
    await type(view, 'amount', '620')

    expect(spaced(hint(view, 'alternative').text())).toBe(
      'Молоко Марианна — 480,00 ֏/л в Зовуни, 28.09 · оценка 4,5',
    )
  })

  it('says nothing of «не брать нигде» (Т-3)', async () => {
    const { view } = await priced({ itemId: milk.id, level: 'never' })
    await type(view, 'quantity', '1')
    await type(view, 'amount', '620')

    expect(view.find('.hint').exists()).toBe(false)
  })

  it('stands under the fields, inside the box of the figure (В-6, Т-7)', async () => {
    const { view } = await priced(history())
    const order = view.findAll('[data-field], [data-hint]').map((node) => {
      const field = node.attributes('data-field')
      return field ?? `hint:${node.attributes('data-hint') ?? ''}`
    })

    expect(order).toEqual(['quantity', 'amount', 'hint:item'])
    expect(hint(view).element.closest('.per-unit-box')).not.toBeNull()
  })

  it('shows the answer remembered for this item and city with no signal, asking nothing (В-5)', async () => {
    const first = await priced(history())
    first.view.unmount()
    ownPrices.mockClear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const { view } = await render()
    await flushPromises()

    expect(ownPrices).not.toHaveBeenCalled()
    expect(hint(view).classes()).toContain('hint-best')
  })

  it('shows nothing with no signal and nothing remembered — never a loading or an error (Т-5)', async () => {
    inErevan()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { view } = await render()
    await flushPromises()

    expect(view.find('.hint').exists()).toBe(false)
  })

  it('keeps the remembered answer when the server fails', async () => {
    const first = await priced(history())
    first.view.unmount()
    ownPrices.mockRejectedValue(new Error('Failed to fetch'))

    const { view } = await render()
    await flushPromises()

    expect(hint(view).exists()).toBe(true)
  })

  it('leaves the row being amended out, and never answers it from memory (Т-9)', async () => {
    const first = await priced(history())
    first.view.unmount()
    ownPrices.mockClear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const expense: TripExpenseView = {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      createdAt: new Date('2026-09-19T08:10:00.000Z'),
      item: milk,
      quantity: parseQuantity('1', 'l'),
      amount: parseMoney('540', 'AMD'),
      unitPrice: null,
    }

    const { view } = await render({ expense })
    await flushPromises()
    expect(view.find('.hint').exists()).toBe(false)

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    ownPrices.mockResolvedValue(history([]))
    const online = await render({ expense })
    await flushPromises()
    expect(ownPrices).toHaveBeenLastCalledWith({
      item: milk.id,
      country: 'AM',
      city: 'Ереван',
      except: expense.id,
    })
    expect(online.view.find('.hint').exists()).toBe(false)
  })
})
