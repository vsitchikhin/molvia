import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type { JournalKey, MoneyMonthView, SpendingBody, TripView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import MoneySpendingsView from './MoneySpendingsView.vue'

const moneyMonth = vi.fn<(month: string, cursor?: JournalKey) => Promise<MoneyMonthView>>()
const recordSpending = vi.fn<(body: SpendingBody) => Promise<unknown>>()
const amendSpending = vi.fn<(id: string, body: unknown) => Promise<unknown>>()
const removeSpending = vi.fn<(id: string) => Promise<void>>()
const restoreSpending = vi.fn<(id: string) => Promise<unknown>>()
const trip = vi.fn<(id: string) => Promise<TripView>>()
const spending = vi.fn<(id: string) => Promise<{ revision: number }>>()
const moneyAccounts = vi.fn(() =>
  Promise.resolve({
    spendCurrency: 'AMD' as const,
    accounts: [],
    totals: { total: amd('0'), spendable: amd('0'), savings: amd('0'), uncounted: 0 },
    unassigned: 0,
    countedAt: new Date(),
  }),
)
vi.mock('@/api', () => ({
  api: {
    moneyMonth: (month: string, cursor?: JournalKey) => moneyMonth(month, cursor),
    recordSpending: (body: SpendingBody) => recordSpending(body),
    amendSpending: (id: string, body: unknown) => amendSpending(id, body),
    removeSpending: (id: string) => removeSpending(id),
    restoreSpending: (id: string) => restoreSpending(id),
    trip: (id: string) => trip(id),
    spending: (id: string) => spending(id),
    moneyAccounts: () => moneyAccounts(),
    spendingCategories: () => Promise.resolve({ categories: [] }),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const BEAUTY = 'ffffffff-0000-4000-8000-000000000001'
const BARBER = 'eeeeeeee-0000-4000-8000-000000000001'
const amd = (text: string) => parseMoney(text, 'AMD')
const rub = (text: string) => parseMoney(text, 'RUB')
const plain = (text: string) => text.replace(/\s/g, ' ')

function month(patch: Partial<MoneyMonthView> = {}): MoneyMonthView {
  return {
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: amd('317800'),
    uncounted: [],
    foreign: [{ amount: parseMoney('11', 'USD'), counted: amd('4290') }],
    spentIncome: rub('68788'),
    income: rub('120000'),
    incomeUncounted: [],
    count: 1,
    incomeCount: 1,
    shiftedIn: [],
    shiftedOut: [],
    rest: {
      total: rub('51212'),
      spendable: rub('51212'),
      uncounted: { total: [], spendable: [] },
      operationsUncounted: { total: 0, spendable: 0 },
    },
    accountsFrom: null,
    accountsRemoved: false,
    budget: null,
    rate: { base: 'RUB', quote: 'AMD', scaled: 4_620_000n, source: 'personal', asOf: new Date() },
    rateKind: 'live',
    previousSpent: amd('345620'),
    byCategory: [{ categoryId: BEAUTY, amount: amd('5000') }],
    slices: [{ categoryId: BEAUTY, amount: amd('5000'), count: 1, level: 1000 }],
    categories: [{ id: BEAUTY, preset: 'beauty', name: null, colour: null, archived: false }],
    days: [
      {
        day: '2026-09-26',
        total: amd('5000'),
        estimated: false,
        entries: [
          {
            kind: 'manual',
            spending: {
              id: BARBER,
              spentOn: '2026-09-26',
              amount: amd('5000'),
              categoryId: BEAUTY,
              note: 'Barber',
              place: null,
              rate: null,
              accountId: null,
              debited: null,
              revision: 1,
              amendedAt: null,
            },
            counted: amd('5000'),
          },
        ],
      },
    ],
    cursor: null,
    remaining: 0,
    remainingFrom: null,
    remainingTo: null,
    ...patch,
  }
}

const empty = () =>
  month({
    spent: amd('0'),
    foreign: [],
    spentIncome: null,
    income: rub('0'),
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    budget: null,
    previousSpent: null,
    byCategory: [],
    slices: [],
    days: [],
  })

const views: VueWrapper[] = []
let router: Router

async function render(path = '/money/spendings'): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(MoneySpendingsView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

let clock = 0

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [
    moneyMonth,
    recordSpending,
    amendSpending,
    removeSpending,
    restoreSpending,
    trip,
    spending,
  ])
    mock.mockReset()
  recordSpending.mockResolvedValue(undefined)
  amendSpending.mockResolvedValue(undefined)
  removeSpending.mockResolvedValue(undefined)
  restoreSpending.mockResolvedValue(undefined)
  online(true)
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function risen(): Promise<void> {
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function button(view: VueWrapper, text: string) {
  const found = view.findAll('button').find((one) => one.text().trim() === text)
  if (!found) throw new Error(`no «${text}»`)
  return found
}

/**
 * Presses a button of the open sheet until what it does has happened: the sheet takes no tap
 * until it has come up, and on a loaded machine that is later than any fixed wait.
 */
async function pressUntil(text: string, happened: () => void): Promise<void> {
  await vi.waitFor(() => {
    clock += 1000
    const open = document.querySelector('dialog[open]')
    if (open) sheetButton(text).click()
    happened()
  })
}

function sheetButton(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('dialog[open] button')].find(
    (one) => one.textContent.trim() === text,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no «${text}» in the sheet`)
  return found
}

describe('MoneySpendingsView: rows and the sheet', () => {
  it('a spending still on the phone is a row «Sending…» and a word by the sum, never a figure', async () => {
    moneyMonth.mockResolvedValue(month())
    recordSpending.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    useSpendingQueueStore().record({
      id: 'eeeeeeee-0000-4000-8000-000000000002',
      spentOn: '2026-09-27',
      amount: amd('1500'),
      categoryId: BEAUTY,
      note: 'Taxi',
    })
    await flushPromises()
    expect(view.text()).toContain(en.spending.pending)
    expect(plain(view.get('.total').text())).toContain('317,800')
    // One dot between the two parts, a space on either side (adversarial Б).
    expect(plain(view.get('.approx').text())).toBe('≈ ₽68,788 · 1 spending not counted yet')
  })

  it('must not fire: with no «≈» the waiting spending starts the line, with no dot before it', async () => {
    moneyMonth.mockResolvedValue(month({ spentIncome: null }))
    recordSpending.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.approx').exists()).toBe(false)
    useSpendingQueueStore().record({
      id: 'eeeeeeee-0000-4000-8000-000000000003',
      spentOn: '2026-09-27',
      amount: amd('1500'),
      categoryId: BEAUTY,
      note: 'Taxi',
    })
    await flushPromises()
    expect(plain(view.get('.approx').text())).toBe('1 spending not counted yet')
  })

  it('С-2: brings the spending just saved into view once its row is there', async () => {
    moneyMonth.mockResolvedValue(month())
    recordSpending.mockReturnValue(new Promise(() => undefined))
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    vi.stubGlobal('matchMedia', () => ({ matches: false }) as MediaQueryList)
    const view = await render()
    await button(view, en.spending.summary.add).trigger('click')
    await risen()
    const amount = document.querySelector<HTMLInputElement>('dialog[open] input[inputmode=decimal]')
    if (!amount) throw new Error('no amount')
    amount.value = '1500'
    amount.dispatchEvent(new Event('input'))
    document.querySelector<HTMLInputElement>(`dialog[open] input[value="${BEAUTY}"]`)?.click()
    await flushPromises()
    await pressUntil(en.spending.sheet.save, () => {
      expect(scrolled).toHaveBeenCalled()
    })
    const saved = useSpendingQueueStore().pending[0]
    const row = scrolled.mock.contexts[0] as Element
    expect(saved?.kind === 'record' && row.getAttribute('data-row')).toBe(
      saved?.kind === 'record' ? saved.body.id : 'no record',
    )
    vi.unstubAllGlobals()
  })

  it('removes without a question and offers «Undo», which brings the same spending back', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    await view.find('.list-row').trigger('click')
    await risen()
    // Sent first: an «Undo» before the removal left takes it out of the queue instead, which
    // the queue's own tests pin.
    await pressUntil(en.spending.sheet.remove, () => {
      expect(removeSpending).toHaveBeenCalledWith(BARBER)
    })
    await flushPromises()
    expect(view.text()).toContain('Deleted: Barber')
    await button(view, en.spending.restore).trigger('click')
    await vi.waitFor(() => {
      expect(restoreSpending).toHaveBeenCalledWith(BARBER)
    })
    expect(view.find('.undo-strip').exists()).toBe(false)
  })

  it('a refused amendment opens on what was typed, names why, and goes again over the server’s version', async () => {
    moneyMonth.mockResolvedValue(month())
    // The server's revision now — another device's amendment moved it past the one refused over.
    spending.mockResolvedValue({ revision: 3 })
    localStorage.setItem('molvia.actor', ACTOR)
    localStorage.setItem(
      `molvia.spending-rejected.${ACTOR}`,
      JSON.stringify([
        {
          key: 'k1',
          code: 'error.conflict',
          write: {
            kind: 'amend',
            id: BARBER,
            body: {
              revision: 1,
              spentOn: '2026-09-26',
              amount: { amount: '6000.00', currency: 'AMD' },
              categoryId: BEAUTY,
              note: 'Barber',
            },
          },
        },
      ]),
    )
    const view = await render()
    expect(view.text()).toContain(en.spending.refused)
    await view.find('.list-row').trigger('click')
    await risen()
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain(en.spending.sheet.refused_conflict)
    expect(sheet?.querySelector<HTMLInputElement>('input[inputmode=decimal]')?.value).toBe('6000')
    await pressUntil(en.spending.sheet.save, () => {
      expect(amendSpending).toHaveBeenCalled()
    })
    expect(amendSpending.mock.calls[0]?.[0]).toBe(BARBER)
    expect(amendSpending.mock.calls[0]?.[1]).toMatchObject({ revision: 3, amount: amd('6000') })
    expect(useSpendingQueueStore().rejected).toEqual([])
  })

  it('Г: the only spending removed empties the month — and «Undo» stays and brings it back', async () => {
    moneyMonth.mockResolvedValueOnce(month({ previousSpent: null, income: rub('0') }))
    moneyMonth.mockResolvedValue(empty())
    const view = await render()
    await view.find('.list-row').trigger('click')
    await risen()
    await pressUntil(en.spending.sheet.remove, () => {
      expect(removeSpending).toHaveBeenCalledWith(BARBER)
    })
    await vi.waitFor(() => {
      expect(view.text()).toContain('No spendings in September')
    })
    expect(view.find('.undo-strip').exists()).toBe(true)
    moneyMonth.mockResolvedValue(month({ previousSpent: null, income: rub('0') }))
    await button(view, en.spending.restore).trigger('click')
    await vi.waitFor(() => {
      expect(restoreSpending).toHaveBeenCalledWith(BARBER)
    })
  })

  it('Ж: a category the server does not know stands on no chip, and is not sent again', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const unknown = 'ffffffff-0000-4000-8000-00000000000f'
    localStorage.setItem(
      `molvia.spending-rejected.${ACTOR}`,
      JSON.stringify([
        {
          key: 'k',
          code: 'error.spending_category_unknown',
          write: {
            kind: 'record',
            body: {
              id: 'eeeeeeee-0000-4000-8000-000000000005',
              spentOn: '2026-09-26',
              amount: { amount: '1500.00', currency: 'AMD' },
              categoryId: unknown,
              note: 'Taxi',
            },
          },
        },
      ]),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.spending-rejected.${ACTOR}` }))
    await flushPromises()
    await view.findAll('.list-row').at(0)?.trigger('click')
    await risen()
    await pressUntil(en.spending.sheet.save, () => {
      expect(document.querySelector('dialog[open]')?.textContent).toContain(
        en.spending.sheet.bad_category,
      )
    })
    expect(recordSpending).not.toHaveBeenCalled()
  })

  it('Т-4: amending a spending still on the phone keeps one write, and the row shows it', async () => {
    moneyMonth.mockResolvedValue(month())
    recordSpending.mockReturnValue(new Promise(() => undefined))
    online(false)
    const view = await render()
    const queue = useSpendingQueueStore()
    queue.record({
      id: 'eeeeeeee-0000-4000-8000-000000000006',
      spentOn: '2026-09-27',
      amount: amd('5000'),
      categoryId: BEAUTY,
      note: 'Taxi',
    })
    await flushPromises()
    await view.findAll('.list-row').at(0)?.trigger('click')
    await risen()
    const amount = document.querySelector<HTMLInputElement>('dialog[open] input[inputmode=decimal]')
    if (!amount) throw new Error('no amount')
    amount.value = '500'
    amount.dispatchEvent(new Event('input'))
    await pressUntil(en.spending.sheet.save, () => {
      expect(document.querySelector('dialog[open]')).toBeNull()
    })
    const waiting = queue.pending.filter((write) => write.kind === 'record')
    expect(waiting).toHaveLength(1)
    expect(plain(view.findAll('.list-row').at(0)?.text() ?? '')).toContain('֏500')
  })
})

describe('MoneySpendingsView: the journal of the month (MOL-159)', () => {
  it('opens on the month of the address, with the server’s count and sum over the days', async () => {
    moneyMonth.mockResolvedValue(month({ month: '2026-08', rateKind: 'frozen', count: 43 }))
    const view = await render('/money/spendings?month=2026-08')
    expect(moneyMonth).toHaveBeenCalledWith('2026-08', undefined)
    const total = plain(view.get('.total').text())
    expect(total).toContain('43 spendings')
    expect(total).toContain('317,800')
    expect(total).toContain('≈ ₽68,788')
    expect(view.text()).toContain('Barber')
  })

  it('must not fire: a count the server did not send is not printed as zero', async () => {
    moneyMonth.mockResolvedValue(month({ count: null }))
    const view = await render()
    expect(view.get('.total').text()).not.toMatch(/spending/)
  })

  it('a month with nothing in it says so by its name, with no button inside', async () => {
    moneyMonth.mockResolvedValue({ ...empty(), previousSpent: amd('100') })
    const view = await render()
    expect(view.text()).toContain('No spendings in September')
    expect(view.find('.state button').exists()).toBe(false)
    expect(button(view, en.spending.summary.add).exists()).toBe(true)
  })

  it('offline with the month kept: the journal under a yellow strip with the hour it is of', async () => {
    moneyMonth.mockResolvedValueOnce(month())
    const first = await render()
    first.unmount()
    online(false)
    moneyMonth.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain('No connection. Spendings as of')
    expect(view.text()).toContain('Barber')
  })

  it('a spending saved into another month takes «Траты» to it', async () => {
    moneyMonth.mockResolvedValue(month())
    recordSpending.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    await button(view, en.spending.summary.add).trigger('click')
    await risen()
    const dialog = document.querySelector('dialog[open]')
    const amount = dialog?.querySelector<HTMLInputElement>('input[inputmode=decimal]')
    const date = dialog?.querySelector<HTMLInputElement>('input[type=date]')
    if (!amount || !date) throw new Error('no fields')
    amount.value = '700'
    amount.dispatchEvent(new Event('input'))
    date.value = '2026-08-30'
    date.dispatchEvent(new Event('input'))
    dialog?.querySelector<HTMLInputElement>(`input[value="${BEAUTY}"]`)?.click()
    await flushPromises()
    await pressUntil(en.spending.sheet.save, () => {
      expect(router.currentRoute.value.query.month).toBe('2026-08')
    })
  })

  it('«‹ Деньги» leads back to the summary', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render('/money/spendings?month=2026-08')
    expect(view.text()).toContain(en.spending.title)
    expect(router.currentRoute.value.meta.parent).toBe('money')
  })
})

describe('MoneySpendingsView: what round 2 of the review of MOL-159 found', () => {
  it('Е: a refused spending of a day the first page has not reached stands as a row to put right', async () => {
    moneyMonth.mockResolvedValue(
      month({
        count: 45,
        cursor: { day: '2026-09-26', moment: 0, id: BARBER },
        remaining: 44,
        remainingFrom: '2026-09-01',
        remainingTo: '2026-09-25',
      }),
    )
    const view = await render()
    recordSpending.mockRejectedValue(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    const queue = useSpendingQueueStore()
    const RENT = 'eeeeeeee-0000-4000-8000-000000000009'
    queue.record({
      id: RENT,
      spentOn: '2026-09-01',
      amount: amd('150000'),
      categoryId: BEAUTY,
      note: 'Rent',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(1)
    })
    await flushPromises()
    expect(view.find(`[data-row="${RENT}"]`).text()).toContain(en.spending.refused)
    expect(view.text()).not.toContain(en.spending.rejected_other.title)
  })

  it('И of round 3: a refused amendment of a row on a page not loaded stands as that row', async () => {
    moneyMonth.mockResolvedValue(
      month({
        count: 45,
        cursor: { day: '2026-09-26', moment: 0, id: BARBER },
        remaining: 44,
        remainingFrom: '2026-09-01',
        remainingTo: '2026-09-25',
      }),
    )
    const view = await render()
    amendSpending.mockRejectedValue(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    const queue = useSpendingQueueStore()
    const RENT = 'eeeeeeee-0000-4000-8000-000000000009'
    queue.amend(RENT, 3, {
      spentOn: '2026-09-02',
      amount: amd('6000'),
      categoryId: BEAUTY,
      note: 'Rent',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(1)
    })
    await flushPromises()
    expect(view.find(`[data-row="${RENT}"]`).text()).toContain(en.spending.refused)
    expect(view.text()).not.toContain(en.spending.rejected_other.title)
  })

  it('К, М: a refusal of another month, or an amendment moving one across the edge, is a row here', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    recordSpending.mockRejectedValue(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    amendSpending.mockRejectedValue(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    const queue = useSpendingQueueStore()
    const TAXI = 'eeeeeeee-0000-4000-8000-0000000000aa'
    const MOVED = 'eeeeeeee-0000-4000-8000-0000000000bb'
    queue.record({
      id: TAXI,
      spentOn: '2026-08-31',
      amount: amd('1500'),
      categoryId: BEAUTY,
      note: 'Taxi',
    })
    queue.amend(MOVED, 2, {
      spentOn: '2026-10-01',
      amount: amd('900'),
      categoryId: BEAUTY,
      note: 'Moved',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(2)
    })
    await flushPromises()
    for (const id of [TAXI, MOVED])
      expect(view.find(`[data-row="${id}"]`).text()).toContain(en.spending.refused)
    expect(view.text()).toContain(en.spending.list.refused)
    expect(view.text()).not.toContain(en.spending.rejected_other.title)
  })

  it('Л, Н: an amendment of a spending removed elsewhere is a row that says why, and «Discard» there drops it', async () => {
    moneyMonth.mockResolvedValue(
      month({
        count: 45,
        cursor: { day: '2026-09-26', moment: 0, id: BARBER },
        remaining: 44,
        remainingFrom: '2026-09-01',
        remainingTo: '2026-09-25',
      }),
    )
    const view = await render()
    amendSpending.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const queue = useSpendingQueueStore()
    const RENT = 'eeeeeeee-0000-4000-8000-000000000009'
    queue.amend(RENT, 3, {
      spentOn: '2026-09-02',
      amount: amd('6000'),
      categoryId: BEAUTY,
      note: 'Rent',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(1)
    })
    await flushPromises()
    await view.find(`[data-row="${RENT}"] .list-row`).trigger('click')
    await risen()
    expect(document.querySelector('dialog[open]')?.textContent).toContain(en.error.not_found)
    await pressUntil(en.spending.sheet.dismiss, () => {
      expect(queue.rejected).toEqual([])
    })
    expect(amendSpending).toHaveBeenCalledTimes(1)
  })

  // «Сохраните ещё раз поверх» (round 6, О): wherever the refusal stands, and whatever revision the
  // phone holds, the save goes over the one the server has — asked as the write leaves.
  it('О: a conflict saved again from «Не приняты» goes over the server’s revision, not the one refused', async () => {
    moneyMonth.mockResolvedValue(month())
    spending.mockResolvedValue({ revision: 2 })
    const SHAVE = 'eeeeeeee-0000-4000-8000-0000000000cc'
    localStorage.setItem('molvia.actor', ACTOR)
    localStorage.setItem(
      `molvia.spending-rejected.${ACTOR}`,
      JSON.stringify([
        {
          key: 'k1',
          code: 'error.conflict',
          write: {
            kind: 'amend',
            id: SHAVE,
            body: {
              revision: 1,
              spentOn: '2026-08-31',
              amount: { amount: '6000.00', currency: 'AMD' },
              categoryId: BEAUTY,
              note: 'Shave',
            },
          },
        },
      ]),
    )
    const view = await render()
    await view.find(`[data-row="${SHAVE}"] .list-row`).trigger('click')
    await risen()
    await pressUntil(en.spending.sheet.save, () => {
      expect(amendSpending).toHaveBeenCalled()
    })
    expect(spending).toHaveBeenCalledWith(SHAVE)
    expect(amendSpending.mock.calls[0]?.[1]).toMatchObject({ revision: 2, amount: amd('6000') })
    await vi.waitFor(() => {
      expect(useSpendingQueueStore().rejected).toEqual([])
    })
  })

  it('П: a refusal about a row on screen is that row’s alone — marked once, and its amendment takes it away', async () => {
    moneyMonth.mockResolvedValue(month())
    amendSpending.mockRejectedValueOnce(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    const view = await render()
    const queue = useSpendingQueueStore()
    queue.amend(BARBER, 1, {
      spentOn: '2026-09-26',
      amount: amd('6000'),
      categoryId: BEAUTY,
      note: 'Barber',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(1)
    })
    await flushPromises()
    const rows = view.findAll(`[data-row="${BARBER}"]`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text()).toContain(en.spending.refused)
    // «Не приняты» only names it, and leads to it (round 7, Р): no row of its own there.
    expect(button(view, '1 marked in the journal below — show').exists()).toBe(true)
    await rows[0]?.find('.list-row').trigger('click')
    await risen()
    await pressUntil(en.spending.sheet.save, () => {
      expect(amendSpending).toHaveBeenCalledTimes(2)
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toEqual([])
    })
  })

  // The summary counts every refusal; «Не приняты» names the ones marked on their rows too, and
  // leads to the first (adversarial round 7, Р).
  it('Р: «Не приняты» names a refusal marked in the journal and leads to its row', async () => {
    moneyMonth.mockResolvedValue(month())
    recordSpending.mockRejectedValue(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    amendSpending.mockRejectedValueOnce(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    const view = await render()
    const queue = useSpendingQueueStore()
    queue.amend(BARBER, 1, {
      spentOn: '2026-09-26',
      amount: amd('6000'),
      categoryId: BEAUTY,
      note: 'Barber',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(1)
    })
    await flushPromises()
    // Only the marked one: the block says where it is.
    expect(button(view, '1 marked in the journal below — show').exists()).toBe(true)

    const TAXI = 'eeeeeeee-0000-4000-8000-0000000000aa'
    queue.record({
      id: TAXI,
      spentOn: '2026-09-27',
      amount: amd('1500'),
      categoryId: BEAUTY,
      note: 'Taxi',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(2)
    })
    await flushPromises()
    expect(view.find(`[data-row="${TAXI}"]`).exists()).toBe(true)
    const more = button(view, 'And 1 more, marked in the journal below')
    await more.trigger('click')
    expect(document.activeElement?.closest(`[data-row="${BARBER}"]`)).not.toBeNull()
  })

  it('Ж: «Undo» is the queue’s, not the screen’s — it outlives «Траты» for the step back', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    await view.find('.list-row').trigger('click')
    await risen()
    await pressUntil(en.spending.sheet.remove, () => {
      expect(removeSpending).toHaveBeenCalledWith(BARBER)
    })
    await flushPromises()
    view.unmount()
    views.splice(views.indexOf(view), 1)
    expect(useSpendingQueueStore().lastRemoved).toMatchObject({
      undo: { id: BARBER },
      title: 'Barber',
    })
  })
})
