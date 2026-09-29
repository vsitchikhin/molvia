import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney, parseRate, yerevanMidnight } from '@molvia/model'
import type { MoneyChartsView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import MoneyChartsViewScreen from './MoneyChartsView.vue'

const moneyCharts = vi.fn<(period: 6 | 12) => Promise<MoneyChartsView>>()
vi.mock('@/api', () => ({
  api: { moneyCharts: (period: 6 | 12) => moneyCharts(period) },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const GROCERIES = 'ffffffff-0000-4000-8000-000000000001'
const CAFE = 'ffffffff-0000-4000-8000-000000000002'
const amd = (text: string) => parseMoney(text, 'AMD')
const rub = (text: string) => parseMoney(text, 'RUB')
const plain = (text: string) => text.replace(/\s/g, ' ')
/** A sum below zero, which `parseMoney` — made for what is typed — refuses. */
const minus = (money: ReturnType<typeof amd>) => ({ ...money, minor: -money.minor })

const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

function charts(patch: Partial<MoneyChartsView> = {}): MoneyChartsView {
  return {
    period: 6,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    since: '2026-04',
    months: MONTHS.map((month, index) => ({
      month,
      spent: amd(String(300_000 + index * 10_000)),
      uncounted: [],
      spentIncome: rub(String(70_000 + index * 1000)),
      income: rub('120000'),
      incomeUncounted: [],
      difference: rub(String(50_000 - index * 1000)),
      change: index === 5 ? -8 : null,
      spentLevel: 800 + index * 40,
      incomeLevel: 1000,
      spentIncomeLevel: 600,
    })),
    spentAverage: amd('320000'),
    differenceAverage: rub('53300'),
    categories: [
      {
        category: { id: GROCERIES, preset: 'groceries', name: null, colour: null, archived: false },
        average: amd('65600'),
        averageLevel: 900,
        points: MONTHS.map((month) => ({ month, amount: amd('71200'), change: 3, level: 1000 })),
      },
      {
        category: { id: CAFE, preset: 'cafe', name: null, colour: null, archived: false },
        average: amd('34500'),
        averageLevel: 800,
        points: MONTHS.map((month) => ({ month, amount: amd('38420'), change: -9, level: 900 })),
      },
    ],
    exchanges: {
      total: minus(amd('13381')),
      uncounted: 1,
      groups: [
        {
          place: 'Airport',
          count: 1,
          difference: minus(amd('14604')),
          percent: -721,
          level: -1000,
        },
        { place: null, count: 2, difference: amd('1223'), percent: 27, level: 37 },
      ],
    },
    rate: {
      points: [
        {
          day: '2026-09-20',
          rate: {
            base: 'RUB',
            quote: 'AMD',
            scaled: parseRate('4.05'),
            source: 'official',
            asOf: yerevanMidnight('2026-09-19'),
          },
          level: 0,
        },
        { day: '2026-09-27', rate: null, level: null },
        {
          day: '2026-09-29',
          rate: {
            base: 'RUB',
            quote: 'AMD',
            scaled: parseRate('4.06'),
            source: 'official',
            asOf: yerevanMidnight('2026-09-29'),
          },
          level: 1000,
        },
      ],
      exchanges: [
        {
          day: '2026-09-28',
          week: 2,
          rate: {
            base: 'RUB',
            quote: 'AMD',
            scaled: parseRate('4.02'),
            source: 'personal',
            asOf: yerevanMidnight('2026-09-28'),
          },
          level: 0,
        },
      ],
    },
    ...patch,
  }
}

const views: VueWrapper[] = []
let router: Router

async function render(path = '/money/charts'): Promise<VueWrapper> {
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
  moneyCharts.mockReset()
  online(true)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  document.body.innerHTML = ''
})

describe('MoneyChartsView (MOL-74): the four states', () => {
  it('loads with a skeleton, the period already there, and asks for six months', async () => {
    moneyCharts.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(view.text()).toContain(en.spending.charts.period_12)
    expect(moneyCharts).toHaveBeenCalledWith(6)
  })

  it('a failed read is red with «Try again», and trying again reads again', async () => {
    moneyCharts.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(charts())
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
    moneyCharts.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.spending.charts.offline.body)
    expect(view.text()).not.toContain(en.state.retry)
    expect(view.find('.state.bad').exists()).toBe(false)
  })

  it('offline with the period kept shows it under a yellow strip that says when', async () => {
    moneyCharts.mockResolvedValueOnce(charts())
    ;(await render()).unmount()
    online(false)
    moneyCharts.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.find('.strip').text()).toContain('No connection. Charts as of')
    expect(plain(view.text())).toContain('350,000')
    expect(view.find('.state.bad').exists()).toBe(false)
  })

  it('a newcomer sees an offer, not bars of nothing', async () => {
    moneyCharts.mockResolvedValue(
      charts({ since: null, categories: [], exchanges: null, rate: null }),
    )
    const view = await render()
    expect(view.text()).toContain(en.spending.charts.empty.title)
    expect(view.text()).not.toContain(en.spending.charts.spent_title)
  })
})

describe('MoneyChartsView: the charts', () => {
  it('reads the last month of the period by default, with the rate and the month before', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render()
    const text = plain(view.text())
    expect(text).toContain('April — September 2026')
    expect(text).toContain('֏350,000')
    expect(text).toContain('≈ ₽75,000')
    expect(text).toContain('−8% vs August')
    // «Разница» — not «Остаток», which is the money on the accounts (В-2).
    expect(text).toContain('Difference · Sep')
    expect(text).toContain('≈ +₽45,000')
    expect(text).toContain('≈ +₽53,300 a month on average')
  })

  it('a bar chosen moves only its own chart', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render()
    const [spent] = view.findAll('fieldset.chart')
    await spent?.findAll('input[type="radio"]')[1]?.setValue(true)
    expect(plain(spent?.text() ?? '')).toContain('May 2026')
    expect(plain(view.text())).toContain('Difference · Sep')
  })

  it('the period moves by replace and asks again', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render()
    const replace = vi.spyOn(router, 'replace')
    moneyCharts.mockResolvedValue(charts({ period: 12 }))
    await view.find('input[value="12"]').setValue(true)
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query.period).toBe('12')
    expect(moneyCharts).toHaveBeenLastCalledWith(12)
  })

  it('opens on the largest category, or on the one it was sent for', async () => {
    moneyCharts.mockResolvedValue(charts())
    const first = await render()
    expect((first.find('select').element as HTMLSelectElement).value).toBe(GROCERIES)
    first.unmount()

    const view = await render(`/money/charts?category=${CAFE}`)
    expect((view.find('select').element as HTMLSelectElement).value).toBe(CAFE)
    expect(plain(view.text())).toContain('−9% vs August · ֏34,500 on average')
  })

  it('says so when the address names a category the charts do not have, rather than swap in silence (adversarial А)', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render('/money/charts?category=ffffffff-0000-4000-8000-000000000099')
    expect((view.find('select').element as HTMLSelectElement).value).toBe(GROCERIES)
    expect(plain(view.text())).toContain('That category is not on the charts — showing «Groceries»')

    const own = await render(`/money/charts?category=${CAFE}`)
    expect(own.find('.missing').exists()).toBe(false)
  })

  it('a category chosen goes into the address', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render()
    await view.find('select').setValue(CAFE)
    await flushPromises()
    expect(router.currentRoute.value.query.category).toBe(CAFE)
  })

  it('draws the exchanges by exchanger, worst first, and leads to «Обмен денег»', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render()
    const card = plain(view.find('.losses').text())
    expect(card).toContain('−֏13,381')
    expect(card).toContain('Airport')
    expect(card).toContain('−7.21%')
    expect(card).toContain(en.spending.charts.fx_no_place)
    expect(card).toContain('+0.27%')
    expect(card).toContain('Not compared with the CBA: 1 exchange')
    expect(view.find('.losses a').attributes('href')).toBe('/money/exchange')
  })

  it('keeps the bar a person chose when a new answer of the same period comes (review)', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render()
    const [spent] = view.findAll('fieldset.chart')
    await spent?.findAll('input[type="radio"]')[1]?.setValue(true)
    expect(plain(spent?.text() ?? '')).toContain('May 2026')
    // A write landed, the connection came back: the same period answered again.
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(moneyCharts).toHaveBeenCalledTimes(2)
    expect(plain(view.findAll('fieldset.chart')[0]?.text() ?? '')).toContain('May 2026')
  })

  it('says what did not convert under «Пришло и ушло», and has no «Разница» for it (adversarial d9 В)', async () => {
    const base = charts()
    const months = base.months.map((month, index) =>
      index === 5
        ? {
            ...month,
            income: rub('0'),
            incomeUncounted: [parseMoney('300', 'USD')],
            difference: null,
          }
        : month,
    )
    moneyCharts.mockResolvedValue({ ...base, months })
    const view = await render()
    const flow = plain(view.findAll('fieldset.chart')[1]?.text() ?? '')
    expect(flow).toContain('In, not counted: $300')
    expect(flow).toContain(en.spending.charts.difference_uncounted)
  })

  it('draws «Ушло» of a month with no rate as not known, never as nothing spent (review)', async () => {
    const base = charts()
    const months = base.months.map((month, index) =>
      index === 0
        ? { ...month, spentIncome: null, spentIncomeLevel: null, difference: null }
        : month,
    )
    moneyCharts.mockResolvedValue({ ...base, months })
    const view = await render()
    const flow = view.findAll('fieldset.chart')[1]
    expect(flow?.findAll('.bar')[0]?.find('.fill.unknown').exists()).toBe(true)
    expect(flow?.findAll('.bar')[1]?.find('.fill.unknown').exists()).toBe(false)
    expect(flow?.findAll('input')[0]?.attributes('aria-label')).toContain(
      en.spending.charts.no_rate,
    )
  })

  it('shows the rate and the exchanges before the first spending (adversarial В)', async () => {
    moneyCharts.mockResolvedValue(charts({ since: null, categories: [] }))
    const view = await render()
    expect(view.text()).toContain(en.spending.charts.empty.title)
    expect(view.find('.rate-line').exists()).toBe(true)
    expect(view.find('.losses').exists()).toBe(true)
  })

  it('must not fire: an answer that lost the race is not what the phone keeps (adversarial Б, d9 Д)', async () => {
    let first: (value: MoneyChartsView) => void = () => undefined
    moneyCharts
      .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce(charts({ spentAverage: amd('999999') }))
    const view = await render()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    first(charts())
    await flushPromises()
    view.unmount()
    online(false)
    moneyCharts.mockRejectedValue(new TypeError('network'))
    const again = await render()
    expect(again.find('.strip').exists()).toBe(true)
    const kept = JSON.parse(localStorage.getItem(`molvia.charts.${ACTOR}`) ?? '{}') as Record<
      string,
      { answer: { spentAverage: { amount: string } | null } }
    >
    expect(kept['6']?.answer.spentAverage?.amount).toBe('999999.00')
  })

  it('an answer whose later read failed is still shown and kept, under the strip (d9 round 2 Е2, review С-10)', async () => {
    let first: (value: MoneyChartsView) => void = () => undefined
    moneyCharts
      .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
      .mockRejectedValueOnce(new TypeError('network'))
    online(false)
    const view = await render()
    // A write landed: the second read fails with no connection before the first answers.
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    first(charts())
    await flushPromises()
    expect(plain(view.text())).toContain('֏350,000')
    expect(localStorage.getItem(`molvia.charts.${ACTOR}`)).not.toBeNull()
    // Asked before the write landed, it is not the charts with it: still «Нет связи. Графики на …».
    expect(view.find('.strip').text()).toContain('No connection. Charts as of')
  })

  it('must not fire: a later read that answers takes the strip away', async () => {
    moneyCharts.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(charts())
    online(false)
    const view = await render()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(plain(view.text())).toContain('֏350,000')
    expect(view.find('.strip').exists()).toBe(false)
  })

  it('has no card of exchanges and none of the rate where there is nothing for them', async () => {
    moneyCharts.mockResolvedValue(charts({ exchanges: null, rate: null }))
    const view = await render()
    expect(view.find('.losses').exists()).toBe(false)
    expect(view.find('.rate-line').exists()).toBe(false)
  })

  it('reads the week of the rate, a gap as a gap, and one’s own exchange of the week', async () => {
    moneyCharts.mockResolvedValue(charts())
    const view = await render()
    const card = () => plain(view.find('.rate-line').text())
    expect(card()).toContain('4.06 ֏ per 1 ₽')
    expect(card()).toContain('My exchange September 28: 4.02 ֏ per 1 ₽')
    await view.find('.rate-line input[type="range"]').setValue('1')
    expect(card()).toContain(en.spending.charts.rate_none)
  })
})
