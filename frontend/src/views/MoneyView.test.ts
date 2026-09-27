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
import MoneyView from './MoneyView.vue'

const moneyMonth = vi.fn<(month: string, cursor?: JournalKey) => Promise<MoneyMonthView>>()
const recordSpending = vi.fn<(body: SpendingBody) => Promise<unknown>>()
const removeSpending = vi.fn<(id: string) => Promise<void>>()
const restoreSpending = vi.fn<(id: string) => Promise<unknown>>()
const trip = vi.fn<(id: string) => Promise<TripView>>()
vi.mock('@/api', () => ({
  api: {
    moneyMonth: (month: string, cursor?: JournalKey) => moneyMonth(month, cursor),
    recordSpending: (body: SpendingBody) => recordSpending(body),
    removeSpending: (id: string) => removeSpending(id),
    restoreSpending: (id: string) => restoreSpending(id),
    trip: (id: string) => trip(id),
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
    rest: rub('51212'),
    rate: { base: 'RUB', quote: 'AMD', scaled: 4_620_000n, source: 'personal', asOf: new Date() },
    rateKind: 'live',
    previousSpent: amd('345620'),
    byCategory: [{ categoryId: BEAUTY, amount: amd('5000') }],
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
    previousSpent: null,
    byCategory: [],
    days: [],
  })

const views: VueWrapper[] = []
let router: Router

async function render(path = '/money'): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(MoneyView, {
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
  for (const mock of [moneyMonth, recordSpending, removeSpending, restoreSpending, trip])
    mock.mockReset()
  recordSpending.mockResolvedValue(undefined)
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

describe('MoneyView: the four states', () => {
  it('loads with a skeleton and asks for the running month in Yerevan', async () => {
    moneyMonth.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(moneyMonth).toHaveBeenCalledWith('2026-09', undefined)
    expect(view.text()).toContain(en.spending.subtitle)
  })

  it('a failed read is red with «Try again», and trying again reads again', async () => {
    moneyMonth.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(month())
    const view = await render()
    expect(view.text()).toContain(en.spending.load_error.title)
    await button(view, en.state.retry).trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.spending.spent)
  })

  it('offline with nothing kept is never red, has no «Try again», and still takes a spending', async () => {
    online(false)
    moneyMonth.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.spending.offline.body)
    expect(view.text()).not.toContain(en.state.retry)
    expect(button(view, en.spending.empty.action).exists()).toBe(true)
  })

  it('offline with a month kept shows it under a yellow strip', async () => {
    moneyMonth.mockResolvedValueOnce(month())
    const first = await render()
    first.unmount()
    online(false)
    moneyMonth.mockRejectedValue(new TypeError('network'))
    window.dispatchEvent(new Event('offline'))
    const view = await render()
    expect(view.text()).toContain(en.spending.offline.strip)
    expect(view.text()).toContain('317,800')
  })

  it('a newcomer is offered the first spending and the trip, with no «Трата» floating', async () => {
    moneyMonth.mockResolvedValue(empty())
    const view = await render()
    expect(view.text()).toContain(en.spending.empty.title)
    expect(view.text()).toContain(en.spending.empty.trip)
    expect(view.find('.float').exists()).toBe(false)
  })

  it('an empty month after a full one is a month, not a newcomer', async () => {
    moneyMonth.mockResolvedValue({ ...empty(), previousSpent: amd('12000') })
    const view = await render()
    expect(view.text()).not.toContain(en.spending.empty.title)
    expect(view.text()).toContain(en.spending.month_empty)
  })
})

describe('MoneyView: the month', () => {
  it('prints the server’s figures: the total, ≈ in the income currency, the change, the rate', async () => {
    moneyMonth.mockResolvedValue(month())
    const text = plain((await render()).text())
    expect(text).toContain('317,800')
    expect(text).toContain('≈ RUB 68,788'.replace('RUB ', '₽'))
    expect(text).toContain('−8% vs August')
    expect(text).toContain('Including $11 (≈ ֏4,290)')
    expect(text).toContain('At my rate of 4.62 ֏ per 1 ₽ today')
  })

  it('a closed month names the day its rate was frozen on', async () => {
    moneyMonth.mockResolvedValue(month({ month: '2026-08', rateKind: 'frozen' }))
    const view = await render('/money?month=2026-08')
    expect(moneyMonth).toHaveBeenCalledWith('2026-08', undefined)
    expect(view.text()).toContain('At the rate of August 31')
  })

  it('a month in the future is not looked at: the running one is', async () => {
    moneyMonth.mockResolvedValue(month())
    await render('/money?month=2026-10')
    expect(moneyMonth).toHaveBeenCalledWith('2026-09', undefined)
  })

  it('moves to the month before by replace — «back» does not walk through months', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const before = window.history.length
    await view.find(`button[aria-label="${en.spending.month_prev}"]`).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.month).toBe('2026-08')
    expect(window.history.length).toBe(before)
    expect(moneyMonth).toHaveBeenLastCalledWith('2026-08', undefined)
  })

  it('a spending still on the phone is a row «Sending…» and a line on the card, never a sum', async () => {
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
    expect(view.text()).toContain('Not counted yet: 1 spending is being sent')
    expect(plain(view.text())).toContain('317,800')
  })
})

describe('MoneyView: the sheet', () => {
  it('checks on «Save»: no amount and no category are two errors, and nothing is queued', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    await button(view, en.spending.add).trigger('click')
    await risen()
    await pressUntil(en.spending.sheet.save, () => {
      expect(document.querySelector('dialog[open]')?.textContent).toContain(
        en.spending.sheet.bad_amount,
      )
    })
    const sheet = document.querySelector('dialog[open]')?.textContent ?? ''
    expect(sheet).toContain(en.spending.sheet.bad_category)
    expect(useSpendingQueueStore().pending).toEqual([])
  })

  it('saves through the queue and closes at once, without waiting for the network', async () => {
    moneyMonth.mockResolvedValue(month())
    recordSpending.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    await button(view, en.spending.add).trigger('click')
    await risen()
    const amount = document.querySelector<HTMLInputElement>('dialog[open] input[inputmode=decimal]')
    if (!amount) throw new Error('no amount')
    amount.value = '1 234,5'
    amount.dispatchEvent(new Event('input'))
    document.querySelector<HTMLInputElement>(`dialog[open] input[value="${BEAUTY}"]`)?.click()
    await flushPromises()
    await pressUntil(en.spending.sheet.save, () => {
      expect(recordSpending).toHaveBeenCalled()
    })
    expect(recordSpending).toHaveBeenCalledTimes(1)
    expect(recordSpending.mock.calls[0]?.[0]).toMatchObject({
      spentOn: '2026-09-27',
      amount: amd('1234.5'),
      categoryId: BEAUTY,
    })
    expect(document.querySelector('dialog[open]')).toBeNull()
  })

  it('removes without a question and offers «Undo», which brings the same spending back', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    await view.find('.body').trigger('click')
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
    expect(view.find('.undo').exists()).toBe(false)
  })
})
