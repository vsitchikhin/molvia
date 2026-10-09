import { describe, expect, it } from 'vitest'
import { yearCharts } from '#model/entities/money-chart-year'
import type { YearChartsInput } from '#model/entities/money-chart-year'
import { CHART_LEVEL, chartMonths } from '#model/entities/money-charts'
import { moneyMonth, previousMonth } from '#model/entities/money-month'
import type { ConvertOn, MoneyMonth } from '#model/entities/money-month'
import type { Income } from '#model/entities/income'
import type { Spending } from '#model/entities/spending'
import { SPENDING_PRESETS } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { INT8_MAX } from '#model/support/decimal'
import { money } from '#model/values/money'
import type { Currency } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
let sequence = 0
const nextId = () => {
  sequence += 1
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

const presets: SpendingCategory[] = SPENDING_PRESETS.map((preset, index) => ({
  id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  actorId: OWNER,
  preset,
  name: null,
  colour: null,
  archivedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}))
const id = (preset: string) => presets.find((category) => category.preset === preset)?.id ?? ''

/** Major units of `currency`, drams unless named. */
function spending(
  major: number | bigint,
  on: string,
  preset = 'other',
  currency: Currency = 'AMD',
): Spending {
  return {
    id: nextId(),
    actorId: OWNER,
    spentOn: on,
    amount: money(BigInt(major) * 100n, currency),
    categoryId: id(preset),
    note: null,
    place: null,
    rate: null,
    accountId: null,
    debited: null,
    transferId: null,
    revision: 1,
    createdAt: new Date(`${on}T10:00:00Z`),
    amendedAt: null,
  }
}

const never: ConvertOn = () => null

/** A month counted as «Деньги» count it: drams spent, roubles come in, `drams` ֏ for a rouble. */
function counted(
  month: string,
  spendings: Spending[] = [],
  drams: string | null = '5',
): MoneyMonth {
  return moneyMonth({
    month,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spendings,
    trips: [],
    incomes: [],
    salaryShiftDay: null,
    categories: presets,
    rate:
      drams === null
        ? null
        : {
            base: 'RUB',
            quote: 'AMD',
            scaled: parseRate(drams),
            source: 'official',
            asOf: yerevanMidnight(`${month}-01`),
          },
    rateKind: 'frozen',
    inSpend: never,
    incomeInIncome: never,
  })
}

/** Every month from `from` to `to`, each with what `spent` gives it. */
function run(from: string, to: string, spent: (month: string) => Spending[]): MoneyMonth[] {
  const months: MoneyMonth[] = []
  for (let month = from; month <= to;) {
    months.push(counted(month, spent(month)))
    const [year = 0, number = 1] = month.split('-').map(Number)
    month =
      number === 12
        ? `${String(year + 1)}-01`
        : `${String(year)}-${String(number + 1).padStart(2, '0')}`
  }
  return months
}

/** The input as the use case lays it: the year's months to today, the usual's months before them. */
function year(
  value: string,
  all: MoneyMonth[],
  today: string,
  firstMonth: string | null,
  archived: string[] = [],
): ReturnType<typeof yearCharts> {
  const current = today.slice(0, 7)
  const lastClosed = `${value}-12` < current ? `${value}-12` : previousMonth(current)
  const window = new Set(chartMonths(lastClosed, 12))
  const input: YearChartsInput = {
    year: value,
    months: all.filter((one) => one.month.startsWith(value) && one.month <= current),
    before: all.filter((one) => one.month < `${value}-01` && window.has(one.month)),
    today,
    groceries: id('groceries'),
    categories: presets.map((category) => ({
      id: category.id,
      archived: archived.includes(category.id),
    })),
    firstMonth,
  }
  return yearCharts(input)
}

/** A spending of `major` ֏ on the 10th of each month. */
const monthly =
  (major: number, preset = 'other') =>
  (month: string) => [spending(major, `${month}-10`, preset)]

describe('yearCharts — «Графики → Год» (MOL-160)', () => {
  it('has twelve months: quiet before the first data, nothing still to come (Р-4)', () => {
    const charts = year('2026', run('2026-08', '2026-09', monthly(1000)), '2026-09-30', '2026-08')
    expect(charts.months.map((month) => month.kind)).toEqual([
      ...Array<string>(7).fill('before'),
      'data',
      'data',
      'future',
      'future',
      'future',
    ])
    expect(charts.monthsShown).toBe(2)
    expect(charts.running).toBe(true)
    expect(charts.months[0]).toMatchObject({ spentLevel: 0, change: null, spentIncome: null })
  })

  it('keeps a month after the first data with nothing in it as a month with a bar of nothing', () => {
    const months = run('2026-06', '2026-09', (month) =>
      month === '2026-07' ? [] : [spending(1000, `${month}-10`)],
    )
    const charts = year('2026', months, '2026-09-30', '2026-06')
    expect(charts.months[6]).toMatchObject({ kind: 'data', spentLevel: 0 })
    expect(charts.monthsShown).toBe(4)
  })

  it('is the sum of its months, the ring and its «≈» each by its own month’s rate (Р-3)', () => {
    const months = [
      counted('2026-01', [spending(5000, '2026-01-10', 'groceries')], '5'),
      counted('2026-02', [spending(4000, '2026-02-10', 'groceries')], '4'),
    ]
    const charts = year('2026', months, '2026-02-20', '2026-01')
    expect(charts.spent).toEqual(money(900_000n, 'AMD'))
    // 5 000 ֏ at 5 and 4 000 ֏ at 4: 1 000 ₽ + 1 000 ₽, never 9 000 ֏ at one rate.
    expect(charts.spentIncome).toEqual(money(200_000n, 'RUB'))
    expect(charts.slices).toEqual([
      expect.objectContaining({
        categoryId: id('groceries'),
        amount: money(900_000n, 'AMD'),
        income: money(200_000n, 'RUB'),
        level: CHART_LEVEL,
        members: [],
      }),
    ])
  })

  it('has no «≈» when a month of the year has no rate, and says nothing of a sum (Р-3)', () => {
    const months = [
      counted('2026-01', [spending(5000, '2026-01-10')], '5'),
      counted('2026-02', [spending(4000, '2026-02-10')], null),
    ]
    const charts = year('2026', months, '2026-02-20', '2026-01')
    expect(charts.spentIncome).toBeNull()
    expect(charts.slices[0]?.income).toBeNull()
    expect(charts.differenceTotal).toBeNull()
    expect(charts.differenceMissing).toEqual(['2026-02'])
  })

  it('puts the categories past six into «Остальные», with who is in it', () => {
    const presetsSpent = [
      'groceries',
      'cafe',
      'transport',
      'home',
      'telecom',
      'health',
      'beauty',
      'other',
    ]
    const months = [
      counted(
        '2026-01',
        presetsSpent.map((preset, index) => spending(9000 - index * 1000, '2026-01-10', preset)),
      ),
    ]
    const charts = year('2026', months, '2026-01-20', '2026-01')
    expect(charts.slices).toHaveLength(7)
    expect(charts.slices.at(-1)).toMatchObject({
      categoryId: null,
      count: 2,
      members: [id('beauty'), id('other')],
    })
    expect(charts.slices.reduce((sum, slice) => sum + slice.level, 0)).toBe(CHART_LEVEL)
  })

  it('sums what was not counted per currency over the year', () => {
    const months = [
      counted('2026-01', [spending(11, '2026-01-10', 'cafe', 'USD')]),
      counted('2026-02', [spending(4, '2026-02-10', 'cafe', 'USD')]),
    ]
    expect(year('2026', months, '2026-02-20', '2026-01').uncounted).toEqual([money(1_500n, 'USD')])
  })

  describe('the average is the usual month of «Месяц» (owner’s decision В-1)', () => {
    it('is of the closed months up to the last closed one, across the new year', () => {
      const months = run('2026-08', '2027-02', monthly(6000))
      const charts = year('2027', months, '2027-02-15', '2026-08')
      expect(charts.average).toMatchObject({
        amount: money(600_000n, 'AMD'),
        from: '2026-08',
        to: '2027-01',
        months: 6,
      })
    })

    it('stands in January, where the year itself has no closed month', () => {
      const months = run('2026-08', '2027-01', monthly(6000))
      expect(year('2027', months, '2027-01-05', '2026-08').average?.months).toBe(5)
    })

    it('ends with December for a past year, and looks twelve months back at most', () => {
      const months = run('2025-06', '2027-02', monthly(6000))
      const charts = year('2026', months, '2027-02-15', '2025-06')
      expect(charts.average).toMatchObject({ from: '2026-01', to: '2026-12', months: 12 })
      expect(charts.running).toBe(false)
    })

    it('never takes the running month in', () => {
      const months = run('2026-06', '2026-09', (month) =>
        month === '2026-09' ? [spending(90_000, '2026-09-10')] : [spending(3000, `${month}-10`)],
      )
      expect(year('2026', months, '2026-09-20', '2026-06').average?.amount).toEqual(
        money(300_000n, 'AMD'),
      )
    })

    it.each([
      [0, '2026-08-20', null, '2026-11'],
      [1, '2026-09-20', null, '2026-11'],
      [2, '2026-10-20', null, '2026-11'],
      [3, '2026-11-20', 3, null],
    ])(
      'with %i closed months: the average or the month it comes in',
      (closed, today, months, from) => {
        const charts = year(
          '2026',
          run('2026-08', today.slice(0, 7), monthly(1000)),
          today,
          '2026-08',
        )
        expect(charts.closedCount).toBe(closed)
        expect(charts.average?.months ?? null).toBe(months)
        expect(charts.averageFrom).toBe(from)
      },
    )

    it('counts a first month begun in its middle as a closed one', () => {
      const months = run('2026-07', '2026-10', (month) =>
        month === '2026-07' ? [spending(1000, '2026-07-28')] : [spending(1000, `${month}-10`)],
      )
      expect(year('2026', months, '2026-10-05', '2026-07').average?.months).toBe(3)
    })

    it('promises no date already gone for a past year (Р-6)', () => {
      const months = run('2026-11', '2027-03', monthly(1000))
      const charts = year('2026', months, '2027-03-10', '2026-11')
      expect(charts.average).toBeNull()
      expect(charts.closedCount).toBe(2)
      expect(charts.averageFrom).toBeNull()
    })

    it('promises no month of the next year for this one', () => {
      const months = run('2026-11', '2026-12', monthly(1000))
      const charts = year('2026', months, '2026-12-10', '2026-11')
      expect(charts.closedCount).toBe(1)
      expect(charts.averageFrom).toBeNull()
    })

    it('leaves out of the average a month short in anything spent, and keeps the threshold', () => {
      const months = run('2026-06', '2026-09', (month) =>
        month === '2026-07'
          ? [spending(9000, '2026-07-10'), spending(5, '2026-07-11', 'other', 'USD')]
          : [spending(3000, `${month}-10`)],
      )
      const charts = year('2026', months, '2026-09-20', '2026-06')
      expect(charts.average).toMatchObject({ amount: money(300_000n, 'AMD'), months: 3 })
    })

    it('draws the dashed line on the bars’ scale', () => {
      const months = run('2026-06', '2026-09', monthly(2000))
      const charts = year('2026', months, '2026-09-20', '2026-06')
      expect(charts.average?.level).toBe(CHART_LEVEL)
      expect(charts.months[5]?.spentLevel).toBe(CHART_LEVEL)
    })
  })

  describe('«% к среднему»', () => {
    it('is a closed month against the whole average', () => {
      const months = run('2026-05', '2026-09', (month) =>
        month === '2026-08' ? [spending(6000, '2026-08-10')] : [spending(3000, `${month}-10`)],
      )
      const charts = year('2026', months, '2026-09-20', '2026-05')
      // May–August: 3 000, 3 000, 3 000, 6 000 — a mean of 3 750; August is +60 %.
      expect(charts.months[7]?.change).toBe(60)
    })

    it('is the running month against the usual to the same day (owner’s decision В-2)', () => {
      // Each closed month: 2 000 ֏ on the 5th, 4 000 ֏ on the 25th. To the 12th, the usual is 2 000.
      const months = run('2026-06', '2026-09', (month) =>
        month === '2026-09'
          ? [spending(3000, '2026-09-05')]
          : [spending(2000, `${month}-05`), spending(4000, `${month}-25`)],
      )
      const charts = year('2026', months, '2026-09-12', '2026-06')
      expect(charts.months[8]?.change).toBe(50)
      expect(charts.average?.amount).toEqual(money(600_000n, 'AMD'))
    })

    it('reads the running month to a later day spent on, a rent dated ahead (Р-6 of MOL-158)', () => {
      const months = run('2026-06', '2026-09', (month) =>
        month === '2026-09'
          ? [spending(6000, '2026-09-25')]
          : [spending(2000, `${month}-05`), spending(4000, `${month}-25`)],
      )
      expect(year('2026', months, '2026-09-12', '2026-06').months[8]?.change).toBe(0)
    })

    it('says nothing with no average', () => {
      const charts = year('2026', run('2026-08', '2026-09', monthly(1000)), '2026-09-20', '2026-08')
      expect(charts.months.map((month) => month.change)).toEqual(Array<null>(12).fill(null))
    })
  })

  it('adds up «Разница» over the year when every month has one (Р-7)', () => {
    const charts = year('2026', run('2026-01', '2026-02', monthly(500)), '2026-02-20', '2026-01')
    // Nothing came in: 100 ₽ went out each month at 5 ֏ for a rouble.
    expect(charts.differenceTotal).toEqual(money(-20_000n, 'RUB'))
    expect(charts.differenceMissing).toEqual([])
  })

  it('names the month whose «Разница» is missing (Р-7)', () => {
    const months = run('2026-01', '2026-03', (month) =>
      month === '2026-02'
        ? [spending(5, '2026-02-10', 'other', 'USD')]
        : [spending(500, `${month}-10`)],
    )
    const charts = year('2026', months, '2026-03-20', '2026-01')
    expect(charts.differenceTotal).toBeNull()
    expect(charts.differenceMissing).toEqual(['2026-02'])
  })

  // «≈» of «Пришло и ушло» by what a rate did, never by the currencies (MOL-184, adversarial Г1, Г2).
  it('says whether a rate converted what went out or what came in', () => {
    const dollars = {
      base: 'USD',
      quote: 'AMD',
      scaled: parseRate('390'),
      source: 'official',
      asOf: yerevanMidnight('2026-08-10'),
    } as const
    const income = (major: number, currency: Currency, on: string): Income => ({
      id: nextId(),
      actorId: OWNER,
      amount: money(BigInt(major) * 100n, currency),
      receivedOn: on,
      heldBefore: null,
      source: 'salary',
      note: null,
      accountId: null,
      revision: 1,
      createdAt: new Date(`${on}T09:00:00Z`),
      amendedAt: null,
    })
    // Drams in, drams out — and in August a spending in dollars, in September a salary in dollars.
    const inDrams = (month: string, spendings: Spending[], incomes: Income[]) =>
      moneyMonth({
        month,
        spendCurrency: 'AMD',
        incomeCurrency: 'AMD',
        spendings,
        trips: [],
        incomes,
        salaryShiftDay: null,
        categories: presets,
        rate: null,
        rateKind: 'frozen',
        inSpend: never,
        incomeInIncome: (amount) =>
          amount.currency === 'USD' ? money(amount.minor * 390n, 'AMD') : null,
      })
    const months = [
      inDrams('2026-07', [spending(5000, '2026-07-10')], [income(100000, 'AMD', '2026-07-01')]),
      inDrams(
        '2026-08',
        [
          spending(5000, '2026-08-10'),
          { ...spending(11, '2026-08-10', 'other', 'USD'), rate: dollars },
        ],
        [income(100000, 'AMD', '2026-08-01')],
      ),
      inDrams('2026-09', [spending(5000, '2026-09-10')], [income(300, 'USD', '2026-09-01')]),
    ]
    const flags = year('2026', months, '2026-09-30', '2026-07').months.map(
      ({ month, spentEstimated, incomeEstimated }) => ({ month, spentEstimated, incomeEstimated }),
    )
    expect(flags.slice(6, 9)).toEqual([
      { month: '2026-07', spentEstimated: false, incomeEstimated: false },
      { month: '2026-08', spentEstimated: true, incomeEstimated: false },
      { month: '2026-09', spentEstimated: false, incomeEstimated: true },
    ])
    // Two currencies: what went out is always a conversion; a quiet month says nothing.
    const two = year('2026', run('2026-08', '2026-09', monthly(5000)), '2026-09-30', '2026-08')
    expect(two.months[8]).toMatchObject({ spentEstimated: true, incomeEstimated: false })
    expect(two.months[0]).toMatchObject({ spentEstimated: false, incomeEstimated: false })
  })

  it('carries a year past what money holds as no sum, never a failed answer', () => {
    const half = INT8_MAX / 200n + 1n
    const months = [
      counted('2026-01', [spending(half, '2026-01-10')]),
      counted('2026-02', [spending(half, '2026-02-10')]),
    ]
    const charts = year('2026', months, '2026-02-20', '2026-01')
    expect(charts.spent).toBeNull()
    expect(charts.slices).toEqual([])
  })

  it('is twelve quiet months for a newcomer', () => {
    const charts = year(
      '2026',
      run('2026-01', '2026-09', () => []),
      '2026-09-20',
      null,
    )
    expect(charts.months.filter((month) => month.kind === 'data')).toEqual([])
    expect(charts.monthsShown).toBe(0)
    expect(charts.slices).toEqual([])
    expect(charts.spent).toEqual(money(0n, 'AMD'))
    expect(charts.firstMonth).toBeNull()
  })

  describe('«Категория по месяцам»', () => {
    it('offers every live category, the year’s largest first, and an archived one only if spent', () => {
      const months = run('2026-01', '2026-02', (month) => [
        spending(5000, `${month}-10`, 'cafe'),
        spending(1000, `${month}-11`, 'pets'),
      ])
      const charts = year('2026', months, '2026-02-20', '2026-01', [id('pets'), id('beauty')])
      const ids = charts.categories.map((one) => one.categoryId)
      expect(ids.slice(0, 2)).toEqual([id('cafe'), id('pets')])
      expect(ids).not.toContain(id('beauty'))
      expect(ids).toContain(id('groceries'))
      expect(charts.categories[0]?.points).toHaveLength(12)
    })

    it('has an average of its own over the usual’s months, none if spent in none of them', () => {
      const months = run('2026-06', '2026-09', (month) => [
        spending(3000, `${month}-10`, 'cafe'),
        ...(month === '2026-09' ? [spending(800, '2026-09-10', 'pets')] : []),
      ])
      const charts = year('2026', months, '2026-09-20', '2026-06')
      const cafe = charts.categories.find((one) => one.categoryId === id('cafe'))
      const pets = charts.categories.find((one) => one.categoryId === id('pets'))
      expect(cafe?.average).toEqual(money(300_000n, 'AMD'))
      expect(cafe?.averageLevel).toBe(CHART_LEVEL)
      expect(pets?.average).toBeNull()
      expect(pets?.points[8]?.change).toBeNull()
    })

    it('compares the running month to the same day, a closed one to the whole', () => {
      const months = run('2026-05', '2026-09', (month) =>
        month === '2026-09'
          ? [spending(1000, '2026-09-05', 'cafe')]
          : month === '2026-08'
            ? [spending(1000, '2026-08-05', 'cafe'), spending(5000, '2026-08-25', 'cafe')]
            : [spending(1000, `${month}-05`, 'cafe'), spending(1000, `${month}-25`, 'cafe')],
      )
      const cafe = year('2026', months, '2026-09-12', '2026-05').categories[0]
      // May–August whole: 2 000, 2 000, 2 000, 6 000 — 3 000; August is +100 %.
      expect(cafe?.points[7]?.change).toBe(100)
      // To the 12th each had 1 000: September's 1 000 is even.
      expect(cafe?.points[8]?.change).toBe(0)
    })

    it('leaves out of a category’s average only a month short in it', () => {
      const months = run('2026-06', '2026-09', (month) =>
        month === '2026-07'
          ? [spending(9000, '2026-07-10', 'cafe'), spending(5, '2026-07-11', 'cafe', 'USD')]
          : [spending(3000, `${month}-10`, 'cafe'), spending(1000, `${month}-10`, 'pets')],
      )
      const charts = year('2026', months, '2026-09-20', '2026-06')
      const cafe = charts.categories.find((one) => one.categoryId === id('cafe'))
      expect(cafe?.average).toEqual(money(300_000n, 'AMD'))
    })
  })
})

describe('yearCharts — review and adversarial pass of PR #106', () => {
  it('compares no month short in what was spent, and no category short in it (А, review 2)', () => {
    // June to August whole; September's cafe paid in dollars with no rate — «не посчитано: $30».
    const months = run('2026-06', '2026-10', (month) =>
      month === '2026-09'
        ? [spending(100_000, '2026-09-05', 'groceries'), spending(30, '2026-09-10', 'cafe', 'USD')]
        : month === '2026-10'
          ? []
          : [
              spending(100_000, `${month}-05`, 'groceries'),
              spending(20_000, `${month}-10`, 'cafe'),
            ],
    )
    const charts = year('2026', months, '2026-10-02', '2026-06')
    expect(charts.average?.amount).toEqual(money(12_000_000n, 'AMD'))
    expect(charts.months[8]?.change).toBeNull()
    const cafe = charts.categories.find((one) => one.categoryId === id('cafe'))
    expect(cafe?.points[8]?.change).toBeNull()
    // Control: «Продукты» of September are whole, and compared.
    const groceries = charts.categories.find((one) => one.categoryId === id('groceries'))
    expect(groceries?.points[8]?.change).toBe(0)
  })

  it('names the day the running month is compared by: tomorrow, when a payment is dated so (В, review 4)', () => {
    const months = run('2026-07', '2026-10', (month) =>
      month === '2026-10'
        ? [spending(10_000, '2026-10-01'), spending(50_000, '2026-10-03')]
        : [spending(10_000, `${month}-01`), spending(50_000, `${month}-20`)],
    )
    const charts = year('2026', months, '2026-10-02', '2026-07')
    expect(charts.comparedTo).toBe('2026-10-03')
    expect(charts.months[9]?.change).toBe(500)
    // Control: nothing dated ahead — the day is today's.
    const today = [...months.slice(0, 3), counted('2026-10', [spending(10_000, '2026-10-01')])]
    expect(year('2026', today, '2026-10-02', '2026-07').comparedTo).toBe('2026-10-02')
  })

  it('has no day compared by for a past year', () => {
    const months = run('2025-06', '2026-02', monthly(1000))
    expect(year('2025', months, '2026-02-10', '2025-06').comparedTo).toBeNull()
  })

  it('promises «после декабря» to the year whose third closed month is December (review 3)', () => {
    const months = run('2026-10', '2026-11', monthly(1000))
    const charts = year('2026', months, '2026-11-15', '2026-10')
    expect(charts.closedCount).toBe(1)
    expect(charts.averageFrom).toBe('2027-01')
  })
})

describe('yearCharts — round 2 of the adversarial pass', () => {
  it('says why there is no average: too few, each short, or past what money holds (З)', () => {
    const few = year('2026', run('2026-08', '2026-10', monthly(1000)), '2026-10-02', '2026-08')
    expect([few.average, few.averageMissing]).toEqual([null, 'few'])

    const short = run('2026-07', '2026-10', (month) =>
      month === '2026-10'
        ? []
        : [spending(1000, `${month}-05`), spending(10, `${month}-12`, 'other', 'USD')],
    )
    expect(year('2026', short, '2026-10-02', '2026-07').averageMissing).toBe('uncounted')

    // Each month whole and within money; the three together are not (d9 А of MOL-74).
    const huge = INT8_MAX / 200n
    const beyond = run('2026-07', '2026-10', (month) =>
      month === '2026-10' ? [] : [spending(huge, `${month}-05`)],
    )
    const charts = year('2026', beyond, '2026-10-02', '2026-07')
    expect(charts.months[6]?.uncounted).toEqual([])
    // No sum, and no «≈» of it under the «—» (adversarial И), for a reason that is no rate's.
    expect([charts.spent, charts.spentIncome, charts.spentIncomeMissing]).toEqual([
      null,
      null,
      'beyond',
    ])
    expect([charts.average, charts.averageMissing]).toEqual([null, 'beyond'])

    const whole = year('2026', run('2026-07', '2026-10', monthly(1000)), '2026-10-02', '2026-07')
    expect(whole.averageMissing).toBeNull()
  })
})

describe('yearCharts — round 5 of the adversarial pass', () => {
  it('says why the year has no «≈»: a month with no rate, or a sum past money (М′)', () => {
    const rate = [
      counted('2026-01', [spending(5000, '2026-01-10')], '5'),
      counted('2026-02', [spending(4000, '2026-02-10')], null),
    ]
    const missing = year('2026', rate, '2026-02-20', '2026-01')
    expect([missing.spentIncome, missing.spentIncomeMissing]).toEqual([null, 'rate'])
    expect(missing.rateMissing).toEqual(['2026-02'])

    // Every month has its «≈», each within money, and the year's sum too — but not the sum of «≈»:
    // a rate of 0,1 ֏ for a rouble makes the roubles ten times the drams.
    const big = 4n * 10n ** 15n
    const beyond = ['2026-07', '2026-08', '2026-09'].map((month) =>
      counted(month, [spending(big, `${month}-05`)], '0.1'),
    )
    const charts = year('2026', beyond, '2026-09-20', '2026-07')
    expect(charts.spent).not.toBeNull()
    expect(charts.months[6]?.spentIncome).not.toBeNull()
    expect([charts.spentIncome, charts.spentIncomeMissing]).toEqual([null, 'beyond'])

    const whole = year('2026', run('2026-07', '2026-09', monthly(1000)), '2026-09-20', '2026-07')
    expect(whole.spentIncomeMissing).toBeNull()
  })
})

describe('yearCharts — round 6 of the adversarial pass', () => {
  it('a month whose own «≈» is past money had a rate: no «нет курса» for it (М″)', () => {
    // July's «≈» alone is past money at 0,1 ֏ for a rouble; August and September are ordinary.
    const july = counted('2026-07', [spending(10n ** 16n, '2026-07-05')], '0.1')
    const months = [july, ...run('2026-08', '2026-09', monthly(1000))]
    const charts = year('2026', months, '2026-09-20', '2026-07')
    expect(charts.months[6]?.spentIncome).toBeNull()
    expect(charts.spent).not.toBeNull()
    expect(charts.rateMissing).toEqual([])
    expect([charts.spentIncome, charts.spentIncomeMissing]).toEqual([null, 'beyond'])
  })
})
