/**
 * The sheet of a spending on the phone's day (MOL-121), through «Деньги» as the person meets it. The
 * tests run in UTC, a phone west of Yerevan: at 20:30 UTC on the 28th it is the 28th here and already
 * the 29th in Yerevan — where a day of Yerevan would show.
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { JournalKey, MoneyMonthView, SpendingBody } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useSpendingHandoffStore } from '@/stores/spendingHandoff'
import type { SpendingPrefill } from '@/stores/spendingHandoff'
import MoneySpendingsView from '@/views/MoneySpendingsView.vue'
import MoneyView from '@/views/MoneyView.vue'

const moneyMonth = vi.fn<(month: string, cursor?: JournalKey) => Promise<MoneyMonthView>>()
const recordSpending = vi.fn<(body: SpendingBody) => Promise<unknown>>()
const amendSpending = vi.fn<(id: string, body: unknown) => Promise<unknown>>()
vi.mock('@/api', () => ({
  api: {
    moneyMonth: (month: string, cursor?: JournalKey) => moneyMonth(month, cursor),
    recordSpending: (body: SpendingBody) => recordSpending(body),
    amendSpending: (id: string, body: unknown) => amendSpending(id, body),
    moneyAccounts: () =>
      Promise.resolve({
        spendCurrency: 'AMD' as const,
        accounts: [],
        totals: { total: amd('0'), spendable: amd('0'), savings: amd('0'), uncounted: 0 },
        unassigned: 0,
        countedAt: new Date(),
      }),
    spendingCategories: () => Promise.resolve({ categories: [] }),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = 'ffffffff-0000-4000-8000-000000000001'
const ROW = 'eeeeeeee-0000-4000-8000-000000000001'
const amd = (text: string) => parseMoney(text, 'AMD')
const rub = (text: string) => parseMoney(text, 'RUB')

function month(spentOn: string): MoneyMonthView {
  return {
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: amd('1000'),
    uncounted: [],
    foreign: [],
    spentIncome: rub('217'),
    income: rub('0'),
    incomeUncounted: [],
    count: 0,
    incomeCount: 0,
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    budget: null,
    rate: { base: 'RUB', quote: 'AMD', scaled: 4_620_000n, source: 'personal', asOf: new Date() },
    rateKind: 'live',
    previousSpent: amd('345620'),
    previousToDay: null,
    byCategory: [{ categoryId: OTHER, amount: amd('1000') }],
    slices: [{ categoryId: OTHER, amount: amd('1000'), count: 1, level: 1000 }],
    categories: [{ id: OTHER, preset: 'other', name: null, colour: null, archived: false }],
    days: [
      {
        day: spentOn,
        total: amd('1000'),
        estimated: false,
        uncounted: [],
        entries: [
          {
            kind: 'manual',
            spending: {
              id: ROW,
              spentOn,
              amount: amd('1000'),
              categoryId: OTHER,
              note: 'Reconciliation',
              place: null,
              rate: null,
              accountId: null,
              debited: null,
              transferId: null,
              revision: 1,
              amendedAt: null,
            },
            counted: amd('1000'),
          },
        ],
      },
    ],
    cursor: null,
    remaining: 0,
    remainingFrom: null,
    remainingTo: null,
  }
}

const views: VueWrapper[] = []
let clock = 0

/** «Деньги» by default; the rows of the journal are on «Траты» (MOL-159). */
async function render(handed?: SpendingPrefill, path = '/money'): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  if (handed) useSpendingHandoffStore().hand(handed)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(path === '/money' ? MoneyView : MoneySpendingsView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

async function risen(): Promise<void> {
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

async function pressUntil(text: string, happened: () => void): Promise<void> {
  await vi.waitFor(() => {
    clock += 1000
    const found = [...document.querySelectorAll('dialog[open] button')].find(
      (one) => one.textContent.trim() === text,
    )
    if (found instanceof HTMLButtonElement) found.click()
    happened()
  })
}

/** Opens the one row, types a new note — the smallest amendment there is. */
async function amendNote(view: VueWrapper): Promise<HTMLDialogElement> {
  await view.find('.list-row').trigger('click')
  await risen()
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
  if (!dialog) throw new Error('no sheet')
  const note = dialog.querySelector<HTMLInputElement>(
    `input[placeholder="${en.spending.sheet.note_placeholder}"]`,
  )
  if (!note) throw new Error('no note field')
  note.value = 'Reconciliation: coins in the other jacket'
  note.dispatchEvent(new Event('input'))
  await flushPromises()
  return dialog
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [moneyMonth, recordSpending, amendSpending]) mock.mockReset()
  recordSpending.mockResolvedValue(undefined)
  amendSpending.mockResolvedValue(undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-28T20:30:00Z'))
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

function dayField(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('dialog[open] input[type="date"]')
  if (!found) throw new Error('no day field')
  return found
}

describe('SpendingSheet: the phone’s day (MOL-121)', () => {
  it('a new spending starts on the phone’s today, and allows no later (Т-3)', async () => {
    moneyMonth.mockResolvedValue(month('2026-09-28'))
    const view = await render()
    await view
      .findAll('button')
      .find((one) => one.text().trim() === en.spending.summary.add)
      ?.trigger('click')
    await risen()
    expect(dayField().value).toBe('2026-09-28')
    expect(dayField().max).toBe('2026-09-28')
  })

  it('a new spending on a day the phone has not reached is refused (must not fire)', async () => {
    moneyMonth.mockResolvedValue(month('2026-09-28'))
    const view = await render()
    await view
      .findAll('button')
      .find((one) => one.text().trim() === en.spending.summary.add)
      ?.trigger('click')
    await risen()
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    const amount = dialog?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    if (!amount) throw new Error('no amount field')
    amount.value = '1000'
    amount.dispatchEvent(new Event('input'))
    dayField().value = '2026-09-29'
    dayField().dispatchEvent(new Event('input'))
    dayField().dispatchEvent(new Event('change'))
    await flushPromises()
    await pressUntil(en.spending.sheet.save, () => {
      expect(dialog?.textContent).toContain(en.spending.sheet.bad_day)
    })
    expect(recordSpending).not.toHaveBeenCalled()
  })

  // The correction of a check is dated by the day of the check, and a spending typed further east
  // by a day this phone has not reached; its note must still be amendable here (adversarial Л).
  it('a spending of a day ahead of the phone keeps its day and takes a new note', async () => {
    moneyMonth.mockResolvedValue(month('2026-09-29'))
    const view = await render(undefined, '/money/spendings')
    await amendNote(view)
    expect(dayField().max).toBe('2026-09-29')
    await pressUntil(en.spending.sheet.save, () => {
      expect(amendSpending).toHaveBeenCalled()
    })
    expect(amendSpending.mock.calls[0]?.[1]).toMatchObject({
      spentOn: '2026-09-29',
      note: 'Reconciliation: coins in the other jacket',
    })
  })

  it('the journal says «Today» of the phone’s day, and «Yesterday» once its midnight is past (Т-3, adversarial Н)', async () => {
    moneyMonth.mockResolvedValue(month('2026-09-28'))
    const view = await render(undefined, '/money/spendings')
    expect(view.text()).toContain('Today · September 28')
    vi.setSystemTime(new Date('2026-09-29T00:20:00Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(view.text()).toContain('Yesterday · September 28')
  })
})

describe('SpendingSheet: a record with no purchases handed over (MOL-78, В-1)', () => {
  const GROCERIES = 'ffffffff-0000-4000-8000-000000000002'
  const withGroceries = (archived: boolean): MoneyMonthView => {
    const base = month('2026-09-28')
    return {
      ...base,
      categories: [
        ...base.categories,
        { id: GROCERIES, preset: 'groceries', name: null, colour: null, archived },
      ],
    }
  }

  it('«Деньги» open the sheet on the shop and the day of the record, in «Продукты»', async () => {
    moneyMonth.mockResolvedValue(withGroceries(false))
    await render({ place: 'Ереван Сити', day: '2026-09-27' })
    await risen()
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    expect(dialog).not.toBeNull()
    expect(dayField().value).toBe('2026-09-27')
    const place = dialog?.querySelector<HTMLInputElement>(
      `input[placeholder="${en.spending.sheet.place_placeholder}"]`,
    )
    expect(place?.value).toBe('Ереван Сити')
    const chosen = dialog?.querySelector<HTMLInputElement>('.chips-field input:checked')
    expect(chosen?.value ?? chosen?.id ?? '').not.toBe('')
    expect(chosen?.closest('label')?.textContent).toContain(en.spending.category.groceries)
    expect(useSpendingHandoffStore().handed).toBeNull()
  })

  it('must not fire: «Продукты» removed from the choice is not chosen', async () => {
    moneyMonth.mockResolvedValue(withGroceries(true))
    await render({ place: 'SAS', day: '2026-09-27' })
    await risen()
    expect(document.querySelector('dialog[open] .chips-field input:checked')).toBeNull()
  })

  it('must not fire: «Деньги» opened by hand open no sheet', async () => {
    moneyMonth.mockResolvedValue(withGroceries(false))
    await render()
    await risen()
    expect(document.querySelector('dialog[open]')).toBeNull()
  })
})

/**
 * Е-10 (MOL-184): one spending, one «≈». A spending in roubles written on the 20th keeps the rate of
 * its day, 4,30 ֏; the running month's is 4,62. The journal counts it by its own — so must its sheet.
 */
describe('SpendingSheet: the «≈» of a spending written is its own day’s (MOL-184, Е-10)', () => {
  const kept = {
    base: 'RUB',
    quote: 'AMD',
    scaled: 4_300_000n,
    source: 'official',
    asOf: new Date(),
  } as const

  function inRoubles(rate: typeof kept | null): MoneyMonthView {
    const base = month('2026-09-20')
    const [day] = base.days
    const [entry] = day?.entries ?? []
    if (!day || entry?.kind !== 'manual') throw new Error('no row')
    return {
      ...base,
      days: [
        {
          ...day,
          entries: [
            {
              ...entry,
              spending: { ...entry.spending, amount: rub('3500'), rate },
              counted: rate ? amd('15050') : null,
            },
          ],
        },
      ],
    }
  }

  async function opened(view: VueWrapper): Promise<HTMLDialogElement> {
    await view.find('.list-row').trigger('click')
    await risen()
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    if (!dialog) throw new Error('no sheet')
    return dialog
  }
  const conversion = (dialog: HTMLDialogElement) =>
    (dialog.querySelector('.conversion')?.textContent ?? '').replace(/\s/g, ' ').trim()
  async function type(dialog: HTMLDialogElement, selector: string, value: string): Promise<void> {
    const field = dialog.querySelector<HTMLInputElement>(selector)
    if (!field) throw new Error(`no ${selector}`)
    field.value = value
    field.dispatchEvent(new Event('input'))
    await flushPromises()
  }

  it('untouched, it is the journal’s «≈», by the rate of its day — not the running month’s', async () => {
    moneyMonth.mockResolvedValue(inRoubles(kept))
    const view = await render(undefined, '/money/spendings')
    expect(view.get('.list-row').text()).toContain('15,050')
    const dialog = await opened(view)
    expect(conversion(dialog)).toBe(
      '≈ ֏15,050 at the Central Bank of Armenia rate of 4.30 ֏ per 1 ₽',
    )
  })

  it('an amount put right is counted by the same rate: the server keeps it for the same day', async () => {
    moneyMonth.mockResolvedValue(inRoubles(kept))
    const dialog = await opened(await render(undefined, '/money/spendings'))
    await type(dialog, 'input[inputmode="decimal"]', '1000')
    expect(conversion(dialog)).toContain('≈ ֏4,300')
  })

  it('must not fire: a day moved is another fact — counted as one typed anew', async () => {
    moneyMonth.mockResolvedValue(inRoubles(kept))
    const dialog = await opened(await render(undefined, '/money/spendings'))
    dayField().value = '2026-09-21'
    dayField().dispatchEvent(new Event('input'))
    dayField().dispatchEvent(new Event('change'))
    await flushPromises()
    expect(conversion(dialog)).toBe('≈ ֏16,170 at my rate of 4.62 ֏ per 1 ₽')
  })

  it('no rate that day: the server takes one anew, and the sheet says so instead of guessing', async () => {
    moneyMonth.mockResolvedValue(inRoubles(null))
    const dialog = await opened(await render(undefined, '/money/spendings'))
    expect(conversion(dialog)).toBe(en.spending.sheet.conversion_later)
  })
})
