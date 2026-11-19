import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { moneyMonthCodec, parseMoney } from '@molvia/model'
import type {
  MoneyMonthView,
  SpendingCategoriesResponse,
  SpendingCategoryView,
} from '@molvia/model'
import { useOwnCategories } from '@/composables/useOwnCategories'
import { createAppI18n } from '@/i18n'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const spendingCategories = vi.fn<() => Promise<SpendingCategoriesResponse>>()
vi.mock('@/api', () => ({ api: { spendingCategories: () => spendingCategories() } }))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const GROCERIES = 'c0000000-0000-4000-8000-000000000001'
const DOCUMENTS = 'c0000000-0000-4000-8000-000000000002'
const preset = (id: string, key: 'groceries' | 'documents'): SpendingCategoryView => ({
  id,
  preset: key,
  name: null,
  colour: null,
  icon: null,
  archived: false,
})
const CATEGORIES = [preset(GROCERIES, 'groceries'), preset(DOCUMENTS, 'documents')]

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  spendingCategories.mockReset()
})
afterEach(() => {
  document.body.innerHTML = ''
})

function host(options: { lazy?: boolean } = {}) {
  let frequent: () => readonly string[] = () => []
  let ids: () => string[] = () => []
  let refresh: () => Promise<void> = () => Promise.resolve()
  const Host = defineComponent({
    setup() {
      const own = useOwnCategories(options)
      frequent = () => own.frequent.value
      ids = () => own.categories.value.map((category) => category.id)
      refresh = own.refresh
      return () => h('div')
    },
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  const view = mount(Host, { global: { plugins: [pinia, createAppI18n('en')] } })
  return {
    view,
    frequent: () => frequent(),
    ids: () => ids(),
    refresh: () => refresh(),
    queue: useSpendingQueueStore(),
  }
}

const PHARMACY = 'c0000000-0000-4000-8000-000000000003'
const pharmacy: SpendingCategoryView = {
  id: PHARMACY,
  preset: null,
  name: 'Аптека',
  colour: 3,
  icon: 'health',
  archived: false,
}

/** The list this composable keeps, as read at `askedAt`. */
function keepOwn(categories: SpendingCategoryView[], askedAt: string): void {
  localStorage.setItem(
    `molvia.own-categories.${ACTOR}`,
    JSON.stringify({ askedAt, answer: { categories, frequent: [] } }),
  )
}

/** A month of «Деньги» kept on the phone, read at `askedAt`, naming `categories`. */
function keepMonth(categories: SpendingCategoryView[], askedAt: string): void {
  const amd = parseMoney('0', 'AMD')
  const rub = parseMoney('0', 'RUB')
  const view: MoneyMonthView = {
    month: '2026-11',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: amd,
    uncounted: [],
    foreign: [],
    spentIncome: rub,
    income: rub,
    incomeUncounted: [],
    count: 0,
    incomeCount: 0,
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    budget: null,
    rate: null,
    rateKind: 'live',
    previousSpent: amd,
    previousToDay: null,
    byCategory: [],
    slices: [],
    categories,
    days: [],
    cursor: null,
    remaining: 0,
    remainingFrom: null,
    frequent: [],
    remainingTo: null,
  }
  localStorage.setItem(
    `molvia.money.${ACTOR}`,
    JSON.stringify({
      '2026-11': { answer: moneyMonthCodec.encode(view), fetchedAt: askedAt, askedAt },
    }),
  )
}

// The owner's categories away from «Деньги» — an account's screen, its check, «не попали» — and the
// chips' frequency with them (MOL-198, adversarial А3): asked when the screen comes up, and again on
// every write of the queue that lands, as «Деньги» read their month again on it.
describe('useOwnCategories', () => {
  it('asks the frequency again when a spending lands', async () => {
    spendingCategories.mockResolvedValueOnce({ categories: CATEGORIES, frequent: [GROCERIES] })
    spendingCategories.mockResolvedValue({
      categories: CATEGORIES,
      frequent: [DOCUMENTS, GROCERIES],
    })
    const { view, frequent, queue } = host()
    await flushPromises()
    expect(spendingCategories).toHaveBeenCalledTimes(1)
    expect(frequent()).toEqual([GROCERIES])

    queue.landed += 1
    await flushPromises()
    expect(spendingCategories).toHaveBeenCalledTimes(2)
    expect(frequent()).toEqual([DOCUMENTS, GROCERIES])
    view.unmount()
  })

  // Review 2, Р2-А2: two spendings landed one after the other, two reads in the air, the later one
  // answering first — the earlier answer, come last, is not laid over it.
  it('an answer that set out earlier is not laid over one that set out later', async () => {
    let first: (answer: SpendingCategoriesResponse) => void = () => undefined
    spendingCategories.mockResolvedValueOnce({ categories: CATEGORIES, frequent: [GROCERIES] })
    spendingCategories.mockReturnValueOnce(
      new Promise((resolve) => {
        first = resolve
      }),
    )
    spendingCategories.mockResolvedValueOnce({
      categories: CATEGORIES,
      frequent: [DOCUMENTS, GROCERIES],
    })
    const { view, frequent, queue } = host()
    await flushPromises()
    queue.landed += 1
    await flushPromises()
    queue.landed += 1
    await flushPromises()
    expect(frequent()).toEqual([DOCUMENTS, GROCERIES])
    first({ categories: CATEGORIES, frequent: [GROCERIES, DOCUMENTS] })
    await flushPromises()
    expect(frequent()).toEqual([DOCUMENTS, GROCERIES])
    view.unmount()
  })

  it('must not fire: nothing landed, nothing asked again', async () => {
    spendingCategories.mockResolvedValue({ categories: CATEGORIES, frequent: [GROCERIES] })
    const { view } = host()
    await flushPromises()
    await flushPromises()
    expect(spendingCategories).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  // MOL-400, adversarial Б1: two memories of the list — this one's, and the month «Деньги» keep — and the later
  // read is the list; «Аптека» made in «Деньги» after a record by hand is offered at the shelf with no connection.
  it('with no connection, the list read later wins — a month of «Деньги» over an older one of its own', async () => {
    spendingCategories.mockRejectedValue(new TypeError('Failed to fetch'))
    keepOwn(CATEGORIES, '2026-11-09T10:00:00.000Z')
    keepMonth([...CATEGORIES, pharmacy], '2026-11-10T10:00:00.000Z')
    const { view, ids } = host()
    await flushPromises()
    expect(ids()).toContain(PHARMACY)
    view.unmount()
  })

  it('…and its own over an older month', async () => {
    spendingCategories.mockRejectedValue(new TypeError('Failed to fetch'))
    keepMonth([...CATEGORIES, pharmacy], '2026-11-09T10:00:00.000Z')
    keepOwn(CATEGORIES, '2026-11-10T10:00:00.000Z')
    const { view, ids } = host()
    await flushPromises()
    expect(ids()).not.toContain(PHARMACY)
    view.unmount()
  })

  it('keeps the answer with when its read set out', async () => {
    spendingCategories.mockResolvedValue({ categories: CATEGORIES, frequent: [] })
    const { view } = host()
    await flushPromises()
    const kept: unknown = JSON.parse(localStorage.getItem(`molvia.own-categories.${ACTOR}`) ?? '')
    expect(kept).toMatchObject({ askedAt: expect.any(String), answer: { categories: CATEGORIES } })
    view.unmount()
  })

  // MOL-400, review №6: a screen that needs the list for one sheet asks as the sheet opens.
  it('lazy: asks nothing on mounting or on a spending landed, only by `refresh`', async () => {
    spendingCategories.mockResolvedValue({ categories: [...CATEGORIES, pharmacy], frequent: [] })
    keepOwn(CATEGORIES, '2026-11-09T10:00:00.000Z')
    const { view, ids, refresh, queue } = host({ lazy: true })
    await flushPromises()
    queue.landed += 1
    await flushPromises()
    expect(spendingCategories).not.toHaveBeenCalled()
    expect(ids()).toEqual([GROCERIES, DOCUMENTS])
    await refresh()
    await flushPromises()
    expect(spendingCategories).toHaveBeenCalledTimes(1)
    expect(ids()).toContain(PHARMACY)
    view.unmount()
  })
})
