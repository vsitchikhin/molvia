import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type {
  JournalKey,
  MoneyAccountView,
  MoneyAccountsResponse,
  MoneyMonthView,
  SpendingBody,
  TripView,
} from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import MoneyView from './MoneyView.vue'

const moneyMonth = vi.fn<(month: string, cursor?: JournalKey) => Promise<MoneyMonthView>>()
const recordSpending = vi.fn<(body: SpendingBody) => Promise<unknown>>()
const amendSpending = vi.fn<(id: string, body: unknown) => Promise<unknown>>()
const removeSpending = vi.fn<(id: string) => Promise<void>>()
const restoreSpending = vi.fn<(id: string) => Promise<unknown>>()
const trip = vi.fn<(id: string) => Promise<TripView>>()
// The card of the accounts sits above the month (MOL-123): a person with no account yet.
const noAccounts = (): MoneyAccountsResponse => ({
  spendCurrency: 'AMD' as const,
  accounts: [],
  totals: { total: amd('0'), spendable: amd('0'), savings: amd('0'), uncounted: 0 },
  incomeTotals: null,
  unassigned: 0,
  countedAt: new Date(),
})
const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>(() =>
  Promise.resolve(noAccounts()),
)
vi.mock('@/api', () => ({
  api: {
    moneyMonth: (month: string, cursor?: JournalKey) => moneyMonth(month, cursor),
    recordSpending: (body: SpendingBody) => recordSpending(body),
    amendSpending: (id: string, body: unknown) => amendSpending(id, body),
    removeSpending: (id: string) => removeSpending(id),
    restoreSpending: (id: string) => restoreSpending(id),
    trip: (id: string) => trip(id),
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
    previousToDay: null,
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
              transferId: null,
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
    previousToDay: null,
    byCategory: [],
    slices: [],
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
  moneyAccounts.mockReset()
  moneyAccounts.mockImplementation(() => Promise.resolve(noAccounts()))
  for (const mock of [
    moneyMonth,
    recordSpending,
    amendSpending,
    removeSpending,
    restoreSpending,
    trip,
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

  it('offline with nothing kept is never red, has no «Try again», and offers nothing to write into', async () => {
    online(false)
    moneyMonth.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).not.toContain(en.state.retry)
    // No category is known on this phone, and a spending needs one (review Т-5) — so the state
    // does not offer to write one either (Е-7).
    expect(view.text()).not.toContain(en.spending.summary.add)
    expect(view.text()).toContain(en.spending.offline.body_read)
    expect(view.text()).not.toContain(en.spending.offline.body)
  })

  it('offline on a month never read, another month kept: its categories take a spending', async () => {
    moneyMonth.mockResolvedValueOnce(month({ month: '2026-08', rateKind: 'frozen' }))
    const first = await render('/money?month=2026-08')
    first.unmount()
    online(false)
    moneyMonth.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.spending.offline.body)
    await button(view, en.spending.summary.add).trigger('click')
    await risen()
    expect(document.querySelector('dialog[open]')?.textContent).toContain('Beauty and hygiene')
  })

  // Self-review Р3-3: the strip «сервер не ответил» offers «Повторить» — the dock holds «Добавить
  // трату» (К-5) — and it asks the month and «Счета» again, as the error's does.
  it('a month kept and the server not answering: the strip offers «Повторить», and it asks again', async () => {
    moneyMonth.mockResolvedValueOnce(month())
    ;(await render()).unmount()
    moneyMonth.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(month())
    const view = await render()
    expect(view.text()).toContain('The server did not answer')
    const asked = moneyAccounts.mock.calls.length
    await view.get('.strip button').trigger('click')
    await flushPromises()
    expect(moneyAccounts.mock.calls.length).toBe(asked + 1)
    expect(view.find('.strip').exists()).toBe(false)
  })

  it('offline with a month kept shows it under a yellow strip', async () => {
    moneyMonth.mockResolvedValueOnce(month())
    const first = await render()
    first.unmount()
    online(false)
    moneyMonth.mockRejectedValue(new TypeError('network'))
    window.dispatchEvent(new Event('offline'))
    const view = await render()
    // The hour the figures are of, under the switcher (handoff MOL-157 1e, MOL-138).
    expect(view.text()).toContain('Offline · figures as of')
    expect(view.text()).toContain('317,800')
    const strip = view.get('.strip').element
    const switcher = view.get(`button[aria-label="${en.spending.month_prev}"]`).element
    expect(switcher.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a newcomer is offered the first spending by the strip under the thumb, nothing inside', async () => {
    moneyMonth.mockResolvedValue(empty())
    const view = await render()
    expect(view.text()).toContain(en.spending.empty.title)
    expect(view.find('.state button').exists()).toBe(false)
    expect(view.find('.float').exists()).toBe(false)
    expect(button(view, en.spending.summary.add).exists()).toBe(true)
  })

  it('an empty month after a full one is a month, not a newcomer', async () => {
    moneyMonth.mockResolvedValue({ ...empty(), previousSpent: amd('12000') })
    const view = await render()
    expect(view.text()).not.toContain(en.spending.empty.title)
    expect(view.text()).toContain('No spendings in September yet')
  })
})

describe('MoneyView: the month', () => {
  it('prints the server’s figures: the total, ≈ in the income currency, the change, the rate', async () => {
    moneyMonth.mockResolvedValue(month({ previousToDay: { day: 27, spent: amd('345620') } }))
    const text = plain((await render()).text())
    expect(text).toContain('317,800')
    expect(text).toContain('≈ RUB 68,788'.replace('RUB ', '₽'))
    expect(text).toContain('−8% vs the same day of August')
    expect(text).toContain('Including $11 (≈ ֏4,290)')
    expect(text).toContain('At my rate of 4.62 ֏ per 1 ₽ today')
  })

  // MOL-183, С-12: the running month against the one before to the same day, a closed one whole.
  describe('the comparison', () => {
    const change = async (patch: Partial<MoneyMonthView>, path = '/money') => {
      moneyMonth.mockResolvedValue(month(patch))
      const view = await render(path)
      return view.find('.change').exists() ? plain(view.get('.change').text()) : null
    }

    it('a closed month is compared with the one before whole, as before', async () => {
      expect(
        await change(
          { month: '2026-08', rateKind: 'frozen', previousSpent: amd('163800') },
          '/money?month=2026-08',
        ),
      ).toBe('+94% vs July')
    })

    it('must not fire: a closed month is never «to the same day», whatever the answer holds', async () => {
      expect(
        await change(
          {
            month: '2026-08',
            rateKind: 'frozen',
            previousSpent: null,
            previousToDay: { day: 12, spent: amd('100') },
          },
          '/money?month=2026-08',
        ),
      ).toBeNull()
    })

    it('to the third day it is «the month has just started», on the fourth a percent', async () => {
      expect(await change({ previousToDay: { day: 3, spent: amd('345620') } })).toBe(
        en.spending.month_started,
      )
      expect(await change({ previousToDay: { day: 4, spent: amd('345620') } })).toBe(
        '−8% vs the same day of August',
      )
    })

    it('says the month has started even with no month before it', async () => {
      expect(await change({ previousToDay: { day: 1, spent: null } })).toBe(
        en.spending.month_started,
      )
      expect(await change({ previousToDay: { day: 12, spent: null } })).toBeNull()
    })

    it('nothing spent past the third day is «−100 %», as «Против обычного» says it (Р-5)', async () => {
      expect(
        await change({
          ...empty(),
          previousSpent: amd('20000'),
          previousToDay: { day: 15, spent: amd('20000') },
        }),
      ).toBe('−100% vs the same day of August')
    })

    // Adversarial А4: «−100 %» says nothing was spent, and the ring beside it says something was.
    it('must not fire: «−100 %» over a spending on its way or one waiting a rate', async () => {
      const zero = {
        ...empty(),
        previousSpent: amd('20000'),
        previousToDay: { day: 15, spent: amd('20000') },
      }
      expect(await change({ ...zero, uncounted: [parseMoney('11', 'USD')] })).toBeNull()

      moneyMonth.mockResolvedValue(month(zero))
      recordSpending.mockReturnValue(new Promise(() => undefined))
      const view = await render()
      expect(plain(view.get('.change').text())).toBe('−100% vs the same day of August')
      useSpendingQueueStore().record({
        id: 'eeeeeeee-0000-4000-8000-00000000000e',
        spentOn: '2026-09-27',
        amount: amd('1500'),
        categoryId: BEAUTY,
        note: 'Taxi',
      })
      await flushPromises()
      expect(view.text()).toContain('Not counted yet: 1 spending is being sent')
      expect(view.find('.change').exists()).toBe(false)
    })

    // Adversarial Б2: a closed month says «−100 %» no more than the running one over what waits.
    it('must not fire: a closed month’s «−100 %» over a spending waiting a rate', async () => {
      expect(
        await change(
          {
            ...empty(),
            month: '2026-08',
            rateKind: 'frozen',
            previousSpent: amd('20000'),
            uncounted: [parseMoney('20', 'USD')],
          },
          '/money?month=2026-08',
        ),
      ).toBeNull()
    })

    it('must not fire: an answer kept from before the field says nothing, never «vs August» whole', async () => {
      expect(await change({ previousToDay: null })).toBeNull()
    })

    it('must not fire: nothing by the same day before is no percent', async () => {
      expect(await change({ previousToDay: { day: 12, spent: amd('0') } })).toBeNull()
    })
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
})

describe('MoneyView: «Остаток» and «Пришло» (MOL-134)', () => {
  // «На счетах 31 авг.» is a closed month's tile (MOL-183, В-18 «б»).
  const tile = async (patch: Partial<MoneyMonthView>) => {
    moneyMonth.mockResolvedValue(month({ month: '2026-08', rateKind: 'frozen', ...patch }))
    return plain((await render('/money?month=2026-08')).get('.tile.rest').text())
  }

  it('the running month has no tile of the accounts: «Пришло» is the whole width (В-18 «б»)', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    expect(view.find('.tile.rest').exists()).toBe(false)
    expect(view.findAll('.tiles .tile')).toHaveLength(1)
    expect(view.get('.tiles').classes()).toContain('one')
  })

  it('no account at all: «—» and the way to make one, never «no rate» (adversarial Г1)', async () => {
    const text = await tile({ rest: null, accountsFrom: null })
    expect(text).toContain('—')
    expect(text).toContain(en.spending.rest_add)
    expect(text).not.toMatch(/rate/i)
  })

  it('a month before the first account says when the accounts begin (В-4, Г2)', async () => {
    const text = await tile({ rest: null, accountsFrom: '2026-08-16' })
    expect(text).toContain('Accounts start on Aug 16')
    expect(text).not.toContain(en.spending.rest_add)
  })

  it('every account removed: the way back, not a new one (self-review 4)', async () => {
    const text = await tile({ rest: null, accountsFrom: null, accountsRemoved: true })
    expect(text).toContain(en.spending.rest_removed)
    expect(text).not.toContain(en.spending.rest_add)
  })

  it('names what each figure misses, never a bare «≈ 0» (adversarial Г3, А, Б, З)', async () => {
    const text = await tile({
      rest: {
        total: rub('1000'),
        spendable: rub('1000'),
        uncounted: {
          total: [{ name: 'Euro safe', balance: parseMoney('8470', 'EUR') }],
          spendable: [],
        },
        operationsUncounted: { total: 1, spendable: 0 },
      },
    })
    expect(text).toContain('not counted: Euro safe €8,470')
    expect(text).toContain('1 operation not counted')
    // «Without savings» says something «all» does not: it is complete, so it is drawn.
    expect(text).toContain('without savings ≈ ₽1,000')
  })

  it('must not fire: without savings equal to all, the second figure is not repeated', async () => {
    const text = await tile({})
    expect(text).toContain('≈ ₽51,212')
    expect(text).not.toContain('without savings')
  })

  it('a card in debt is a figure below zero, and the minus is printed', async () => {
    const text = await tile({
      rest: {
        total: { minor: -50000n, currency: 'RUB' },
        spendable: { minor: -50000n, currency: 'RUB' },
        uncounted: { total: [], spendable: [] },
        operationsUncounted: { total: 0, spendable: 0 },
      },
    })
    expect(text).toContain('≈ −₽500')
  })

  it('«Пришло» says where a salary went, both ways (Н-2)', async () => {
    moneyMonth.mockResolvedValue(month({ shiftedIn: ['2026-08-31'], shiftedOut: ['2026-09-26'] }))
    const text = plain((await render()).get('.tiles .tile').text())
    expect(text).toContain('with the salary of Aug 31')
    expect(text).toContain('the salary of Sep 26 counts next month')
  })
})

describe('MoneyView: the sheet', () => {
  it('checks on «Save»: no amount and no category are two errors, and nothing is queued', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    await button(view, en.spending.summary.add).trigger('click')
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
    await button(view, en.spending.summary.add).trigger('click')
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
})

describe('MoneyView: what the review found (MOL-82)', () => {
  it('Д: a cleared day is named, nothing is queued, and nothing falls over', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    await button(view, en.spending.summary.add).trigger('click')
    await risen()
    const dialog = document.querySelector('dialog[open]')
    const amount = dialog?.querySelector<HTMLInputElement>('input[inputmode=decimal]')
    if (!amount) throw new Error('no amount')
    amount.value = '500'
    amount.dispatchEvent(new Event('input'))
    dialog?.querySelector<HTMLInputElement>(`input[value="${BEAUTY}"]`)?.click()
    for (const day of ['', '1999-12-31']) {
      const date = dialog?.querySelector<HTMLInputElement>('input[type=date]')
      if (!date) throw new Error('no date')
      date.value = day
      date.dispatchEvent(new Event('input'))
      await flushPromises()
      await pressUntil(en.spending.sheet.save, () => {
        expect(dialog?.textContent).toContain(en.spending.sheet.bad_day)
      })
    }
    expect(useSpendingQueueStore().pending).toEqual([])
    expect(recordSpending).not.toHaveBeenCalled()
  })

  // The month is the phone's (MOL-121): at 20:10 UTC Yerevan is in October and the phone, in the
  // zone the tests run in, still in September; its own midnight is what opens October.
  it('З: back in view after midnight at the end of the month, the new month is not «the future»', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const next = () => view.find(`button[aria-label="${en.spending.month_next}"]`)
    vi.setSystemTime(new Date('2026-09-30T20:10:00Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    await next().trigger('click')
    await flushPromises()
    expect(moneyMonth).not.toHaveBeenCalledWith('2026-10', undefined)

    vi.setSystemTime(new Date('2026-10-01T00:10:00Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    await next().trigger('click')
    await flushPromises()
    expect(moneyMonth).toHaveBeenLastCalledWith('2026-10', undefined)
  })

  it('Т-7: the way to one’s categories is there before anything is spent', async () => {
    moneyMonth.mockResolvedValue({ ...empty(), previousSpent: amd('100') })
    const view = await render()
    expect(view.find('a[href="/money/categories"]').exists()).toBe(true)
  })

  it('«Куда ушли» is the ring, one way into «Графики» of the same month (MOL-156, MOL-158)', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    expect(view.find('.donut a').attributes('href')).toBe('/money/charts?month=2026-09')
    expect(view.findAll('.donut .ring path')).toHaveLength(1)
  })
})

describe('MoneyView: the ways out, one figure each (MOL-81, MOL-159)', () => {
  const entries = (view: VueWrapper) =>
    view.findAll(`nav[aria-label="${en.spending.entries_label}"] a`).map((link) => ({
      href: link.attributes('href'),
      text: plain(link.text()),
      label: link.attributes('aria-label'),
    }))

  it('six rows under the ring: «Траты» and «Бюджет» of the month, then what is «now»', async () => {
    moneyMonth.mockResolvedValue(
      month({ count: 43, incomeCount: 2, budget: { planned: true, left: amd('118700') } }),
    )
    const view = await render()
    expect(entries(view)).toEqual([
      {
        href: '/money/spendings',
        text: `${en.spending.list.title}43`,
        label: 'Spendings, 43',
      },
      {
        href: '/money/budget',
        text: `${en.budget.title}֏118,700 left`,
        label: `${en.budget.title}, ֏118,700 left`,
      },
      // No live account: «Счета» is a row here, with no figure — «На счетах сейчас» is not over the
      // switcher (MOL-183, С-10).
      { href: '/money/accounts', text: en.accounts.title, label: undefined },
      {
        href: '/money/exchange',
        text: `${en.exchange.title}4.62 ֏/₽`,
        label: `${en.exchange.title}, 4.62 ֏/₽`,
      },
      { href: '/money/incomes', text: `${en.income.title}2`, label: `${en.income.title}, 2` },
      {
        href: '/money/categories',
        text: `${en.spending.categories_link}1`,
        label: `${en.spending.categories_link}, 1`,
      },
    ])
  })

  it('«Траты» open on the month shown, and the summary stays on it as a spending goes to another', async () => {
    moneyMonth.mockResolvedValue(month({ month: '2026-08', rateKind: 'frozen' }))
    const view = await render('/money?month=2026-08')
    expect(entries(view)[0]?.href).toBe('/money/spendings?month=2026-08')
    recordSpending.mockReturnValue(new Promise(() => undefined))
    await button(view, en.spending.summary.add).trigger('click')
    await risen()
    const amount = document.querySelector<HTMLInputElement>('dialog[open] input[inputmode=decimal]')
    if (!amount) throw new Error('no amount')
    amount.value = '700'
    amount.dispatchEvent(new Event('input'))
    document.querySelector<HTMLInputElement>(`dialog[open] input[value="${BEAUTY}"]`)?.click()
    await flushPromises()
    await pressUntil(en.spending.sheet.save, () => {
      expect(document.querySelector('dialog[open]')).toBeNull()
    })
    expect(router.currentRoute.value.query.month).toBe('2026-08')
  })

  it('must not fire: the central bank’s rate is not «my rate», and a count not sent is no figure', async () => {
    moneyMonth.mockResolvedValue(
      month({
        count: null,
        incomeCount: null,
        rate: {
          base: 'RUB',
          quote: 'AMD',
          scaled: 4_860_000n,
          source: 'official',
          asOf: new Date(),
        },
      }),
    )
    const view = await render()
    const texts = entries(view).map(({ text }) => text)
    expect(texts).toContain(en.spending.list.title)
    expect(texts).toContain(en.exchange.title)
    expect(texts).toContain(en.income.title)
  })

  it('запасной курс назван не банком пары, а молчащим банком пары (MOL-110, ревью 1)', async () => {
    const rate = (source: 'official' | 'fallback') => ({
      base: 'GEL' as const,
      quote: 'RUB' as const,
      scaled: 32_040_000n,
      source,
      asOf: new Date(),
    })
    moneyMonth.mockResolvedValue(month({ rate: rate('fallback') }))
    const fallback = await render()
    expect(fallback.text()).toContain('not a rate of the National Bank of Georgia')
    expect(fallback.text()).not.toContain('At the National Bank of Georgia rate')

    moneyMonth.mockResolvedValue(month({ rate: rate('official') }))
    const official = await render()
    expect(official.text()).toContain('At the National Bank of Georgia rate')
  })

  it('a newcomer has no «Траты» — nothing to see there — and the rest are there', async () => {
    moneyMonth.mockResolvedValue(empty())
    const view = await render()
    expect(view.text()).toContain(en.spending.empty.title)
    expect(entries(view).map(({ href }) => href)).toEqual([
      '/money/budget',
      '/money/accounts',
      '/money/exchange',
      '/money/incomes',
      '/money/categories',
    ])
  })

  // A month that will not load must not close the way to the income that broke it (review Т-1).
  it('stands beside the error and under the skeleton, with no figure of the month', async () => {
    moneyMonth.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await render()
    expect(failed.text()).toContain(en.spending.load_error.title)
    expect(entries(failed).map(({ href }) => href)).toContain('/money/incomes')
    expect(entries(failed)[0]).toMatchObject({ text: en.spending.list.title })

    moneyMonth.mockReturnValue(new Promise(() => undefined))
    const loading = await render()
    expect(loading.find('.skeleton').exists()).toBe(true)
    expect(entries(loading)).toHaveLength(6)
  })

  it('says of «Бюджет» what is over, that no plan is set, and nothing it does not know (MOL-117)', async () => {
    const figure = async (budget: MoneyMonthView['budget']) => {
      moneyMonth.mockResolvedValue(month({ month: '2026-08', rateKind: 'frozen', budget }))
      const view = await render('/money?month=2026-08')
      return entries(view)[1]
    }
    expect(
      await figure({ planned: true, left: { minor: -250_000n, currency: 'AMD' } }),
    ).toMatchObject({
      href: '/money/budget?month=2026-08',
      text: `${en.budget.title}֏2,500 over`,
    })
    expect(await figure({ planned: false, left: null })).toMatchObject({
      text: `${en.budget.title}${en.budget.entry.none}`,
    })
    expect(await figure({ planned: true, left: null })).toMatchObject({ text: en.budget.title })
    expect(await figure(null)).toMatchObject({ text: en.budget.title })
  })

  it('must not fire: offline with nothing kept — the screens behind it would show nothing either', async () => {
    online(false)
    moneyMonth.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(entries(view)).toEqual([])
  })
})

describe('MoneyView: the summary of the month (MOL-159)', () => {
  it('the tiles are figures, not buttons, and a closed month names the day of its rest', async () => {
    moneyMonth.mockResolvedValue(month({ month: '2026-08', rateKind: 'frozen' }))
    const view = await render('/money?month=2026-08')
    expect(view.findAll('.tiles button')).toHaveLength(0)
    expect(view.get('.tile.rest').text()).toContain('On accounts Aug 31')
  })

  it('the journal is «Траты»’s: no row of it here', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    expect(view.text()).not.toContain('Barber')
    expect(view.find('[data-row]').exists()).toBe(false)
  })

  it('an empty month says so inside «Куда ушли», unless a spending of it waits on the phone', async () => {
    moneyMonth.mockResolvedValue({ ...empty(), previousSpent: amd('100') })
    recordSpending.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.get('.donut').text()).toContain('No spendings in September yet')
    useSpendingQueueStore().record({
      id: 'eeeeeeee-0000-4000-8000-000000000009',
      spentOn: '2026-09-27',
      amount: amd('1500'),
      categoryId: BEAUTY,
      note: 'Taxi',
    })
    await flushPromises()
    expect(view.get('.donut').text()).not.toContain('No spendings in September yet')
    expect(view.get('.donut').text()).toContain('The first spending of September is on its way')
    expect(view.text()).toContain('Not counted yet: 1 spending is being sent')
  })
})

describe('MoneyView: what the review of MOL-159 found', () => {
  async function refused(spentOn: string): Promise<void> {
    recordSpending.mockRejectedValue(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN))
    const queue = useSpendingQueueStore()
    queue.record({
      id: 'eeeeeeee-0000-4000-8000-0000000000aa',
      spentOn,
      amount: amd('1500'),
      categoryId: BEAUTY,
      note: 'Taxi',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(1)
    })
    await flushPromises()
  }

  // Every edge the rounds found, at once: wherever its row would be, a refused spending is counted
  // here and leads to «Траты», whose «Не приняты» holds it — never a card whose one action drops it.
  const full = () =>
    month({
      count: 45,
      cursor: { day: '2026-09-26', moment: 0, id: BARBER },
      remaining: 44,
      remainingFrom: '2026-09-01',
      remainingTo: '2026-09-25',
    })
  it.each([
    ['this month', () => ({ ...empty(), previousSpent: amd('100') }), '2026-09-27'],
    ['another month (К)', () => ({ ...empty(), previousSpent: amd('100') }), '2026-08-15'],
    ['a day no page has reached (Е)', full, '2026-09-01'],
    ['a month not answered yet', null, '2026-09-27'],
  ] as const)(
    'А–Н: a refused spending of %s is counted here and leads to «Траты», never to «Discard»',
    async (_, answer, day) => {
      if (answer) moneyMonth.mockResolvedValue(answer())
      else moneyMonth.mockReturnValue(new Promise(() => undefined))
      const view = await render()
      await refused(day)
      expect(view.text()).toContain('1 spending not accepted')
      expect(view.text()).not.toContain(en.spending.rejected_other.title)
      expect(view.findAll('button').some((one) => one.text() === en.spending.sheet.dismiss)).toBe(
        false,
      )
      await button(view, en.spending.summary.refused_open).trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('money-spendings')
    },
  )

  it('А: a refused spending of the month keeps «Куда ушли» from saying «no spendings»', async () => {
    moneyMonth.mockResolvedValue({ ...empty(), previousSpent: amd('100') })
    const view = await render()
    await refused('2026-09-27')
    expect(view.get('.donut').text()).not.toContain(en.spending.month_empty)
  })

  it('И: a refused amendment of a row no page has brought is counted all the same', async () => {
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
    queue.amend('eeeeeeee-0000-4000-8000-000000000009', 1, {
      spentOn: '2026-09-02',
      amount: amd('6000'),
      categoryId: BEAUTY,
      note: 'Rent',
    })
    await vi.waitFor(() => {
      expect(queue.rejected).toHaveLength(1)
    })
    await flushPromises()
    expect(view.text()).toContain('1 spending not accepted')
    expect(view.text()).not.toContain(en.spending.rejected_other.title)
  })

  it('Ж of round 2: a spending removed on «Траты» keeps its «Undo» here, with what is left of it', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const queue = useSpendingQueueStore()
    // What «Удалить» on «Траты» leaves in the queue's store, four seconds before the step back.
    queue.lastRemoved = {
      undo: { id: BARBER },
      title: 'Barber',
      amount: '֏5,000',
      stamp: Date.now() - 4000,
      left: 10,
      at: Date.now() - 4000,
    }
    await flushPromises()
    expect(view.text()).toContain('Deleted: Barber')
    expect(view.get('.undo-strip .count').text()).toBe('6')
    await button(view, en.spending.restore).trigger('click')
    await vi.waitFor(() => {
      expect(restoreSpending).toHaveBeenCalledWith(BARBER)
    })
    expect(view.text()).not.toContain('Deleted: Barber')
  })

  it('З of round 3: held on «Траты» past its ten seconds, «Undo» goes on here from what the strip had left', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const queue = useSpendingQueueStore()
    // Removed fifteen seconds ago, a finger on the strip most of that time: it said 9 just now.
    queue.lastRemoved = {
      undo: { id: BARBER },
      title: 'Barber',
      amount: '֏5,000',
      stamp: Date.now() - 15_000,
      left: 9,
      at: Date.now(),
    }
    await flushPromises()
    expect(view.get('.undo-strip .count').text()).toBe('9')
    expect(queue.lastRemoved).not.toBeNull()
  })

  it('Ж, must not fire: a removal whose ten seconds ran out while no screen showed it is not offered', async () => {
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const queue = useSpendingQueueStore()
    queue.lastRemoved = {
      undo: { id: BARBER },
      title: 'Barber',
      amount: '֏5,000',
      stamp: Date.now() - 11_000,
      left: 10,
      at: Date.now() - 11_000,
    }
    await flushPromises()
    expect(view.text()).not.toContain('Deleted: Barber')
    expect(queue.lastRemoved).toBeNull()
  })

  // «Счета», «Обмен денег» and «Категории» are «now», not the month's (handoff MOL-157 01): their
  // figures come from answers of their own and stand whatever the month is doing.
  it('Г: under the error and the skeleton, «Счета» and «Категории» keep their way and figure', async () => {
    moneyMonth.mockResolvedValueOnce(month())
    const first = await render()
    first.unmount()
    moneyMonth.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render('/money?month=2026-08')
    expect(view.text()).toContain(en.spending.load_error.title)
    const links = view.findAll(`nav[aria-label="${en.spending.entries_label}"] a`)
    const label = (href: string) =>
      links.find((link) => link.attributes('href') === href)?.attributes('aria-label')
    // With no live account «Счета» is a row with no figure (MOL-183, С-10), never «0».
    expect(links.some((link) => link.attributes('href') === '/money/accounts')).toBe(true)
    expect(label('/money/accounts')).toBeUndefined()
    expect(label('/money/categories')).toBe(`${en.spending.categories_link}, 1`)
    expect(label('/money/spendings?month=2026-08')).toBeUndefined()
  })
})

// MOL-183, Ф-27, С-8, С-10: what is on the accounts now, over the switcher, in the income currency.
describe('MoneyView: «На счетах сейчас»', () => {
  const account = (patch: Partial<MoneyAccountView> = {}): MoneyAccountView => ({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Cash',
    currency: 'AMD',
    savings: false,
    start: amd('100000'),
    startOn: '2026-09-01',
    balance: amd('100000'),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: false,
    archivedAt: null,
    revision: 1,
    ...patch,
  })
  const overview = (patch: Partial<MoneyAccountsResponse> = {}): MoneyAccountsResponse => ({
    ...noAccounts(),
    accounts: [
      account(),
      account({ id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Piggy', savings: true }),
    ],
    incomeTotals: {
      currency: 'RUB',
      total: rub('827310'),
      spendable: rub('731310'),
      savings: rub('96000'),
      uncounted: 0,
    },
    ...patch,
  })
  const ways = (view: VueWrapper) =>
    view
      .findAll(`nav[aria-label="${en.spending.entries_label}"] a`)
      .map((link) => link.attributes('href'))

  it('stands over the switcher in roubles, with «можно тратить» and the count, and leads to «Счета»', async () => {
    moneyAccounts.mockResolvedValue(overview())
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const card = view.get('.now')
    const text = plain(card.text())
    expect(text).toContain(en.spending.summary.accounts_now)
    expect(text).toContain('≈ ₽827,310')
    expect(text).toContain('free to spend ≈ ₽731,310')
    expect(text).toContain('2 accounts')
    const link = card.get('a')
    expect(link.attributes('href')).toBe('/money/accounts')
    expect(plain(link.attributes('aria-label') ?? '')).toBe(
      'Accounts: in accounts now ≈ ₽827,310, free to spend ≈ ₽731,310',
    )
    const switcher = view.get(`button[aria-label="${en.spending.month_prev}"]`).element
    expect(
      card.element.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // One way, one button: no row of «Счета» among the ways out.
    expect(ways(view)).not.toContain('/money/accounts')
  })

  it('is «now», not the month’s: a closed month shows it the same', async () => {
    moneyAccounts.mockResolvedValue(overview())
    moneyMonth.mockResolvedValue(month({ month: '2026-08', rateKind: 'frozen' }))
    const view = await render('/money?month=2026-08')
    expect(plain(view.get('.now').text())).toContain('≈ ₽827,310')
  })

  it('says what it leaves out, as «Счета» do, and a debt is «плохо» (С-17)', async () => {
    moneyAccounts.mockResolvedValue(
      overview({
        incomeTotals: {
          currency: 'RUB',
          total: rub('1000'),
          spendable: { minor: -50000n, currency: 'RUB' },
          savings: rub('1500'),
          uncounted: 1,
        },
      }),
    )
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    const text = plain(view.get('.now').text())
    expect(text).toContain('1 account not counted — no rate')
    // Read out too: the link's name is all a screen reader hears of the card.
    expect(view.get('.now a').attributes('aria-label')).toContain('1 account not counted — no rate')
    expect(text).toContain('free to spend ≈ −₽500')
    expect(view.get('.now .spendable').classes()).toContain('negative')
    expect(view.get('.now .figure').classes()).not.toContain('negative')
  })

  it('must not fire: every account removed — «Счета» is a row among the ways out instead', async () => {
    moneyAccounts.mockResolvedValue(
      overview({ accounts: [account({ archivedAt: new Date('2026-09-20T10:00:00Z') })] }),
    )
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    expect(view.find('.now').exists()).toBe(false)
    expect(ways(view)).toContain('/money/accounts')
  })

  it('must not fire: «Счета» did not answer and nothing is kept — the way to them stays a row', async () => {
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    expect(view.find('.now').exists()).toBe(false)
    expect(ways(view)).toContain('/money/accounts')
  })

  it('must not fire: «Счета» kept before the totals in the income currency are no figure to show', async () => {
    moneyAccounts.mockResolvedValue(overview({ incomeTotals: null }))
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    expect(view.find('.now').exists()).toBe(false)
    expect(ways(view)).toContain('/money/accounts')
  })

  // Adversarial А3: kept from before, the figures name their hour, as «Счета» do — never «сейчас».
  it('kept from before, it names the hour «Счета» answered at: the server failed, or offline', async () => {
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'))
    moneyAccounts.mockResolvedValue(overview({ countedAt: new Date('2026-09-24T08:00:00Z') }))
    moneyMonth.mockResolvedValue(month())
    ;(await render()).unmount()

    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failing = await render()
    const card = plain(failing.get('.now').text())
    expect(card).toContain('In accounts as of Sep 24')
    expect(card).not.toContain(en.spending.summary.accounts_now)
    expect(failing.get('.now a').attributes('aria-label')).toContain('in accounts as of Sep 24')
    failing.unmount()

    online(false)
    moneyAccounts.mockRejectedValue(new TypeError('network'))
    moneyMonth.mockRejectedValue(new TypeError('network'))
    const offline = await render()
    expect(plain(offline.get('.now').text())).toContain('In accounts as of Sep 24')
  })

  // Adversarial Б1: an answer earlier in the app's life does not make a failed read «now».
  it('a read that failed after an answer of this session names the hour too', async () => {
    moneyAccounts.mockResolvedValue(overview({ countedAt: new Date('2026-09-27T05:00:00Z') }))
    moneyMonth.mockResolvedValue(month())
    const view = await render()
    expect(plain(view.get('.now').text())).toContain(en.spending.summary.accounts_now)
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    await useAccountsStore().refresh()
    await flushPromises()
    expect(plain(view.get('.now').text())).toContain('In accounts as of')
    // The next answer is «now» again.
    moneyAccounts.mockResolvedValue(overview())
    await useAccountsStore().refresh()
    await flushPromises()
    expect(plain(view.get('.now').text())).toContain(en.spending.summary.accounts_now)
  })

  it('must not fire: kept and being read again, it is still «now» — no hour flickers at every opening', async () => {
    moneyAccounts.mockResolvedValue(overview())
    moneyMonth.mockResolvedValue(month())
    ;(await render()).unmount()
    moneyAccounts.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(plain(view.get('.now').text())).toContain(en.spending.summary.accounts_now)
  })

  // Adversarial А2: the server that broke the month broke «Счета» too, and «Повторить» asks both.
  it('«Повторить» of the month asks «Счета» again too', async () => {
    moneyAccounts.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(overview())
    moneyMonth.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(month())
    const view = await render()
    expect(view.find('.now').exists()).toBe(false)
    await button(view, en.state.retry).trigger('click')
    await flushPromises()
    expect(moneyAccounts).toHaveBeenCalledTimes(2)
    expect(view.find('.now').exists()).toBe(true)
    expect(ways(view)).not.toContain('/money/accounts')
  })

  // Adversarial А5: the skeleton's «≈» line is the two currencies' — one currency has none.
  it('the skeleton draws «≈» under the figure only where the two currencies differ', async () => {
    // «Счета» kept from an opening before: the skeleton takes their currencies as it comes.
    const lines = async (accounts: MoneyAccountsResponse) => {
      localStorage.clear()
      moneyAccounts.mockResolvedValue(accounts)
      // The month failed: only «Счета» are kept, and the month comes under the skeleton.
      moneyMonth.mockRejectedValue(new ApiError(ERROR.INTERNAL))
      ;(await render()).unmount()
      moneyMonth.mockReturnValue(new Promise(() => undefined))
      const view = await render()
      return view.find('.sum-card .approx-line').exists()
    }
    expect(await lines(overview())).toBe(true)
    expect(
      await lines(
        overview({
          incomeTotals: {
            currency: 'AMD',
            total: amd('1000'),
            spendable: amd('1000'),
            savings: amd('0'),
            uncounted: 0,
          },
        }),
      ),
    ).toBe(false)
    // Nothing known of the accounts: the usual case, two currencies.
    expect(await lines(noAccounts())).toBe(true)
  })

  // Adversarial Б3: nothing known at all is two currencies, and «Счета» answering while the month
  // loads does not change the skeleton under the switcher.
  it('the skeleton with nothing known draws «≈», and keeps its shape as «Счета» answer', async () => {
    let answer: (value: MoneyAccountsResponse) => void = () => undefined
    moneyAccounts.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    moneyMonth.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.sum-card .approx-line').exists()).toBe(true)
    answer(
      overview({
        incomeTotals: {
          currency: 'AMD',
          total: amd('1000'),
          spendable: amd('1000'),
          savings: amd('0'),
          uncounted: 0,
        },
      }),
    )
    await flushPromises()
    expect(view.find('.now').exists()).toBe(true)
    expect(view.find('.sum-card .approx-line').exists()).toBe(true)
  })

  it('stands by the month’s error and its skeleton: it has an answer of its own', async () => {
    moneyAccounts.mockResolvedValue(overview())
    moneyMonth.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await render()
    expect(failed.text()).toContain(en.spending.load_error.title)
    expect(failed.find('.now').exists()).toBe(true)

    moneyMonth.mockReturnValue(new Promise(() => undefined))
    const loading = await render()
    expect(loading.find('.skeleton').exists()).toBe(true)
    expect(loading.find('.now').exists()).toBe(true)
  })
})
