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
import SpendingSheet from '@/components/SpendingSheet.vue'

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
    categories: [
      { id: OTHER, preset: 'other', name: null, colour: null, icon: null, archived: false },
    ],
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
    frequent: [],
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
  }, 15_000)

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
  }, 10_000)

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
        { id: GROCERIES, preset: 'groceries', name: null, colour: null, icon: null, archived },
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

  function inRoubles(
    rate: typeof kept | null,
    counted = rate ? amd('15050') : null,
  ): MoneyMonthView {
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
              counted,
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

  // No snapshot that counts — none known when it was written: the server counts the row by the rate
  // of its day as it reads the month and takes that rate on «Сохранить», but does not send it (owner's
  // «а» of review Р2-2, adversarial А1).
  it('no snapshot, the row counted: untouched, the sheet says the row’s figure', async () => {
    moneyMonth.mockResolvedValue(inRoubles(null, amd('15050')))
    const view = await render(undefined, '/money/spendings')
    expect(view.get('.list-row').text()).toContain('15,050')
    const dialog = await opened(view)
    expect(conversion(dialog)).toBe('≈ ֏15,050 at the rate of the day')
  })

  it('no snapshot, the amount put right: the figure is the server’s to count', async () => {
    moneyMonth.mockResolvedValue(inRoubles(null, amd('15050')))
    const dialog = await opened(await render(undefined, '/money/spendings'))
    await type(dialog, 'input[inputmode="decimal"]', '1000')
    expect(conversion(dialog)).toBe(en.spending.sheet.conversion_later)
  })

  it('no rate of its day at all: the row is «не посчитано», and the sheet does not guess', async () => {
    moneyMonth.mockResolvedValue(inRoubles(null, null))
    const dialog = await opened(await render(undefined, '/money/spendings'))
    expect(conversion(dialog)).toBe(en.spending.sheet.conversion_later)
  })
})

describe('SpendingSheet: the chips by frequency, the chosen one first (MOL-198, В-2 «а»)', () => {
  const CAFE = 'c0000000-0000-4000-8000-000000000001'
  const RENT = 'c0000000-0000-4000-8000-000000000002'
  const PETS = 'c0000000-0000-4000-8000-000000000003'
  const preset = (id: string, key: 'cafe' | 'rent' | 'pets') =>
    ({ id, preset: key, name: null, colour: null, icon: null, archived: false }) as const

  /** Five categories, «Кафе» and «Прочее» frequent, the one spending of the journal in «Аренда». */
  function frequentMonth(): MoneyMonthView {
    const base = month('2026-09-28')
    const [day] = base.days
    const [entry] = day?.entries ?? []
    if (!day || entry?.kind !== 'manual') throw new Error('no row')
    return {
      ...base,
      categories: [
        preset(CAFE, 'cafe'),
        preset(RENT, 'rent'),
        preset(PETS, 'pets'),
        ...base.categories,
      ],
      frequent: [OTHER, CAFE],
      days: [
        { ...day, entries: [{ ...entry, spending: { ...entry.spending, categoryId: RENT } }] },
      ],
    }
  }
  /** The chips as they stand — every one, since nothing is laid out here. */
  const chips = () =>
    [...document.querySelectorAll('dialog[open] .chips label.chip input')].map((radio) =>
      radio.getAttribute('value'),
    )

  it('a new spending stands the frequent ones first, the rest in the list’s order, none chosen', async () => {
    moneyMonth.mockResolvedValue(frequentMonth())
    const view = await render()
    await view
      .findAll('button')
      .find((one) => one.text().trim() === en.spending.summary.add)
      ?.trigger('click')
    await risen()
    expect(chips()).toEqual([OTHER, CAFE, RENT, PETS])
    expect(document.querySelector('dialog[open] .chips input:checked')).toBeNull()
  }, 15_000)

  it('an amendment stands its own category first; a tap on another moves no chip', async () => {
    moneyMonth.mockResolvedValue(frequentMonth())
    const view = await render(undefined, '/money/spendings')
    await view.find('.list-row').trigger('click')
    await risen()
    expect(chips()).toEqual([RENT, OTHER, CAFE, PETS])
    const cafe = document.querySelector<HTMLInputElement>(
      `dialog[open] .chips input[value="${CAFE}"]`,
    )
    cafe?.click()
    await flushPromises()
    expect(cafe?.checked).toBe(true)
    expect(chips()).toEqual([RENT, OTHER, CAFE, PETS])
  }, 15_000)

  it('one chosen in «More…» stands first on the way back', async () => {
    moneyMonth.mockResolvedValue(frequentMonth())
    const view = await render(undefined, '/money/spendings')
    await view.find('.list-row').trigger('click')
    await risen()
    await pressUntil(en.spending.sheet.more, () => {
      expect(document.querySelectorAll('dialog[open]')).toHaveLength(2)
    })
    await risen()
    const pets = [...document.querySelectorAll<HTMLElement>('dialog[open] [role="radio"]')].find(
      (row) => row.textContent.trim() === en.spending.category.pets,
    )
    pets?.click()
    await flushPromises()
    // One chosen stands first; the one chosen before goes back to its place by frequency.
    expect(chips()).toEqual([PETS, OTHER, CAFE, RENT])
    expect(document.querySelector('dialog[open] .chips input:checked')?.getAttribute('value')).toBe(
      PETS,
    )
  }, 15_000)

  // Adversarial А2: the list stands in the order of the chips — the chosen one first there too.
  it('the list «More…» stands in the order of the chips', async () => {
    moneyMonth.mockResolvedValue(frequentMonth())
    const view = await render(undefined, '/money/spendings')
    await view.find('.list-row').trigger('click')
    await risen()
    expect(chips()).toEqual([RENT, OTHER, CAFE, PETS])
    await pressUntil(en.spending.sheet.more, () => {
      expect(document.querySelectorAll('dialog[open]')).toHaveLength(2)
    })
    const rows = [...document.querySelectorAll('dialog[open] [role="radio"]')]
    expect(rows.map((row) => row.textContent.trim())).toEqual([
      en.spending.category.rent,
      en.spending.category.other,
      en.spending.category.cafe,
      en.spending.category.pets,
    ])
  }, 15_000)

  // Adversarial А4: a return from «More…» by «‹», a choice there or not, stands the chosen one first.
  it('a chip tapped, «More…» and «‹»: the chosen one stands first on the way back', async () => {
    moneyMonth.mockResolvedValue(frequentMonth())
    const view = await render()
    await view
      .findAll('button')
      .find((one) => one.text().trim() === en.spending.summary.add)
      ?.trigger('click')
    await risen()
    document.querySelector<HTMLInputElement>(`dialog[open] .chips input[value="${PETS}"]`)?.click()
    await flushPromises()
    // A tap moves no chip.
    expect(chips()).toEqual([OTHER, CAFE, RENT, PETS])
    await pressUntil(en.spending.sheet.more, () => {
      expect(document.querySelectorAll('dialog[open]')).toHaveLength(2)
    })
    await risen()
    const list = [...document.querySelectorAll('dialog[open]')].at(-1)
    list?.querySelector<HTMLButtonElement>(`button[aria-label="${en.nav.back_label}"]`)?.click()
    // A memory history sends no `popstate`: the step lands as the browser's would.
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    await flushPromises()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    expect(chips()).toEqual([PETS, OTHER, CAFE, RENT])
  }, 15_000)

  // Р-4 and requirement 7 (self-review №1): an answer landing while the sheet is up moves no chip — a
  // new category goes to the end, one gone is taken out — and the next opening takes the new order.
  it('an answer while the sheet is up moves no chip; the next opening takes its order', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const actor = useActorStore()
    actor.id = ACTOR
    actor.state = 'ready'
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money')
    const preset = (id: string, key: 'cafe' | 'rent' | 'pets' | 'other') =>
      ({ id, preset: key, name: null, colour: null, icon: null, archived: false }) as const
    const TAXI = 'c0000000-0000-4000-8000-000000000009'
    const taxi = {
      id: TAXI,
      preset: null,
      name: 'Taxi',
      colour: 1,
      icon: 'taxi',
      archived: false,
    } as const
    const props = {
      open: false,
      target: { kind: 'add' } as const,
      categories: [preset(CAFE, 'cafe'), preset(RENT, 'rent'), preset(PETS, 'pets')],
      frequent: [RENT],
      nameOf: (one: { preset: string | null; name: string | null }) => one.name ?? one.preset ?? '',
      spendCurrency: 'AMD' as const,
    }
    const sheet = mount(SpendingSheet, {
      props,
      attachTo: document.body,
      global: { plugins: [pinia, router, createAppI18n('en')] },
    })
    views.push(sheet)
    await sheet.setProps({ open: true })
    await risen()
    expect(chips()).toEqual([RENT, CAFE, PETS])

    // «Животные» gone, «Taxi» new and the most frequent, «Кафе» now before «Аренда».
    await sheet.setProps({
      categories: [preset(CAFE, 'cafe'), preset(RENT, 'rent'), taxi],
      frequent: [TAXI, CAFE, RENT],
    })
    await flushPromises()
    expect(chips()).toEqual([RENT, CAFE, TAXI])

    await sheet.setProps({ open: false })
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    await flushPromises()
    await sheet.setProps({ open: true })
    await risen()
    expect(chips()).toEqual([TAXI, CAFE, RENT])
  }, 15_000)
})
