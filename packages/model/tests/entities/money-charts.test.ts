import { describe, expect, it } from 'vitest'
import {
  CHART_LEVEL,
  chartMonths,
  DONUT_SECTORS,
  donutSlices,
  exchangeLosses,
  moneyCharts,
  rateLine,
  weekEnds,
} from '#model/entities/money-charts'
import type { ExchangeLossInput } from '#model/entities/money-charts'
import type { MoneyMonth } from '#model/entities/money-month'
import { money } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const amd = (major: number): Money => money(BigInt(major) * 100n, 'AMD')
const rub = (major: number): Money => money(BigInt(major) * 100n, 'RUB')

interface MonthOf {
  spent?: number
  spentIncome?: number | null
  income?: number
  byCategory?: Record<string, number>
  days?: number
  uncounted?: Money[]
  uncountedIn?: string[]
  incomeUncounted?: Money[]
}

/** A month as `moneyMonth` would have counted it: drams spent, roubles come in. */
function month(name: string, of: MonthOf = {}): MoneyMonth {
  const spent = of.spent ?? 0
  const days = of.days ?? (spent > 0 ? 1 : 0)
  return {
    month: name,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: amd(spent),
    uncounted: of.uncounted ?? [],
    uncountedIn: of.uncountedIn ?? [],
    foreign: [],
    spentIncome: of.spentIncome === null ? null : rub(of.spentIncome ?? Math.round(spent / 4)),
    income: rub(of.income ?? 0),
    incomeUncounted: of.incomeUncounted ?? [],
    incomeCount: 0,
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    rate: null,
    rateKind: 'frozen',
    byCategory: Object.entries(of.byCategory ?? {}).map(([categoryId, amount]) => ({
      categoryId,
      amount: amd(amount),
    })),
    days: Array.from({ length: days }, (_, index) => ({
      day: `${name}-${String(index + 1).padStart(2, '0')}`,
      total: amd(0),
      estimated: false,
      entries: [],
    })),
  }
}

describe('chartMonths', () => {
  it('ends with the current month and crosses a year', () => {
    expect(chartMonths('2026-03', 6)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ])
    expect(chartMonths('2026-09', 12)).toHaveLength(12)
    expect(chartMonths('2026-09', 1)).toEqual(['2026-09'])
  })
})

/** The categories of a month as `moneyMonth` orders them, largest first, in drams. */
function categories(...amounts: number[]): { categoryId: string; amount: Money }[] {
  return amounts.map((amount, index) => ({
    categoryId: `c${String(index + 1)}`,
    amount: amd(amount),
  }))
}

describe('donutSlices', () => {
  it('draws nothing for a month with nothing in a category', () => {
    expect(donutSlices([])).toEqual([])
  })

  it('gives one category the whole ring', () => {
    expect(donutSlices(categories(5_000))).toEqual([
      { categoryId: 'c1', amount: amd(5_000), count: 1, level: CHART_LEVEL },
    ])
  })

  it('names all seven: an «Остальные» of one would hide a name for nothing', () => {
    const slices = donutSlices(categories(70, 60, 50, 40, 30, 20, 10))
    expect(slices).toHaveLength(DONUT_SECTORS + 1)
    expect(slices.every((slice) => slice.categoryId !== null && slice.count === 1)).toBe(true)
  })

  it('puts everything past six into «Остальные», last, with how many it holds', () => {
    const slices = donutSlices(categories(80, 70, 60, 50, 40, 30, 20, 10))
    expect(slices.map((slice) => slice.categoryId)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      null,
    ])
    expect(slices.at(-1)).toMatchObject({ amount: amd(30), count: 2 })
  })

  it('keeps the sum of the month and closes the ring exactly (handoff MOL-157 figures)', () => {
    const month = categories(68_076, 60_318, 51_294, 43_728, 20_390, 17_917, 6_500, 3_600, 2_700)
    const slices = donutSlices(month)
    expect(slices.reduce((sum, slice) => sum + slice.amount.minor, 0n)).toBe(amd(274_523).minor)
    expect(slices.reduce((sum, slice) => sum + slice.level, 0)).toBe(CHART_LEVEL)
    expect(slices.at(-1)).toMatchObject({ categoryId: null, amount: amd(12_800), count: 3 })
    expect(slices[0]?.level).toBe(248)
  })

  it('shares the rounding out by the largest remainder, the earlier first on a tie', () => {
    expect(donutSlices(categories(1, 1, 1)).map((slice) => slice.level)).toEqual([334, 333, 333])
    expect(donutSlices(categories(2, 1)).map((slice) => slice.level)).toEqual([667, 333])
  })

  it('leaves a sector a level of nothing rather than none, when it is a crumb of the month', () => {
    const slices = donutSlices(categories(1_000_000, 1))
    expect(slices.map((slice) => slice.level)).toEqual([CHART_LEVEL, 0])
    expect(slices).toHaveLength(2)
  })
})

describe('moneyCharts', () => {
  it('lays the months out with the figures of «Деньги», heights of the tallest', () => {
    const charts = moneyCharts(
      [
        month('2026-07', { spent: 200_000, income: 100_000 }),
        month('2026-08', { spent: 400_000, income: 120_000, spentIncome: 90_000 }),
        month('2026-09', { spent: 100_000, income: 0, spentIncome: 25_000 }),
      ],
      month('2026-06', { spent: 250_000 }),
    )
    expect(charts.months.map((one) => one.spentLevel)).toEqual([500, CHART_LEVEL, 250])
    // «Пришло и ушло» shares one scale: the tallest of both is 120 000 ₽.
    expect(charts.months.map((one) => one.incomeLevel)).toEqual([833, CHART_LEVEL, 0])
    expect(charts.months.map((one) => one.spentIncomeLevel)).toEqual([417, 750, 208])
    expect(charts.months[1]?.difference).toEqual(rub(30_000))
    expect(charts.months[2]?.difference).toEqual(rub(-25_000))
    // The first bar compares with the month before the period.
    expect(charts.months.map((one) => one.change)).toEqual([-20, 100, -75])
  })

  it('has no difference and no height where the month has no rate', () => {
    const charts = moneyCharts(
      [month('2026-08', { spent: 1000, spentIncome: null, income: 500 })],
      month('2026-07'),
    )
    expect(charts.months[0]?.difference).toBeNull()
    expect(charts.months[0]?.spentIncomeLevel).toBeNull()
    expect(charts.months[0]?.change).toBeNull()
  })

  it('averages the closed months from the first with anything in it (Р-5, Р-15)', () => {
    const charts = moneyCharts(
      [
        month('2026-05'),
        month('2026-06'),
        month('2026-07', { spent: 100_000, income: 50_000, spentIncome: 20_000 }),
        month('2026-08', { spent: 200_000, income: 50_000, spentIncome: 40_000 }),
        // The running month, half spent, is not averaged.
        month('2026-09', { spent: 900_000, income: 50_000, spentIncome: 200_000 }),
      ],
      month('2026-04'),
    )
    expect(charts.since).toBe('2026-07')
    expect(charts.spentAverage).toEqual(amd(150_000))
    expect(charts.differenceAverage).toEqual(rub(20_000))
  })

  it('counts an empty closed month after the first as a month of nothing', () => {
    const charts = moneyCharts(
      [
        month('2026-06', { spent: 300_000 }),
        month('2026-07'),
        month('2026-08', { spent: 0, income: 10 }),
        month('2026-09', { spent: 5 }),
      ],
      month('2026-05'),
    )
    expect(charts.spentAverage).toEqual(amd(100_000))
  })

  it('starts from a month that only earned, or only spent what nothing converts', () => {
    expect(
      moneyCharts([month('2026-08', { income: 1 }), month('2026-09')], month('2026-07')).since,
    ).toBe('2026-08')
    expect(
      moneyCharts(
        [month('2026-08', { incomeUncounted: [money(100n, 'USD')] }), month('2026-09')],
        month('2026-07'),
      ).since,
    ).toBe('2026-08')
    expect(
      moneyCharts(
        [month('2026-08', { days: 1, uncounted: [money(100n, 'EUR')] }), month('2026-09')],
        month('2026-07'),
      ).since,
    ).toBe('2026-08')
  })

  it('has no average with no closed month of data, and nothing at all for a newcomer', () => {
    const one = moneyCharts([month('2026-08'), month('2026-09', { spent: 10 })], month('2026-07'))
    expect(one.since).toBe('2026-09')
    expect(one.spentAverage).toBeNull()
    expect(one.differenceAverage).toBeNull()

    const none = moneyCharts([month('2026-08'), month('2026-09')], month('2026-07'))
    expect(none.since).toBeNull()
    expect(none.months.every((one) => one.spentLevel === 0)).toBe(true)
    expect(none.categories).toEqual([])
  })

  it('leaves a month nothing converts out of the average difference', () => {
    const charts = moneyCharts(
      [
        month('2026-07', { spent: 100, income: 300, spentIncome: 100 }),
        month('2026-08', { spent: 100, income: 300, spentIncome: null }),
        month('2026-09'),
      ],
      month('2026-06'),
    )
    expect(charts.differenceAverage).toEqual(rub(200))
  })

  it('has no «Разница» for a month with anything not counted, and leaves it out of every average (adversarial d9 В)', () => {
    const charts = moneyCharts(
      [
        month('2026-07', { spent: 100_000, income: 30_000, spentIncome: 25_000 }),
        // The salary came in dollars on a day with no dollar: «Пришло» 0 is not the month.
        month('2026-08', {
          spent: 200_000,
          income: 0,
          spentIncome: 25_000,
          incomeUncounted: [money(30_000n, 'USD')],
        }),
        // Something spent in euros had no rate: «Ушло» is short.
        month('2026-09', { spent: 50_000, uncounted: [money(1_000n, 'EUR')] }),
        month('2026-10'),
      ],
      month('2026-06'),
    )
    expect(charts.months.map((one) => one.difference)).toEqual([rub(5_000), null, null, rub(0)])
    expect(charts.differenceAverage).toEqual(rub(5_000))
    // The income did not change what was spent: August is in the average of spending (review С-8).
    expect(charts.spentAverage).toEqual(amd(150_000))
  })

  it('leaves a month out of the average of only the category short in it (adversarial d9 round 3, В3)', () => {
    const charts = moneyCharts(
      [
        month('2026-07', { spent: 100_000, byCategory: { groceries: 100_000 } }),
        // A coffee in dollars with no rate: «Кафе» of August is short, «Продукты» are whole.
        month('2026-08', {
          spent: 300_000,
          byCategory: { groceries: 300_000 },
          uncounted: [money(500n, 'USD')],
          uncountedIn: ['cafe'],
        }),
        month('2026-09'),
      ],
      month('2026-06'),
      ['groceries', 'cafe'],
    )
    const averageOf = (id: string) =>
      charts.categories.find((one) => one.categoryId === id)?.average
    expect(averageOf('groceries')).toEqual(amd(200_000))
    // «Кафе» spent nothing counted in the period: no average, not «0 ֏».
    expect(averageOf('cafe')).toBeNull()
    // The month's spending is short, so it leaves the average of spending.
    expect(charts.spentAverage).toEqual(amd(100_000))
  })

  it('leaves the short month out of that category’s average', () => {
    const charts = moneyCharts(
      [
        month('2026-07', { spent: 100_000, byCategory: { cafe: 100_000 } }),
        month('2026-08', {
          spent: 20_000,
          byCategory: { cafe: 20_000 },
          uncounted: [money(500n, 'USD')],
          uncountedIn: ['cafe'],
        }),
        month('2026-09'),
      ],
      month('2026-06'),
    )
    expect(charts.categories[0]?.average).toEqual(amd(100_000))
  })

  it('must not fire: a change past what a number holds is left unsaid, not a failed answer (adversarial d9 А)', () => {
    // 0,01 ֏ in August and 10¹⁴ ֏ in September: ten thousand billion per cent, past 2⁵³.
    const august = {
      ...month('2026-08'),
      spent: money(1n, 'AMD'),
      byCategory: [{ categoryId: 'cafe', amount: money(1n, 'AMD') }],
    }
    const september = month('2026-09', {
      spent: 100_000_000_000_000,
      byCategory: { cafe: 100_000_000_000_000 },
    })
    const huge = moneyCharts([august, september], month('2026-07'))
    expect(huge.months[1]?.change).toBeNull()
    expect(huge.categories[0]?.points[1]?.change).toBeNull()

    // A large change a number still holds is said.
    const big = moneyCharts(
      [
        { ...month('2026-08'), spent: money(100n, 'AMD') },
        month('2026-09', { spent: 100_000_000 }),
      ],
      month('2026-07'),
    )
    expect(big.months[1]?.change).toBe(9_999_999_900)
  })

  it('offers the owner’s categories spent nowhere in the period as months of nothing, after the spent ones (adversarial А)', () => {
    const charts = moneyCharts(
      [month('2026-08', { spent: 1, byCategory: { cafe: 500 } }), month('2026-09')],
      month('2026-07'),
      ['groceries', 'cafe', 'clothes'],
    )
    expect(charts.categories.map((series) => series.categoryId)).toEqual([
      'cafe',
      'groceries',
      'clothes',
    ])
    const clothes = charts.categories[2]
    expect(clothes?.points.map((point) => point.amount)).toEqual([amd(0), amd(0)])
    expect(clothes?.points.map((point) => point.level)).toEqual([0, 0])
    // Nothing spent in the period has no average, not «в среднем 0 ֏».
    expect(clothes?.average).toBeNull()
    expect(clothes?.averageLevel).toBeNull()
  })

  it('draws each category over the period, largest first, with its own scale', () => {
    const charts = moneyCharts(
      [
        month('2026-07', { spent: 1, byCategory: { cafe: 30_000 } }),
        month('2026-08', { spent: 1, byCategory: { cafe: 10_000, groceries: 70_000 } }),
        month('2026-09', { spent: 1, byCategory: { groceries: 71_200 } }),
      ],
      month('2026-06', { spent: 1, byCategory: { groceries: 35_600 } }),
    )
    expect(charts.categories.map((series) => series.categoryId)).toEqual(['groceries', 'cafe'])
    const [groceries, cafe] = charts.categories
    expect(groceries?.points.map((point) => point.amount)).toEqual([
      amd(0),
      amd(70_000),
      amd(71_200),
    ])
    expect(groceries?.points.map((point) => point.change)).toEqual([-100, null, 2])
    expect(groceries?.average).toEqual(amd(35_000))
    expect(groceries?.averageLevel).toBe(492)
    expect(groceries?.points.map((point) => point.level)).toEqual([0, 983, CHART_LEVEL])
    // A month with nothing of the category before it says «нет трат месяцем раньше»: null.
    expect(cafe?.points.map((point) => point.change)).toEqual([null, -67, -100])
  })
})

function loss(
  note: string | null,
  difference: number | null,
  expected: number | null,
  exchangedOn = '2026-09-10',
): ExchangeLossInput {
  return {
    note,
    exchangedOn,
    difference: difference === null ? null : amd(difference),
    expected: expected === null ? null : amd(expected),
  }
}

describe('exchangeLosses', () => {
  it('groups by the place as a name is read, and names it as the newest wrote it', () => {
    const losses = exchangeLosses(
      [
        loss('аэропорт', -1000, 100_000, '2026-08-01'),
        loss(' Аэропорт ', -1000, 100_000, '2026-09-01'),
        loss('аэро⁠порт', -1000, 100_000, '2026-07-01'),
        loss(null, 500, 50_000),
      ],
      'AMD',
    )
    expect(losses?.groups.map((group) => [group.place, group.count])).toEqual([
      ['Аэропорт', 3],
      [null, 1],
    ])
    expect(losses?.total).toEqual(amd(-2500))
  })

  it('weighs the percent by the money, not by the exchange (Р-7)', () => {
    const losses = exchangeLosses([loss('банк', -100, 10_000), loss('банк', -10, 100)], 'AMD')
    // −110 of 10 100: −1,09 %, where the mean of −1 % and −10 % would say −5,5 %.
    expect(losses?.groups[0]?.percent).toBe(-109)
  })

  it('puts the worst first and measures every bar against the widest, with its sign', () => {
    const losses = exchangeLosses(
      [loss('fast bank', 27, 10_000), loss('аэропорт', -721, 10_000), loss('втб', -149, 10_000)],
      'AMD',
    )
    expect(losses?.groups.map((group) => [group.place, group.percent, group.level])).toEqual([
      ['аэропорт', -721, -CHART_LEVEL],
      ['втб', -149, -207],
      ['fast bank', 27, 37],
    ])
  })

  it('names what could not be measured or converted and sums none of it', () => {
    const losses = exchangeLosses(
      [loss('банк', -100, 10_000), loss('банк', null, null), loss('касса', -5, null)],
      'AMD',
    )
    expect(losses?.uncounted).toBe(2)
    expect(losses?.total).toEqual(amd(-100))
    expect(losses?.groups).toHaveLength(1)
  })

  it('is no card when nothing is measured', () => {
    expect(exchangeLosses([], 'AMD')).toBeNull()
    expect(exchangeLosses([loss('банк', null, null)], 'AMD')).toBeNull()
  })

  it('reads a zero difference as zero percent, and the only group as the widest', () => {
    const losses = exchangeLosses([loss('банк', 0, 10_000)], 'AMD')
    expect(losses?.groups[0]).toMatchObject({ percent: 0, level: 0 })
  })
})

function rate(base: Currency, quote: Currency, value: string, day: string): ExchangeRate {
  return { base, quote, scaled: parseRate(value), source: 'official', asOf: yerevanMidnight(day) }
}

describe('weekEnds', () => {
  it('reads every Sunday of the period, and today when it is not one', () => {
    // 1 September 2026 is a Tuesday, the 29th too.
    expect(weekEnds('2026-09-01', '2026-09-29')).toEqual([
      '2026-09-06',
      '2026-09-13',
      '2026-09-20',
      '2026-09-27',
      '2026-09-29',
    ])
  })

  it('takes a Sunday it starts or ends on once', () => {
    expect(weekEnds('2026-09-06', '2026-09-13')).toEqual(['2026-09-06', '2026-09-13'])
    expect(weekEnds('2026-09-07', '2026-09-07')).toEqual(['2026-09-07'])
  })
})

describe('rateLine', () => {
  it('keeps one side for the whole line — the one the newest rate reads at least one on', () => {
    const line = rateLine(
      [
        { day: '2026-09-06', rate: rate('AMD', 'RUB', '0.25', '2026-09-06') },
        { day: '2026-09-13', rate: rate('RUB', 'AMD', '4', '2026-09-13') },
        { day: '2026-09-20', rate: null },
        { day: '2026-09-27', rate: rate('RUB', 'AMD', '5', '2026-09-27') },
      ],
      [],
    )
    expect(line?.points.map((point) => point.rate && [point.rate.base, point.rate.quote])).toEqual([
      ['RUB', 'AMD'],
      ['RUB', 'AMD'],
      null,
      ['RUB', 'AMD'],
    ])
    expect(line?.points.map((point) => point.level)).toEqual([0, 0, null, CHART_LEVEL])
  })

  it('puts an exchange either way on its week and within the card', () => {
    const line = rateLine(
      [
        { day: '2026-09-06', rate: rate('RUB', 'AMD', '4', '2026-09-06') },
        { day: '2026-09-13', rate: rate('RUB', 'AMD', '4.5', '2026-09-13') },
      ],
      [
        // Between the start of the period and its first Sunday: the first week's.
        { day: '2026-09-02', rate: rate('RUB', 'AMD', '4.2', '2026-09-02') },
        { day: '2026-09-08', rate: rate('RUB', 'AMD', '3.5', '2026-09-08') },
        // Drams back into roubles: the same pair, turned to the line's side.
        { day: '2026-09-13', rate: rate('AMD', 'RUB', '0.2', '2026-09-13') },
      ],
    )
    expect(line?.exchanges.map((exchange) => [exchange.week, exchange.level])).toEqual([
      [0, 467],
      [1, 0],
      [1, CHART_LEVEL],
    ])
    expect(line?.exchanges[2]?.rate.base).toBe('RUB')
    expect(line?.points.map((point) => point.level)).toEqual([333, 667])
  })

  it('draws a flat line in the middle, and nothing with nothing known', () => {
    const flat = rateLine(
      [
        { day: '2026-09-06', rate: rate('RUB', 'AMD', '4', '2026-09-06') },
        { day: '2026-09-13', rate: rate('RUB', 'AMD', '4', '2026-09-13') },
      ],
      [],
    )
    expect(flat?.points.map((point) => point.level)).toEqual([500, 500])
    expect(rateLine([{ day: '2026-09-06', rate: null }], [])).toBeNull()
  })

  it('draws the exchanges alone when the bank said nothing in the period', () => {
    const line = rateLine(
      [
        { day: '2026-09-06', rate: null },
        { day: '2026-09-13', rate: null },
      ],
      [{ day: '2026-09-10', rate: rate('RUB', 'AMD', '4', '2026-09-10') }],
    )
    expect(line?.points.every((point) => point.rate === null)).toBe(true)
    expect(line?.exchanges).toMatchObject([{ week: 1, level: 500 }])
  })
})
