import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type { MoneyChartMonthView, MoneyChartYearView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { localDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import MoneyChartsViewScreen from './MoneyChartsView.vue'

const moneyChartYear = vi.fn<(year: string) => Promise<MoneyChartYearView>>()
const moneyChartMonth = vi.fn<(month: string) => Promise<MoneyChartMonthView>>()
vi.mock('@/api', () => ({
  api: {
    moneyChartYear: (year: string) => moneyChartYear(year),
    moneyChartMonth: (month: string) => moneyChartMonth(month),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const GROCERIES = 'ffffffff-0000-4000-8000-000000000001'
const CAFE = 'ffffffff-0000-4000-8000-000000000002'
const OTHER = 'ffffffff-0000-4000-8000-000000000009'
const amd = (text: string) => parseMoney(text, 'AMD')
const rub = (text: string) => parseMoney(text, 'RUB')
const plain = (text: string) => text.replace(/\s/g, ' ')

type YearMonth = MoneyChartYearView['months'][number]

/** A month of the year as the server sends it: data in August and September of 2026, the rest quiet. */
function yearMonth(month: string, data?: Partial<YearMonth>): YearMonth {
  const kind = data ? 'data' : month > '2026-09' ? 'future' : 'before'
  return {
    month,
    kind,
    spent: amd('0'),
    uncounted: [],
    spentIncome: null,
    income: rub('0'),
    incomeUncounted: [],
    difference: null,
    change: null,
    spentLevel: 0,
    incomeLevel: 0,
    spentIncomeLevel: null,
    ...data,
  }
}

const CALENDAR = Array.from(
  { length: 12 },
  (_, index) => `2026-${String(index + 1).padStart(2, '0')}`,
)

function yearCharts(patch: Partial<MoneyChartYearView> = {}): MoneyChartYearView {
  const august = {
    spent: amd('311960'),
    spentIncome: rub('71387'),
    income: rub('120000'),
    difference: rub('48613'),
    change: 73,
    spentLevel: 1000,
    incomeLevel: 1000,
    spentIncomeLevel: 595,
  }
  const september = {
    spent: amd('274523'),
    spentIncome: rub('63800'),
    income: rub('120000'),
    difference: rub('56200'),
    change: 2,
    spentLevel: 880,
    incomeLevel: 1000,
    spentIncomeLevel: 532,
  }
  const point = (month: string, amount: string, level: number) => ({
    month,
    amount: amd(month === '2026-08' || month === '2026-09' ? amount : '0'),
    change: month === '2026-09' ? 235 : null,
    level: month === '2026-08' || month === '2026-09' ? level : 0,
  })
  return {
    year: '2026',
    running: true,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    monthsShown: 2,
    spent: amd('586483'),
    spentIncome: rub('135187'),
    uncounted: [],
    slices: [
      {
        categoryId: GROCERIES,
        amount: amd('400000'),
        income: rub('92000'),
        count: 1,
        level: 682,
        members: [],
      },
      {
        categoryId: CAFE,
        amount: amd('186483'),
        income: rub('43187'),
        count: 1,
        level: 318,
        members: [],
      },
    ],
    months: CALENDAR.map((month) =>
      yearMonth(month, month === '2026-08' ? august : month === '2026-09' ? september : undefined),
    ),
    average: null,
    averageFrom: '2026-11',
    closedCount: 1,
    comparedTo: '2026-09-30',
    differenceTotal: rub('104813'),
    differenceMissing: [],
    firstMonth: '2026-08',
    categories: [
      {
        category: { id: GROCERIES, preset: 'groceries', name: null, colour: null, archived: false },
        average: amd('17988'),
        averageLevel: 300,
        points: CALENDAR.map((month) => point(month, '60318', 1000)),
      },
      {
        category: { id: CAFE, preset: 'cafe', name: null, colour: null, archived: false },
        average: null,
        averageLevel: null,
        points: CALENDAR.map((month) => point(month, '20390', 1000)),
      },
    ],
    ...patch,
  }
}

const views: VueWrapper[] = []
let router: Router

const YEAR = '/money/charts?mode=year'

async function render(path = YEAR): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(MoneyChartsViewScreen, {
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

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  moneyChartYear.mockReset()
  moneyChartMonth.mockReset()
  online(true)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  document.body.innerHTML = ''
})

/** «Год» reads the phone's calendar: the running month and year are September 2026. */
function onSeptember30(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}

const charts = (view: VueWrapper) => view.findAll('fieldset.chart')

describe('MoneyChartsView (MOL-160): «Год», the four states', () => {
  onSeptember30()

  it('loads with a skeleton under «Месяц · Год» and «‹ 2026 ›», and asks for this year', async () => {
    moneyChartYear.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(view.text()).toContain(en.spending.charts.mode_year)
    expect(view.find('.switcher .month').text()).toBe('2026')
    expect(moneyChartYear).toHaveBeenCalledWith('2026')
    expect(moneyChartMonth).not.toHaveBeenCalled()
  })

  it('a failed read is red with «Try again», and trying again reads again', async () => {
    moneyChartYear
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockResolvedValue(yearCharts())
    const view = await render()
    expect(view.text()).toContain(en.spending.charts.load_error.title)
    expect(view.find('.state.bad').exists()).toBe(true)
    await view
      .findAll('button')
      .find((one) => one.text() === en.state.retry)
      ?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.spending.charts.spent_title)
  })

  it('offline with nothing kept is never red and has no «Try again»', async () => {
    online(false)
    moneyChartYear.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.spending.charts.offline.body)
    expect(view.text()).not.toContain(en.state.retry)
    expect(view.find('.state.bad').exists()).toBe(false)
  })

  it('offline with the year kept shows it under a yellow strip that says when', async () => {
    moneyChartYear.mockResolvedValueOnce(yearCharts())
    ;(await render()).unmount()
    online(false)
    moneyChartYear.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.find('.strip').text()).toContain('No connection. Charts as of')
    expect(plain(view.text())).toContain('֏274,523')
    expect(view.find('.state.bad').exists()).toBe(false)
  })

  it('a newcomer sees an offer, not twelve months of nothing', async () => {
    moneyChartYear.mockResolvedValue(
      yearCharts({ firstMonth: null, monthsShown: 0, slices: [], categories: [] }),
    )
    const view = await render()
    expect(view.text()).toContain(en.spending.charts.empty.title)
    expect(view.text()).not.toContain(en.spending.charts.spent_title)
  })
})

describe('MoneyChartsView (MOL-160): «Год»', () => {
  onSeptember30()

  it('the ring of the year: its months in the centre, each month at its own rate said under it', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    const ring = plain(view.find('.figure').text())
    expect(ring).toContain('2026 · 2 months')
    expect(ring).toContain('֏586,483')
    expect(ring).toContain('≈ ₽135,187')
    expect(view.text()).toContain(en.spending.charts.where_year_title)
    expect(view.text()).toContain(en.spending.charts.year_rate_note)
  })

  it('twelve months, the running one read by default against the usual to the same day (В-2)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    const [spent] = charts(view)
    expect(spent?.findAll('.label')).toHaveLength(12)
    // January to July are before the data, October to December still to come: nothing to choose.
    expect(spent?.findAll('input[type="radio"]')).toHaveLength(2)
    const text = plain(spent?.text() ?? '')
    expect(text).toContain('September 2026 · ongoing')
    expect(text).toContain('֏274,523')
    expect(text).toContain('≈ ₽63,800 · +2% against the usual by September 30')
  })

  it('a closed month is against the whole average, and a bar chosen moves only its own chart', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    await charts(view)[0]?.findAll('input[type="radio"]')[0]?.setValue(true)
    expect(plain(charts(view)[0]?.text() ?? '')).toContain('≈ ₽71,387 · +73% against the average')
    expect(plain(charts(view)[1]?.text() ?? '')).toContain('Difference · Sep')
  })

  it('says when the average comes, and the dashed line with its months once it has', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const few = await render()
    expect(plain(few.text())).toContain(
      'The average comes after October: three closed months are needed',
    )
    expect(charts(few)[0]?.find('.average').exists()).toBe(false)
    few.unmount()

    moneyChartYear.mockResolvedValue(
      yearCharts({
        average: { amount: amd('179841'), level: 576, from: '2025-10', to: '2026-08', months: 11 },
        averageFrom: null,
      }),
    )
    const view = await render()
    expect(plain(view.text())).toContain(
      '֏179,841 on average, October 2025 to August 2026, without the running month',
    )
    expect(charts(view)[0]?.find('.average').attributes('style')).toContain('height: 57.6%')
  })

  it('promises no date for a past year with too few months (Р-6)', async () => {
    moneyChartYear.mockResolvedValue(
      yearCharts({ year: '2025', running: false, averageFrom: null, closedCount: 2 }),
    )
    const view = await render('/money/charts?mode=year&year=2025')
    expect(plain(view.text())).toContain('Too few closed months for an average: 2 of 3')
  })

  it('«Разница» of the year, or the months that keep it from being counted (Р-7)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const whole = await render()
    expect(plain(whole.text())).toContain('Difference for 2026 ≈ +₽104,813')
    whole.unmount()

    moneyChartYear.mockResolvedValue(
      yearCharts({ differenceTotal: null, differenceMissing: ['2026-08'] }),
    )
    const view = await render()
    expect(plain(view.text())).toContain("The difference for 2026 can't be counted")
    expect(plain(view.text())).toContain('August')
  })

  it('draws «Ушло» of a month with no rate as not known, never as nothing spent', async () => {
    const base = yearCharts()
    const months = base.months.map((month) =>
      month.month === '2026-08'
        ? { ...month, spentIncome: null, spentIncomeLevel: null, difference: null }
        : month,
    )
    moneyChartYear.mockResolvedValue({ ...base, months })
    const view = await render()
    const flow = charts(view)[1]
    const bars = flow?.findAll('.bar:not(.quiet)') ?? []
    expect(bars[0]?.find('.fill.unknown').exists()).toBe(true)
    expect(bars[1]?.find('.fill.unknown').exists()).toBe(false)
  })

  it('a bookmark of the old period opens the year, and «Месяц» moves by replace (MOL-158)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    moneyChartMonth.mockReturnValue(new Promise(() => undefined))
    const view = await render('/money/charts?period=6')
    expect(router.currentRoute.value.query).toEqual({ mode: 'year' })
    expect(moneyChartYear).toHaveBeenCalledWith('2026')
    const replace = vi.spyOn(router, 'replace')
    await view.find('input[value="month"]').setValue(true)
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query.mode).toBeUndefined()
    expect(moneyChartMonth).toHaveBeenCalled()
  })

  it('the year moves by replace, back to the first year with data and never past this one (Р-9)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts({ firstMonth: '2025-11' }))
    const view = await render()
    const replace = vi.spyOn(router, 'replace')
    const [back, forward] = view.find('.switcher').findAll('button')
    expect(forward?.attributes('aria-disabled')).toBe('true')
    await back?.trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query).toEqual({ mode: 'year', year: '2025' })
    expect(moneyChartYear).toHaveBeenLastCalledWith('2025')
    const [first] = view.find('.switcher').findAll('button')
    expect(first?.attributes('aria-disabled')).toBe('true')
  })

  it('a year still to come, or no year, in the address is this one', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    await render('/money/charts?mode=year&year=2031')
    expect(moneyChartYear).toHaveBeenLastCalledWith('2026')
    await render('/money/charts?mode=year&year=abcd')
    expect(moneyChartYear).toHaveBeenLastCalledWith('2026')
  })

  it('another year reads its last month with data (Р-8)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    const months = CALENDAR.map((month) =>
      month.startsWith('2026')
        ? yearMonth(month.replace('2026', '2025'), {
            spent: amd('1000'),
            spentLevel: 500,
          })
        : yearMonth(month),
    )
    moneyChartYear.mockResolvedValue(yearCharts({ year: '2025', running: false, months }))
    await router.replace({ query: { mode: 'year', year: '2025' } })
    await flushPromises()
    expect(plain(charts(view)[0]?.text() ?? '')).toContain('December 2025')
  })

  it('opens on the largest category, or on the one it was sent for', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const first = await render()
    expect((first.find('select').element as HTMLSelectElement).value).toBe(GROCERIES)
    expect(plain(first.text())).toContain(
      '+235% against the usual by September 30 · ֏17,988 on average',
    )
    expect(first.text()).toContain(en.spending.charts.category_months_title)
    first.unmount()

    const view = await render(`/money/charts?mode=year&category=${CAFE}`)
    expect((view.find('select').element as HTMLSelectElement).value).toBe(CAFE)
  })

  it('says so when the address names a category the charts do not have (adversarial А)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render(
      '/money/charts?mode=year&category=ffffffff-0000-4000-8000-000000000099',
    )
    expect((view.find('select').element as HTMLSelectElement).value).toBe(GROCERIES)
    expect(plain(view.text())).toContain('That category is not on the charts — showing «Groceries»')
  })

  it('a category chosen goes into the address', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    await view.find('select').setValue(CAFE)
    await flushPromises()
    expect(router.currentRoute.value.query.category).toBe(CAFE)
  })

  it('a sector chosen on the ring chooses its category below, and letting it go leaves it (В-3)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    const replace = vi.spyOn(router, 'replace')
    const cafe = view.find(`.legend input[value="${CAFE}"]`)
    await cafe.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.category).toBe(CAFE)
    expect(replace).toHaveBeenCalledTimes(1)
    expect((view.find('select').element as HTMLSelectElement).value).toBe(CAFE)
    await view.find(`.legend input[value="${CAFE}"]`).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.category).toBe(CAFE)
  })

  it('keeps the bar a person chose when a new answer of the same year comes', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    await charts(view)[0]?.findAll('input[type="radio"]')[0]?.setValue(true)
    expect(plain(charts(view)[0]?.text() ?? '')).toContain('August 2026')
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(moneyChartYear).toHaveBeenCalledTimes(2)
    expect(plain(charts(view)[0]?.text() ?? '')).toContain('August 2026')
  })

  it('has neither the rate of the pair nor the exchanges: they are «Обмен денег»’s (Р-11)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts())
    const view = await render()
    expect(view.find('.rate-line').exists()).toBe(false)
    expect(view.find('.losses').exists()).toBe(false)
  })

  it('a newcomer has neither arrow, and the arrow back waits for the first answer (adversarial Д)', async () => {
    moneyChartYear.mockReturnValue(new Promise(() => undefined))
    const waiting = await render()
    const [back] = waiting.find('.switcher').findAll('button')
    expect(back?.attributes('aria-disabled')).toBe('true')
    waiting.unmount()

    moneyChartYear.mockResolvedValue(
      yearCharts({ firstMonth: null, monthsShown: 0, slices: [], categories: [] }),
    )
    const view = await render()
    const buttons = view.find('.switcher').findAll('button')
    expect(buttons.map((one) => one.attributes('aria-disabled'))).toEqual(['true', 'true'])
    await buttons[0]?.trigger('click')
    await flushPromises()
    expect(moneyChartYear).toHaveBeenLastCalledWith('2026')
  })

  it('names the day the server compared the running month by, not the phone’s (adversarial В)', async () => {
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'))
    moneyChartYear.mockResolvedValue(yearCharts({ comparedTo: '2026-09-15' }))
    const view = await render()
    expect(plain(charts(view)[0]?.text() ?? '')).toContain('+2% against the usual by September 15')
  })

  it('says why there is no average when every closed month is short, not «3 of 3» (adversarial Б)', async () => {
    moneyChartYear.mockResolvedValue(yearCharts({ averageFrom: null, closedCount: 3 }))
    const view = await render()
    expect(view.text()).toContain(en.spending.charts.year_avg_uncounted)
    expect(view.text()).not.toContain('3 of 3')
  })

  it('a category chosen in the list chooses its sector, or lets the sector go (owner’s Е)', async () => {
    moneyChartYear.mockResolvedValue(
      yearCharts({
        categories: [
          ...yearCharts().categories,
          {
            category: { id: OTHER, preset: 'other', name: null, colour: null, archived: false },
            average: null,
            averageLevel: null,
            points: CALENDAR.map((month) => ({ month, amount: amd('0'), change: null, level: 0 })),
          },
        ],
      }),
    )
    const view = await render()
    const radio = (id: string) =>
      view.find(`.legend input[value="${id}"]`).element as HTMLInputElement
    await view.find(`.legend input[value="${GROCERIES}"]`).trigger('click')
    await flushPromises()
    await view.find('select').setValue(CAFE)
    await flushPromises()
    expect(radio(CAFE).checked).toBe(true)
    expect(radio(GROCERIES).checked).toBe(false)
    expect(router.currentRoute.value.query.category).toBe(CAFE)

    await view.find('select').setValue(OTHER)
    await flushPromises()
    expect(
      view.findAll('.legend input').some((one) => (one.element as HTMLInputElement).checked),
    ).toBe(false)
  })

  it('lets «нет курса месяца» wrap in its column, never a sum (review 10)', async () => {
    const base = yearCharts()
    const months = base.months.map((month) =>
      month.month === '2026-09'
        ? { ...month, spentIncome: null, spentIncomeLevel: null, difference: null }
        : month,
    )
    moneyChartYear.mockResolvedValue({ ...base, months })
    const view = await render()
    const flow = charts(view)[1]
    expect(flow?.findAll('.value.words')).toHaveLength(2)
    expect(flow?.find('.value:not(.words)').text()).toContain('₽120,000')
  })

  it('must not fire: an answer that lost the race is not what the phone keeps', async () => {
    let first: (value: MoneyChartYearView) => void = () => undefined
    moneyChartYear
      .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce(yearCharts({ spent: amd('999999') }))
    const view = await render()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    first(yearCharts())
    await flushPromises()
    view.unmount()
    online(false)
    moneyChartYear.mockRejectedValue(new TypeError('network'))
    const again = await render()
    expect(again.find('.strip').exists()).toBe(true)
    expect(plain(again.text())).toContain('֏999,999')
  })

  it('an answer whose later read failed is still shown and kept, under the strip', async () => {
    let first: (value: MoneyChartYearView) => void = () => undefined
    moneyChartYear
      .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
      .mockRejectedValueOnce(new TypeError('network'))
    online(false)
    const view = await render()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    first(yearCharts())
    await flushPromises()
    expect(plain(view.text())).toContain('֏274,523')
    expect(localStorage.getItem(`molvia.chartyears.${ACTOR}`)).not.toBeNull()
    expect(view.find('.strip').text()).toContain('No connection. Charts as of')
  })

  it('must not fire: a later read that answers takes the strip away', async () => {
    moneyChartYear.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(yearCharts())
    online(false)
    const view = await render()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(plain(view.text())).toContain('֏274,523')
    expect(view.find('.strip').exists()).toBe(false)
  })
})

const RENT = 'ffffffff-0000-4000-8000-000000000003'
const PRESETS = ['groceries', 'cafe', 'rent', 'home', 'beauty', 'transport', 'telecom', 'pets']
const categoryOf = (index: number) => `ffffffff-0000-4000-8000-00000000000${String(index + 1)}`
const SEPTEMBER = '/money/charts?month=2026-09'

/** September 2026, closed: eight categories on the ring, the usual of June — August. */
function monthCharts(patch: Partial<MoneyChartMonthView> = {}): MoneyChartMonthView {
  const day = (index: number) => `2026-09-${String(index + 1).padStart(2, '0')}`
  return {
    month: '2026-09',
    running: false,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: amd('274523'),
    spentIncome: rub('63800'),
    uncounted: [],
    slices: [
      {
        categoryId: categoryOf(6),
        amount: amd('68076'),
        income: rub('15821'),
        count: 1,
        level: 248,
        members: [],
      },
      {
        categoryId: GROCERIES,
        amount: amd('60318'),
        income: rub('14018'),
        count: 1,
        level: 220,
        members: [],
      },
      {
        categoryId: categoryOf(3),
        amount: amd('51294'),
        income: rub('11921'),
        count: 1,
        level: 187,
        members: [],
      },
      {
        categoryId: categoryOf(4),
        amount: amd('43728'),
        income: rub('10162'),
        count: 1,
        level: 159,
        members: [],
      },
      {
        categoryId: CAFE,
        amount: amd('20390'),
        income: rub('4739'),
        count: 1,
        level: 74,
        members: [],
      },
      {
        categoryId: categoryOf(7),
        amount: amd('17917'),
        income: rub('4164'),
        count: 1,
        level: 65,
        members: [],
      },
      {
        categoryId: null,
        amount: amd('12800'),
        income: rub('2975'),
        count: 2,
        level: 47,
        members: [categoryOf(5), RENT],
      },
    ],
    usual: { from: '2026-06', to: '2026-08', months: 3 },
    comparedFrom: null,
    closed: ['2026-06', '2026-07', '2026-08'],
    firstMonth: '2026-06',
    deviations: [
      {
        categoryId: RENT,
        amount: amd('0'),
        average: amd('100875'),
        change: -100,
        level: 0,
        averageLevel: 1000,
      },
      {
        categoryId: categoryOf(6),
        amount: amd('68076'),
        average: amd('13900'),
        change: 390,
        level: 675,
        averageLevel: 138,
      },
      {
        categoryId: CAFE,
        amount: amd('20390'),
        average: amd('0'),
        change: null,
        level: 202,
        averageLevel: 0,
      },
    ],
    pace: {
      days: Array.from({ length: 30 }, (_, index) => ({
        day: day(index),
        cumulative: amd(String((index + 1) * 9000)),
        income: rub(String((index + 1) * 2000)),
        level: Math.round(((index + 1) * 1000) / 30),
      })),
      usual: Array.from({ length: 30 }, (_, index) => ({
        day: day(index),
        cumulative: amd(String((index + 1) * 6000)),
        level: Math.round(((index + 1) * 666) / 30),
      })),
    },
    categories: PRESETS.map((preset, index) => ({
      id: categoryOf(index),
      preset,
      name: null,
      colour: null,
      archived: false,
    })) as MoneyChartMonthView['categories'],
    ...patch,
  }
}

describe('MoneyChartsView (MOL-158): «Месяц»', () => {
  it('opens on the month of this phone when the address names none, and draws the skeleton', async () => {
    moneyChartMonth.mockReturnValue(new Promise(() => undefined))
    const view = await render('/money/charts')
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(moneyChartMonth).toHaveBeenCalledWith(localDay().slice(0, 7))
    expect(moneyChartYear).not.toHaveBeenCalled()
  })

  it('draws the ring with its centre and a legend, «Остальные» named under it', async () => {
    moneyChartMonth.mockResolvedValue(monthCharts())
    const view = await render(SEPTEMBER)
    const card = plain(view.findAll('section')[0]?.text() ?? '')
    expect(card).toContain('September')
    expect(card).toContain('֏274,523')
    expect(card).toContain('≈ ₽63,800')
    expect(view.findAll('.legend .row')).toHaveLength(7)
    expect(card).toContain('Others: transport and rent')
    expect(card).toContain(en.spending.charts.donut_order)
  })

  it('a row chosen fills the centre, and a second tap lets it go (review Р-4)', async () => {
    moneyChartMonth.mockResolvedValue(monthCharts())
    const view = await render(SEPTEMBER)
    const radio = view.find('.legend .row input')
    await radio.trigger('click')
    const centre = () => plain(view.find('.center').text())
    expect(centre()).toContain('֏68,076')
    expect(centre()).toContain('25% · ≈ ₽15,821')
    expect(view.find('.legend .row').classes()).toContain('chosen')
    expect(view.findAll('.ring .arc.muted')).toHaveLength(6)
    await radio.trigger('click')
    expect(centre()).toContain('֏274,523')
    expect(view.findAll('.ring .arc.muted')).toHaveLength(0)
  })

  it('against the usual: a percent with an arrow, «new» where the usual is nothing', async () => {
    moneyChartMonth.mockResolvedValue(monthCharts())
    const view = await render(SEPTEMBER)
    const rows = view.findAll('.rows .row').map((row) => plain(row.text()))
    expect(rows[0]).toContain('−100%')
    expect(rows[0]).toContain('֏0 · usually ֏100,875')
    expect(rows[1]).toContain('+390%')
    expect(rows[2]).toContain(en.spending.charts.vs_usual_new)
    expect(view.text()).toContain('September against the average of June — August')
  })

  it('with too few closed months the cards stay and name the first month with a comparison (handoff 3g, adversarial Г)', async () => {
    // A closed September, data from August: before it only August is closed; November is the first
    // month with three closed before it — never «after September», which is already past.
    moneyChartMonth.mockResolvedValue(
      monthCharts({
        usual: null,
        comparedFrom: '2026-11',
        closed: ['2026-08'],
        firstMonth: '2026-08',
        deviations: [],
        pace: { days: monthCharts().pace.days, usual: null },
      }),
    )
    const view = await render(SEPTEMBER)
    const text = plain(view.text())
    expect(text).toContain('The comparison starts with November')
    expect(text).toContain('Only August is closed before September.')
    expect(text).toContain('The usual month’s dashed line starts with November')
    expect(text).not.toContain('so far')
    expect(view.find('.usual').exists()).toBe(false)
    // No usual to set the day beside: the day in the income currency instead.
    expect(text).toContain('≈ ₽60,000')
  })

  it('the pace reads the last day of a closed month, and another one by the arrows', async () => {
    moneyChartMonth.mockResolvedValue(monthCharts())
    const view = await render(SEPTEMBER)
    const reading = () => plain(view.find('.pace .reading').text())
    expect(reading()).toContain('By September 30')
    expect(reading()).toContain('֏270,000')
    expect(reading()).toContain('usually by this day ֏180,000 · +50%')
    await view.find('.pace input[type="range"]').setValue('11')
    expect(reading()).toContain('By September 12')
    expect(reading()).toContain('֏108,000')
  })

  it('the month moves by replace and asks again; a new month lets the sector go', async () => {
    moneyChartMonth.mockResolvedValue(monthCharts())
    const view = await render(SEPTEMBER)
    await view.find('.legend .row input').trigger('click')
    moneyChartMonth.mockResolvedValue(monthCharts({ month: '2026-08' }))
    const replace = vi.spyOn(router, 'replace')
    await view.find(`button[aria-label="${en.spending.month_prev}"]`).trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query.month).toBe('2026-08')
    expect(moneyChartMonth).toHaveBeenLastCalledWith('2026-08')
    expect(view.find('.legend .row.chosen').exists()).toBe(false)
  })

  it('a newcomer sees an offer, not an empty ring', async () => {
    moneyChartMonth.mockResolvedValue(
      monthCharts({
        spent: amd('0'),
        spentIncome: rub('0'),
        slices: [],
        usual: null,
        comparedFrom: '2026-12',
        closed: [],
        firstMonth: null,
        deviations: [],
        pace: { days: [], usual: null },
      }),
    )
    const view = await render(SEPTEMBER)
    expect(view.text()).toContain(en.spending.charts.empty.title)
    expect(view.find('.ring').exists()).toBe(false)
  })

  it('a month before the first with data is a grey ring, not the offer to a newcomer (adversarial К)', async () => {
    moneyChartMonth.mockResolvedValue(
      monthCharts({
        month: '2026-05',
        spent: amd('0'),
        spentIncome: rub('0'),
        slices: [],
        usual: null,
        comparedFrom: '2026-09',
        closed: [],
        firstMonth: '2026-06',
        deviations: [],
      }),
    )
    const view = await render('/money/charts?month=2026-05')
    expect(view.text()).not.toContain(en.spending.charts.empty.title)
    expect(view.findAll('.ring .arc')).toHaveLength(1)
    expect(plain(view.text())).toContain('None is closed before May.')
  })

  it('with a usual and no dashed line says why, never that it comes (adversarial И)', async () => {
    moneyChartMonth.mockResolvedValue(
      monthCharts({ pace: { days: monthCharts().pace.days, usual: null } }),
    )
    const view = await render(SEPTEMBER)
    expect(view.text()).toContain(en.spending.charts.pace_uncounted)
    expect(view.text()).not.toContain('starts with')
  })

  it('a sector gone from a new answer of the same month is let go, not the whole ring dimmed (adversarial А)', async () => {
    moneyChartMonth.mockResolvedValue(monthCharts())
    const view = await render(SEPTEMBER)
    await view.find('.legend .row input').trigger('click')
    expect(view.findAll('.ring .arc.muted')).toHaveLength(6)
    // The same month again, the first category now in «Остальные».
    const [, ...others] = monthCharts().slices
    moneyChartMonth.mockResolvedValue(monthCharts({ slices: others }))
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(view.findAll('.ring .arc.muted')).toHaveLength(0)
    expect(view.find('.legend .row.chosen').exists()).toBe(false)
  })

  it('a new answer of the same month keeps the day chosen while the line reaches it (adversarial З)', async () => {
    moneyChartMonth.mockResolvedValue(monthCharts())
    const view = await render(SEPTEMBER)
    await view.find('.pace input[type="range"]').setValue('2')
    const longer = monthCharts().pace.days.slice(0, 29)
    moneyChartMonth.mockResolvedValue(
      monthCharts({ pace: { days: longer, usual: monthCharts().pace.usual } }),
    )
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(plain(view.find('.pace .reading').text())).toContain('By September 3')
  })

  it("the day of arrival is worked out for every answer, never kept from yesterday's (adversarial round 2, Н1, Н2)", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const october = (days: number) =>
        monthCharts({
          month: '2026-10',
          running: true,
          pace: {
            days: monthCharts()
              .pace.days.slice(0, days)
              .map((day) => ({ ...day, day: day.day.replace('2026-09', '2026-10') })),
            usual: null,
          },
        })
      // Yesterday's answer is on the phone; today's comes: the day is today, nobody chose the 11th.
      vi.setSystemTime(new Date('2026-10-11T09:00:00Z'))
      moneyChartMonth.mockResolvedValue(october(11))
      ;(await render('/money/charts')).unmount()
      vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))
      moneyChartMonth.mockResolvedValue(october(12))
      const view = await render('/money/charts')
      expect(plain(view.find('.pace .reading').text())).toContain('By October 12 · today')
      view.unmount()

      // September kept from when it ran, opened on the 1st of October: its last day, not the 1st.
      vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
      moneyChartMonth.mockResolvedValue(
        monthCharts({
          running: true,
          pace: { days: monthCharts().pace.days.slice(0, 29), usual: null },
        }),
      )
      ;(await render(SEPTEMBER)).unmount()
      vi.setSystemTime(new Date('2026-10-01T09:00:00Z'))
      moneyChartMonth.mockResolvedValue(monthCharts())
      const closed = await render(SEPTEMBER)
      expect(plain(closed.find('.pace .reading').text())).toContain('By September 30')
    } finally {
      vi.useRealTimers()
    }
  })

  it("whether the month runs is the phone's calendar's, in every word of the screen (review 3)", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // September kept on its 30th, while it ran; opened offline on the 1st of October.
      vi.setSystemTime(new Date('2026-09-30T09:00:00Z'))
      moneyChartMonth.mockResolvedValue(monthCharts({ running: true }))
      ;(await render(SEPTEMBER)).unmount()
      vi.setSystemTime(new Date('2026-10-01T09:00:00Z'))
      online(false)
      moneyChartMonth.mockRejectedValue(new TypeError('network'))
      const view = await render(SEPTEMBER)
      expect(view.find('.strip').exists()).toBe(true)
      expect(view.find('.center-label').text()).toBe('September')
      expect(view.text()).toContain('September against the average of June — August')
      expect(view.text()).not.toContain('so far')
      expect(plain(view.find('.pace .reading').text())).not.toContain('today')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a month still to come in the address is this month (adversarial В)', async () => {
    moneyChartMonth.mockReturnValue(new Promise(() => undefined))
    await render('/money/charts?month=2099-05')
    expect(moneyChartMonth).toHaveBeenCalledWith(localDay().slice(0, 7))
  })

  it('a month with nothing spent, after months that were, is a grey ring of nothing', async () => {
    moneyChartMonth.mockResolvedValue(
      monthCharts({ spent: amd('0'), spentIncome: rub('0'), slices: [] }),
    )
    const view = await render(SEPTEMBER)
    expect(plain(view.find('.center').text())).toContain('֏0')
    expect(view.findAll('.ring .arc')).toHaveLength(1)
    expect(view.find('fieldset.legend').exists()).toBe(false)
  })

  it('offline with the month kept shows it under a yellow strip, never red', async () => {
    moneyChartMonth.mockResolvedValueOnce(monthCharts())
    ;(await render(SEPTEMBER)).unmount()
    online(false)
    moneyChartMonth.mockRejectedValue(new TypeError('network'))
    const view = await render(SEPTEMBER)
    expect(view.find('.strip').text()).toContain('No connection. Charts as of')
    expect(plain(view.text())).toContain('֏274,523')
    expect(view.find('.state.bad').exists()).toBe(false)
  })
})
