import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parseMoney, parseQuantity, tripViewCodec } from '@molvia/model'
import type { CatalogueEntry, TripExpenseView, TripView } from '@molvia/model'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'

// Every write fails as a dropped connection would, so what the sheet queued stays to be read.
const offline = vi.hoisted(() => () => Promise.reject(new Error('Failed to fetch')))
const currentTrip = vi.hoisted(() => vi.fn<() => Promise<unknown>>())
vi.mock('@/api', async () => {
  const { ApiError } = await import('@molvia/client')
  const { ERROR } = await import('@molvia/model')
  const fail = () =>
    offline().catch((error: unknown) => {
      throw new ApiError(ERROR.INTERNAL, String(error))
    })
  return {
    api: { addExpense: fail, updateExpense: fail, removeExpense: fail, currentTrip },
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
    rateJump: null,
    rateStale: false,
    place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
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
  readonly locale?: 'ru' | 'en'
}

async function render(options: Options = {}) {
  if (options.trip !== null) useTripStore().apply(options.trip ?? trip())
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.push('/trip/add')
  const go = vi.spyOn(router, 'go')

  const view = mount(ItemDetailsSheet, {
    props: {
      entry: options.entry ?? milk,
      query: options.query ?? null,
      expense: options.expense ?? null,
      closeSteps: options.closeSteps ?? 1,
    },
    attachTo: document.body,
    global: { plugins: [router, pinia, createAppI18n(options.locale ?? 'ru')] },
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
    await button(view, 'Добавить в поход').trigger('click')

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
    await button(view, 'Добавить в поход').trigger('click')

    const [write] = queue.pending
    if (write?.kind !== 'add') throw new Error('no add queued')
    expect(write.body.quantity).toEqual(parseQuantity('0.9', 'l'))
    expect(write.body.amount).toEqual(parseMoney('520', 'AMD'))
    expect(go).toHaveBeenCalledWith(-2)
  })

  it('does not send what was typed as a price and is not one (В-5)', async () => {
    const { view, queue } = await render()
    await type(view, 'amount', '57о')
    await button(view, 'Добавить в поход').trigger('click')

    expect(queue.pending).toEqual([])
    expect(view.text()).toContain('Это не похоже на сумму')
    expect(document.activeElement).toBe(input(view, 'amount').element)
    expect(view.emitted('added')).toBeUndefined()
  })

  it('queues one purchase for a double tap', async () => {
    const { view, queue } = await render()
    const add = button(view, 'Добавить в поход')
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
    currentTrip.mockResolvedValue(trip())
    const { view } = await render({ trip: null })
    await vi.waitFor(() => {
      expect(view.findAll('button').some((b) => b.text() === 'Добавить в поход')).toBe(true)
    })
    expect(currentTrip).toHaveBeenCalledTimes(1)
  })

  it('does not ask when it already knows the trip', async () => {
    await render()
    expect(currentTrip).not.toHaveBeenCalled()
  })

  it('asks for a trip first when there is none, and leads back to it (В-6)', async () => {
    const { view, go, queue } = await render({ trip: null, closeSteps: 2 })
    expect(view.text()).toContain('Сначала начните поход')
    expect(view.findAll('button').some((b) => b.text() === 'Добавить в поход')).toBe(false)
    await button(view, 'К походу').trigger('click')
    expect(go).toHaveBeenCalledWith(-2)
    expect(queue.pending).toEqual([])
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
