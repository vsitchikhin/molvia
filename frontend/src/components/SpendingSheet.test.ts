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
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
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
const trip = vi.fn<(id: string) => Promise<unknown>>()
vi.mock('@/api', () => ({
  api: {
    trip: (id: string) => trip(id),
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

/** The sheet on top: «Дата, заметка, место» over the spending, once it is open. */
function topSheet(): HTMLDialogElement {
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
  const top = open.at(-1)
  if (!top) throw new Error('no sheet')
  return top
}

/** The line «Дата, заметка, место» of the spending sheet (MOL-199). */
function detailsRow(): HTMLButtonElement {
  const row = document.querySelector<HTMLButtonElement>('dialog[open] .nav-row.nav-field')
  if (!row) throw new Error('no line of the day, the note and the place')
  return row
}

/** Opens «Дата, заметка, место» from its line, as a tap does. */
async function openDetails(): Promise<HTMLDialogElement> {
  detailsRow().click()
  await risen()
  const top = topSheet()
  expect(top.textContent).toContain(en.spending.sheet.details_title)
  return top
}

function textField(placeholder: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    `dialog[open] input[placeholder="${placeholder}"]`,
  )
  if (!found) throw new Error(`no field «${placeholder}»`)
  return found
}

async function typeInto(field: HTMLInputElement, value: string): Promise<void> {
  field.value = value
  field.dispatchEvent(new Event('input'))
  await flushPromises()
}

/** Opens the one row, types a new note — the smallest amendment there is; the details stay open. */
async function amendNote(view: VueWrapper): Promise<HTMLDialogElement> {
  await view.find('.list-row').trigger('click')
  await risen()
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
  if (!dialog) throw new Error('no sheet')
  await openDetails()
  await typeInto(
    textField(en.spending.sheet.note_placeholder),
    'Reconciliation: coins in the other jacket',
  )
  return dialog
}

/**
 * «Готово»: back to the spending, with nothing but it open. A memory history sends no popstate, so the
 * step off the details is told it landed — else it stands in flight for a second, and the spending's
 * own close is dropped as a second step.
 */
async function detailsDone(): Promise<void> {
  await pressUntil(en.spending.sheet.details_done, () => {
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
  })
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  await risen()
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [moneyMonth, recordSpending, amendSpending, trip]) mock.mockReset()
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
    await openDetails()
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
    dialog?.querySelector<HTMLInputElement>('.chips-field input')?.click()
    await flushPromises()
    await openDetails()
    dayField().value = '2026-09-29'
    dayField().dispatchEvent(new Event('input'))
    dayField().dispatchEvent(new Event('change'))
    await flushPromises()
    await detailsDone()
    // The first field wrong is behind the line: «Сохранить» opens it on that field (MOL-199).
    await pressUntil(en.spending.sheet.save, () => {
      expect(topSheet().textContent).toContain(en.spending.sheet.bad_day)
    })
    await flushPromises()
    expect(document.activeElement).toBe(dayField())
    expect(detailsRow().getAttribute('aria-invalid')).toBe('true')
    expect(recordSpending).not.toHaveBeenCalled()
  }, 25_000)

  // The correction of a check is dated by the day of the check, and a spending typed further east
  // by a day this phone has not reached; its note must still be amendable here (adversarial Л).
  it('a spending of a day ahead of the phone keeps its day and takes a new note', async () => {
    moneyMonth.mockResolvedValue(month('2026-09-29'))
    const view = await render(undefined, '/money/spendings')
    await amendNote(view)
    expect(dayField().max).toBe('2026-09-29')
    await detailsDone()
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
    expect(detailsRow().textContent.trim()).toBe('Yesterday · Ереван Сити')
    await openDetails()
    expect(dayField().value).toBe('2026-09-27')
    expect(textField(en.spending.sheet.place_placeholder).value).toBe('Ереван Сити')
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
    await openDetails()
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

  // Review 2, Р2-А1: a measure that would lay the chosen chip past the rows lifts it first, and the
  // sheet's order — the list «More…» — takes it first too: one order for both.
  it('a chosen chip lifted by a measure stands first in the list «More…» too', async () => {
    const widths: Record<string, number> = {
      [en.spending.category.other]: 80,
      [en.spending.category.cafe]: 200,
      [en.spending.category.rent]: 70,
      [en.spending.category.pets]: 70,
      [en.spending.sheet.more]: 66,
    }
    let row = 358
    // Set inside the observer the chips make: a plain `null` would be narrowed to nothing to call.
    let resized = null as (() => void) | null
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly callback: () => void
        chips = false
        constructor(callback: () => void) {
          this.callback = callback
        }
        observe(target: Element): void {
          if (!target.classList.contains('chips-field')) return
          this.chips = true
          resized = () => {
            this.callback()
          }
        }
        // The sheet measures its own height too: only the chips' observer lets the chips go.
        disconnect(): void {
          if (this.chips) resized = null
        }
      },
    )
    const style = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const computed = style(element, pseudo)
      if (!(element instanceof HTMLElement && element.classList.contains('ruler'))) return computed
      return new Proxy(computed, {
        get: (target, key) => (key === 'columnGap' ? '8px' : Reflect.get(target, key)),
      })
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = this.classList.contains('chips-field')
        ? row
        : this.parentElement?.classList.contains('ruler')
          ? (widths[this.textContent.trim()] ?? 0)
          : null
      // The spy stands on HTMLElement; Element's own is the browser's.
      if (width === null) return Element.prototype.getBoundingClientRect.call(this)
      return { width, height: 44, top: 0, left: 0, right: width, bottom: 44, x: 0, y: 0 } as DOMRect
    })
    const shown = () =>
      [...document.querySelectorAll('dialog[open] .chips .row input[type="radio"]')].map((radio) =>
        radio.getAttribute('value'),
      )
    try {
      moneyMonth.mockResolvedValue(frequentMonth())
      const view = await render()
      await view
        .findAll('button')
        .find((one) => one.text().trim() === en.spending.summary.add)
        ?.trigger('click')
      await risen()
      expect(shown()).toEqual([OTHER, CAFE, RENT, PETS])
      document
        .querySelector<HTMLInputElement>(`dialog[open] .chips input[value="${PETS}"]`)
        ?.click()
      await flushPromises()
      expect(shown()).toEqual([OTHER, CAFE, RENT, PETS])

      // The phone turned: the field is 250, and «Pets» would stand past the rows.
      row = 250
      resized?.()
      await flushPromises()
      expect(shown()).toEqual([PETS, OTHER])
      await pressUntil(en.spending.sheet.more, () => {
        expect(document.querySelectorAll('dialog[open]')).toHaveLength(2)
      })
      const list = [...document.querySelectorAll('dialog[open] [role="radio"]')]
      expect(list.map((one) => one.textContent.trim())).toEqual([
        en.spending.category.pets,
        en.spending.category.other,
        en.spending.category.cafe,
        en.spending.category.rent,
      ])
    } finally {
      vi.unstubAllGlobals()
    }
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

describe('SpendingSheet: «Дата, заметка, место» behind one line (MOL-199, Ф-17)', () => {
  async function newSpending(): Promise<HTMLDialogElement> {
    moneyMonth.mockResolvedValue(month('2026-09-28'))
    const view = await render()
    await view
      .findAll('button')
      .find((one) => one.text().trim() === en.spending.summary.add)
      ?.trigger('click')
    await risen()
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    if (!dialog) throw new Error('no sheet')
    return dialog
  }

  it('says the day and «no note» in the form, the whole of it to a screen reader, and no field', async () => {
    const dialog = await newSpending()
    expect(detailsRow().textContent.trim()).toBe('Today · no note')
    expect(detailsRow().getAttribute('aria-label')).toBe('Date, note, place: Today · no note')
    expect(detailsRow().getAttribute('aria-haspopup')).toBe('dialog')
    expect(dialog.querySelector('input[type="date"]')).toBeNull()
    expect(
      dialog.querySelector(`input[placeholder="${en.spending.sheet.note_placeholder}"]`),
    ).toBeNull()
  })

  it('what is typed behind it is in the line at once, and «Done» keeps it', async () => {
    await newSpending()
    await openDetails()
    await typeInto(textField(en.spending.sheet.note_placeholder), 'Lunch')
    await typeInto(textField(en.spending.sheet.place_placeholder), 'Kinza')
    expect(detailsRow().textContent.trim()).toBe('Today · Lunch · Kinza')
    await detailsDone()
    expect(detailsRow().textContent.trim()).toBe('Today · Lunch · Kinza')
  })

  it('«Save» with a note that cannot be saved opens the details on the note, and the line says so', async () => {
    const dialog = await newSpending()
    const amount = dialog.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    if (!amount) throw new Error('no amount field')
    await typeInto(amount, '1000')
    dialog.querySelector<HTMLInputElement>('.chips-field input')?.click()
    await flushPromises()
    await openDetails()
    // A bell: a character that draws nothing, which the server refuses.
    await typeInto(textField(en.spending.sheet.note_placeholder), `Lunch${String.fromCharCode(7)}`)
    await detailsDone()
    await pressUntil(en.spending.sheet.save, () => {
      expect(topSheet().textContent).toContain(en.spending.sheet.bad_text)
    })
    await flushPromises()
    expect(document.activeElement).toBe(textField(en.spending.sheet.note_placeholder))
    expect(detailsRow().getAttribute('aria-invalid')).toBe('true')
    expect(recordSpending).not.toHaveBeenCalled()
    // Put right, the mark goes with the error.
    await typeInto(textField(en.spending.sheet.note_placeholder), 'Lunch')
    expect(detailsRow().getAttribute('aria-invalid')).toBeNull()
  })

  // Р-4: opened over «Выберите категорию», the details would hide the error above them (self-review 4).
  it('must not fire: a category not chosen takes the focus before a wrong note, the details shut', async () => {
    const dialog = await newSpending()
    const amount = dialog.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    if (!amount) throw new Error('no amount field')
    await typeInto(amount, '1000')
    await openDetails()
    await typeInto(textField(en.spending.sheet.note_placeholder), `Lunch${String.fromCharCode(7)}`)
    await detailsDone()
    await pressUntil(en.spending.sheet.save, () => {
      expect(dialog.textContent).toContain(en.spending.sheet.bad_category)
    })
    await flushPromises()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    expect(document.activeElement).toBe(dialog.querySelector('.chips-field input'))
    expect(detailsRow().getAttribute('aria-invalid')).toBe('true')
    expect(recordSpending).not.toHaveBeenCalled()
  })

  it('must not fire: a wrong sum before it takes the focus, and the details stay shut', async () => {
    const dialog = await newSpending()
    await openDetails()
    await typeInto(textField(en.spending.sheet.note_placeholder), `Lunch${String.fromCharCode(7)}`)
    await detailsDone()
    await pressUntil(en.spending.sheet.save, () => {
      expect(dialog.textContent).toContain(en.spending.sheet.bad_amount)
    })
    await flushPromises()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    expect(document.activeElement).toBe(dialog.querySelector('input[inputmode="decimal"]'))
    // Still marked: what is wrong behind the line shows before it is opened.
    expect(detailsRow().getAttribute('aria-invalid')).toBe('true')
  })
})

describe('SpendingSheet: the items of a trip’s summary (MOL-199, Ф-13, Ф-15)', () => {
  const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'
  const answer = {
    id: TRIP,
    accountId: null,
    debited: null,
    currency: 'AMD',
    expenses: [
      { id: 'e1', item: { name: 'Milk' }, quantity: null, amount: amd('600') },
      { id: 'e2', item: { name: 'Bread' }, quantity: null, amount: amd('250') },
    ],
  }

  async function summary(): Promise<VueWrapper> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const actor = useActorStore()
    actor.id = ACTOR
    actor.state = 'ready'
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money/spendings')
    const view = mount(SpendingSheet, {
      attachTo: document.body,
      props: {
        open: true,
        target: {
          kind: 'trip',
          day: '2026-09-25',
          row: {
            kind: 'trip',
            key: TRIP,
            tripId: TRIP,
            placeName: 'SAS',
            items: 2,
            amount: amd('850'),
            counted: null,
          },
        },
        categories: [],
        nameOf: () => 'Groceries',
        spendCurrency: 'AMD',
      },
      global: { plugins: [pinia, router, createAppI18n('en')] },
    })
    views.push(view)
    // The sheet takes no tap until it has come up (MOL-69).
    await risen()
    return view
  }

  it('while they load, four rows of bars stand in the card of the items, hidden from a reader', async () => {
    trip.mockReturnValue(new Promise(() => undefined))
    const view = await summary()
    const bars = view.get('.skeleton .items')
    expect(bars.findAll('.ghost-item')).toHaveLength(4)
    expect(bars.element.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(view.text()).not.toContain(en.spending.sheet.trip_items_error)
  })

  it('failed, the quiet card says so, and «Try again» reads the trip again', async () => {
    trip.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(answer)
    const view = await summary()
    const state = view.get('.state')
    expect(state.text()).toContain(en.spending.sheet.trip_items_error)
    expect(view.find('.items').exists()).toBe(false)
    const retry = view.findAll('.state button').find((one) => one.text() === en.state.retry)
    if (!retry) throw new Error('no «Try again»')
    await retry.trigger('click')
    await flushPromises()
    expect(trip).toHaveBeenCalledTimes(2)
    expect(trip).toHaveBeenLastCalledWith(TRIP)
    expect(view.find('.state').exists()).toBe(false)
    expect(view.findAll('.items .item').map((one) => one.text())).toEqual([
      expect.stringContaining('Milk'),
      expect.stringContaining('Bread'),
    ])
  })

  // «Повторить» over a server that hangs, the sheet closed and opened again and read: the first read's
  // refusal, come last, must not stand over the items the later one put there (self-review 1).
  it('must not fire: a read that answers after a later one changes nothing', async () => {
    let refuse: (error: unknown) => void = () => undefined
    trip
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          refuse = reject
        }),
      )
      .mockResolvedValue(answer)
    const view = await summary()
    const retry = view.findAll('.state button').find((one) => one.text() === en.state.retry)
    if (!retry) throw new Error('no «Try again»')
    await retry.trigger('click')
    await flushPromises()
    expect(view.find('.skeleton').exists()).toBe(true)
    await view.setProps({ open: false })
    await view.setProps({ open: true })
    await flushPromises()
    expect(view.findAll('.items .item')).toHaveLength(2)
    refuse(new ApiError(ERROR.INTERNAL))
    await flushPromises()
    expect(trip).toHaveBeenCalledTimes(3)
    expect(view.find('.state').exists()).toBe(false)
    expect(view.findAll('.items .item')).toHaveLength(2)
  })

  // Offline is no error: the screen's strip under the sheet says it, and there is nothing to retry.
  it('must not fire: offline, no red card and no «Try again», the line of the code', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    trip.mockRejectedValue(new TypeError('Failed to fetch'))
    const view = await summary()
    expect(view.text()).toContain(en.spending.sheet.trip_items_offline)
    expect(view.find('.state').exists()).toBe(false)
  })
})
