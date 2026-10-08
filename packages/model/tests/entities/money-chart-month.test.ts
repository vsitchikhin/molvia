import { describe, expect, it } from 'vitest'
import {
  comparedDay,
  DEVIATIONS_SHOWN,
  monthCharts,
  previousToDay,
  USUAL_MIN_CLOSED,
} from '#model/entities/money-chart-month'
import type { MonthChartsInput } from '#model/entities/money-chart-month'
import { CHART_LEVEL } from '#model/entities/money-charts'
import { moneyMonth } from '#model/entities/money-month'
import type { ConvertOn, MoneyMonth, TripLine } from '#model/entities/money-month'
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
  major: number,
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

function trip(major: number, on: string): TripLine {
  return {
    tripId: nextId(),
    placeName: 'Ереван Сити',
    items: 3,
    finishedOn: on,
    finishedAt: new Date(`${on}T15:00:00Z`),
    amount: money(BigInt(major) * 100n, 'AMD'),
  }
}

const never: ConvertOn = () => null

/** A month counted as «Деньги» count it: drams spent, roubles come in, 5 ֏ for a rouble. */
function counted(month: string, spendings: Spending[] = [], trips: TripLine[] = []): MoneyMonth {
  return moneyMonth({
    month,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spendings,
    trips,
    incomes: [],
    salaryShiftDay: null,
    categories: presets,
    rate: {
      base: 'RUB',
      quote: 'AMD',
      scaled: parseRate('5'),
      source: 'official',
      asOf: yerevanMidnight(`${month}-01`),
    },
    rateKind: 'frozen',
    inSpend: never,
    incomeInIncome: never,
  })
}

function charts(
  selected: MoneyMonth,
  before: MoneyMonth[],
  today: string,
  archived: string[] = [],
  firstMonth: string | null = null,
): ReturnType<typeof monthCharts> {
  const input: MonthChartsInput = {
    selected,
    before,
    today,
    firstMonth,
    groceries: id('groceries'),
    categories: presets.map((category) => ({
      id: category.id,
      archived: archived.includes(category.id),
    })),
  }
  return monthCharts(input)
}

/** June, July and August of the example in the plan: groceries by the 12th and in the whole month. */
const closed = [
  counted('2026-06', [
    spending(20_000, '2026-06-10', 'groceries'),
    spending(38_000, '2026-06-25', 'groceries'),
  ]),
  counted('2026-07', [
    spending(26_000, '2026-07-12', 'groceries'),
    spending(38_000, '2026-07-20', 'groceries'),
  ]),
  counted('2026-08', [
    spending(23_000, '2026-08-01', 'groceries'),
    spending(38_000, '2026-08-31', 'groceries'),
  ]),
]
const amd = (major: number) => money(BigInt(major) * 100n, 'AMD')

describe('monthCharts — the usual month', () => {
  it('needs three closed months, and names the first month that has them', () => {
    const september = counted('2026-09', [spending(1_000, '2026-09-03')])
    for (let count = 0; count < USUAL_MIN_CLOSED; count += 1) {
      const answer = charts(september, closed.slice(USUAL_MIN_CLOSED - count), '2026-09-12')
      expect(answer.usual).toBeNull()
      expect(answer.deviations).toEqual([])
      expect(answer.pace.usual).toBeNull()
    }
    // Data from August: August, September, October are closed before November — «с ноября».
    const august = charts(september, closed.slice(2), '2026-09-12')
    expect(august.comparedFrom).toBe('2026-11')
    expect(august.closed).toEqual(['2026-08'])
    // The very first month: it is the start.
    expect(charts(september, [], '2026-09-12').comparedFrom).toBe('2026-12')
    const three = charts(september, closed, '2026-09-12')
    expect(three.usual).toEqual({ from: '2026-06', to: '2026-08', months: 3 })
    expect(three.comparedFrom).toBeNull()
  })

  it('names of a past month what was closed before it, and a first month that is true (adversarial Г)', () => {
    // 1 October, data from July: September is closed, and before it only July and August are.
    const july = counted('2026-07', [spending(1_000, '2026-07-03')])
    const august = counted('2026-08', [spending(1_000, '2026-08-03')])
    const september = counted('2026-09', [spending(1_000, '2026-09-03')])
    const answer = charts(september, [july, august], '2026-10-01')
    expect(answer.running).toBe(false)
    expect(answer.closed).toEqual(['2026-07', '2026-08'])
    // October is the first month with three closed before it — never September, already past.
    expect(answer.comparedFrom).toBe('2026-10')
    expect(charts(august, [july], '2026-10-01').comparedFrom).toBe('2026-10')
  })

  it("of a month before any data, counts from the owner's first month, not from itself (adversarial К)", () => {
    const answer = charts(counted('2026-05'), [], '2026-10-01', [], '2026-07')
    expect(answer.firstMonth).toBe('2026-07')
    expect(answer.comparedFrom).toBe('2026-10')
    expect(charts(counted('2026-05'), [], '2026-10-01').firstMonth).toBeNull()
  })

  it('names no first month already past — data two years back and none since (adversarial round 2, Н4)', () => {
    expect(charts(counted('2026-09'), [], '2026-10-01', [], '2024-01').comparedFrom).toBeNull()
    // Data again since July: the first month with a comparison is ahead, and named.
    const july = counted('2026-07', [spending(1_000, '2026-07-03')])
    expect(charts(counted('2026-09'), [july], '2026-10-01', [], '2024-01').comparedFrom).toBe(
      '2026-10',
    )
  })

  it('has no first month past the last a calendar of four digits holds (adversarial Ж)', () => {
    expect(charts(counted('9999-11'), [], '2026-10-01').comparedFrom).toBeNull()
    expect(charts(counted('9999-09'), [], '2026-10-01').comparedFrom).toBe('9999-12')
  })

  it('starts at the first month with anything in it, a half month included', () => {
    const empty = [counted('2026-03'), counted('2026-04'), counted('2026-05')]
    const answer = charts(counted('2026-09'), [...empty, ...closed], '2026-09-12')
    expect(answer.usual).toEqual({ from: '2026-06', to: '2026-08', months: 3 })
  })

  it('never takes the running month, nor anything after it', () => {
    // Looking back at July while September runs: June alone is before it.
    const july = charts(closed[1]!, [closed[0]!], '2026-09-12')
    expect(july.running).toBe(false)
    expect(july.usual).toBeNull()
    // A month in the window that is not closed yet is not a usual month.
    const running = counted('2026-09', [spending(5_000, '2026-09-02', 'groceries')])
    const october = charts(counted('2026-10'), [...closed, running], '2026-09-12')
    expect(october.usual).toEqual({ from: '2026-06', to: '2026-08', months: 3 })
  })
})

describe('monthCharts — against the usual', () => {
  it('compares the running month with the usual to the same day (review В-3)', () => {
    const september = counted('2026-09', [spending(30_000, '2026-09-05', 'groceries')])
    const [row] = charts(september, closed, '2026-09-12').deviations
    expect(row).toMatchObject({
      categoryId: id('groceries'),
      amount: amd(30_000),
      average: amd(23_000),
      change: 30,
    })
  })

  it('compares a closed month with the whole usual month', () => {
    const september = counted('2026-09', [spending(68_000, '2026-09-05', 'groceries')])
    const [row] = charts(september, closed, '2026-10-02').deviations
    expect(row).toMatchObject({ amount: amd(68_000), average: amd(61_000), change: 11 })
  })

  it('reads the closed months to their own last day when the month shown is longer', () => {
    const feb = counted('2027-02', [spending(28_000, '2027-02-28', 'groceries')])
    const before = [
      counted('2026-11', [spending(1_000, '2026-11-01', 'groceries')]),
      counted('2026-12', [spending(1_000, '2026-12-01', 'groceries')]),
      feb,
    ]
    const march = counted('2027-03', [spending(10_000, '2027-03-31', 'groceries')])
    const answer = charts(march, before, '2027-03-31')
    // To the 31st: February is whole, (1 000 + 1 000 + 28 000) / 3.
    expect(answer.deviations[0]?.average).toEqual(amd(10_000))
    expect(answer.pace.usual?.at(-1)?.cumulative).toEqual(amd(10_000))
    expect(answer.pace.usual).toHaveLength(31)
  })

  it('takes the day of a spending dated later than today (Р-6)', () => {
    const september = counted('2026-09', [spending(61_000, '2026-09-25', 'groceries')])
    const answer = charts(september, closed, '2026-09-12')
    expect(answer.pace.days).toHaveLength(25)
    expect(answer.pace.days.at(-1)?.cumulative).toEqual(september.spent)
    // To the 25th: 58 000, 64 000 and 23 000 — August's second half came on the 31st.
    expect(answer.deviations[0]).toMatchObject({ average: money(4_833_333n, 'AMD'), change: 26 })
  })

  it('says −100 % of a category not spent on, and «новая» of one never spent before', () => {
    const september = counted('2026-09', [spending(5_000, '2026-09-02', 'cafe')])
    const rows = charts(september, closed, '2026-10-01').deviations
    expect(rows.find((row) => row.categoryId === id('groceries'))).toMatchObject({
      amount: amd(0),
      change: -100,
      level: 0,
    })
    expect(rows.find((row) => row.categoryId === id('cafe'))).toMatchObject({
      average: amd(0),
      change: null,
      averageLevel: 0,
    })
  })

  it('leaves out a category put away and not spent on, keeps one spent on (Р-5)', () => {
    const groceries = id('groceries')
    const quiet = charts(counted('2026-09'), closed, '2026-10-01', [groceries]).deviations
    expect(quiet).toEqual([])
    const spent = counted('2026-09', [spending(10, '2026-09-02', 'groceries')])
    expect(charts(spent, closed, '2026-10-01', [groceries]).deviations).toHaveLength(1)
  })

  it('orders by the difference in drams, not in percent, and shows five', () => {
    const presetsSpent = ['groceries', 'cafe', 'transport', 'home', 'health', 'clothes', 'other']
    const september = counted(
      '2026-09',
      presetsSpent.map((preset, index) => spending((index + 1) * 1_000, '2026-09-02', preset)),
    )
    const rows = charts(september, closed, '2026-10-01').deviations
    expect(rows).toHaveLength(DEVIATIONS_SHOWN)
    // Groceries: 1 000 against 61 000 — the widest gap, and only −98 %.
    expect(rows[0]?.categoryId).toBe(id('groceries'))
    expect(rows.slice(1).map((row) => row.amount)).toEqual([
      amd(7_000),
      amd(6_000),
      amd(5_000),
      amd(4_000),
    ])
    expect(Math.max(...rows.flatMap((row) => [row.level, row.averageLevel]))).toBe(CHART_LEVEL)
  })

  it('leaves a month short in a category out of that category alone', () => {
    const short = counted('2026-08', [
      spending(23_000, '2026-08-01', 'groceries'),
      spending(10, '2026-08-02', 'cafe', 'USD'),
    ])
    const answer = charts(
      counted('2026-09', [
        spending(1_000, '2026-09-02', 'cafe'),
        spending(61_000, '2026-09-02', 'groceries'),
      ]),
      [closed[0]!, closed[1]!, short],
      '2026-10-01',
    )
    // Groceries over all three, 58 000, 64 000 and 23 000; the café over June and July, where it
    // was nothing — «новая».
    expect(answer.deviations.find((row) => row.categoryId === id('groceries'))?.average).toEqual(
      money(4_833_333n, 'AMD'),
    )
    expect(answer.deviations.find((row) => row.categoryId === id('cafe'))?.change).toBeNull()
    // The usual line leaves out the month short in anything spent.
    expect(answer.pace.usual?.at(-1)?.cumulative).toEqual(amd(61_000))
  })

  it('compares no category short in the month shown, nor one whose every usual month is short (adversarial Д)', () => {
    // September's groceries are 30 000 ֏ and 100 $ no rate knew: no «−51 %».
    const september = counted('2026-09', [
      spending(30_000, '2026-09-02', 'groceries'),
      spending(100, '2026-09-03', 'groceries', 'USD'),
      spending(5_000, '2026-09-02', 'cafe'),
    ])
    const rows = charts(september, closed, '2026-10-01').deviations
    expect(rows.map((row) => row.categoryId)).toEqual([id('cafe')])
    // Pets spent in dollars only, every usual month: nothing to compare with — not «новая».
    const pets = (month: string) => spending(10, `${month}-05`, 'pets', 'USD')
    const before = closed.map((month) =>
      counted(month.month, [
        ...month.days.flatMap((day) =>
          day.entries.flatMap((entry) => (entry.kind === 'manual' ? [entry.spending] : [])),
        ),
        pets(month.month),
      ]),
    )
    const now = counted('2026-09', [spending(7_000, '2026-09-02', 'pets')])
    expect(charts(now, before, '2026-10-01').deviations.map((row) => row.categoryId)).not.toContain(
      id('pets'),
    )
  })
})

describe('monthCharts — the pace', () => {
  it('runs to today in the running month and to the last day in a closed one', () => {
    const september = counted('2026-09', [
      spending(1_000, '2026-09-01'),
      spending(2_000, '2026-09-03'),
    ])
    const running = charts(september, closed, '2026-09-12')
    expect(running.running).toBe(true)
    expect(running.pace.days).toHaveLength(12)
    expect(running.pace.days.map((day) => day.cumulative.minor / 100n).slice(0, 4)).toEqual([
      1_000n,
      1_000n,
      3_000n,
      3_000n,
    ])
    expect(charts(september, closed, '2026-10-01').pace.days).toHaveLength(30)
  })

  it('counts a trip in «Продукты» on the day it was finished', () => {
    const september = counted('2026-09', [], [trip(7_000, '2026-09-04')])
    const answer = charts(september, closed, '2026-09-12')
    expect(answer.pace.days[3]?.cumulative).toEqual(amd(7_000))
    expect(answer.deviations[0]).toMatchObject({ categoryId: id('groceries'), amount: amd(7_000) })
  })

  it('puts both lines on one scale and converts by the month rate', () => {
    const september = counted('2026-09', [spending(10_000, '2026-09-01', 'groceries')])
    const answer = charts(september, closed, '2026-09-30')
    const levels = [
      ...answer.pace.days.map((day) => day.level),
      ...(answer.pace.usual ?? []).map((point) => point.level),
    ]
    expect(Math.max(...levels)).toBe(CHART_LEVEL)
    expect(answer.pace.days[0]?.income).toEqual(money(200_000n, 'RUB'))
  })

  it('leaves a sum it could not convert out of the line', () => {
    const september = counted('2026-09', [spending(10, '2026-09-01', 'cafe', 'USD')])
    const answer = charts(september, [], '2026-09-05')
    expect(answer.uncounted).toEqual([money(1_000n, 'USD')])
    expect(answer.pace.days.every((day) => day.cumulative.minor === 0n)).toBe(true)
    expect(answer.slices).toEqual([])
  })

  it('does not fail on sums past what an average can hold', () => {
    const huge = (month: string) => counted(month, [spending(1, `${month}-01`)])
    const months = ['2026-06', '2026-07', '2026-08'].map(huge).map((month) => ({
      ...month,
      days: month.days.map((day) => ({
        ...day,
        entries: day.entries.map((entry) => ({ ...entry, counted: money(INT8_MAX, 'AMD') })),
      })),
    }))
    const answer = charts(counted('2026-09'), months, '2026-09-12')
    expect(answer.pace.usual).toBeNull()
  })
})

describe('monthCharts — the ring', () => {
  it('names who is in «Остальные» and what each sector is in the income currency', () => {
    const presetsSpent = [
      'groceries',
      'cafe',
      'transport',
      'home',
      'health',
      'clothes',
      'other',
      'pets',
    ]
    const september = counted(
      '2026-09',
      presetsSpent.map((preset, index) => spending((10 - index) * 1_000, '2026-09-02', preset)),
    )
    const { slices } = charts(september, [], '2026-09-12')
    expect(slices).toHaveLength(7)
    expect(slices.at(-1)).toMatchObject({
      categoryId: null,
      count: 2,
      members: [id('other'), id('pets')],
      income: money(140_000n, 'RUB'),
    })
    expect(slices[0]).toMatchObject({ members: [], income: money(200_000n, 'RUB') })
  })
})

describe('the day of comparison and the month before to it (MOL-183)', () => {
  it('reads the running month to today', () => {
    expect(comparedDay(counted('2026-10', [spending(500, '2026-10-03')]), '2026-10-12')).toBe(12)
  })

  it('reads it to a later day spent on — a rent dated the 15th (Р-6)', () => {
    const october = counted('2026-10', [spending(500, '2026-10-03'), spending(9000, '2026-10-15')])
    expect(comparedDay(october, '2026-10-12')).toBe(15)
  })

  it('reads a closed month whole, a short one to its own last day', () => {
    expect(comparedDay(counted('2026-09'), '2026-10-12')).toBe(30)
    expect(comparedDay(counted('2026-02'), '2026-10-12')).toBe(28)
  })

  it('takes the month before to the same day, the day itself in, the next out', () => {
    const september = counted('2026-09', [
      spending(100, '2026-09-05'),
      spending(200, '2026-09-12'),
      spending(400, '2026-09-13'),
    ])
    expect(previousToDay(counted('2026-10'), september, '2026-10-12')).toEqual({
      day: 12,
      spent: money(30_000n, 'AMD'),
    })
  })

  it('moves the day with a later spending of the running month', () => {
    const september = counted('2026-09', [spending(200, '2026-09-12'), spending(400, '2026-09-13')])
    const october = counted('2026-10', [spending(9000, '2026-10-15')])
    expect(previousToDay(october, september, '2026-10-12')).toEqual({
      day: 15,
      spent: money(60_000n, 'AMD'),
    })
  })

  it('reads a shorter month before whole — the 31st of March against all of February', () => {
    const february = counted('2026-02', [spending(100, '2026-02-01'), spending(300, '2026-02-28')])
    expect(previousToDay(counted('2026-03'), february, '2026-03-31')).toEqual({
      day: 31,
      spent: money(40_000n, 'AMD'),
    })
  })

  it('counts only what a rate counted, as the month’s own sum does', () => {
    const september = counted('2026-09', [
      spending(100, '2026-09-02'),
      spending(50, '2026-09-03', 'other', 'USD'),
    ])
    expect(september.uncounted).toHaveLength(1)
    expect(previousToDay(counted('2026-10'), september, '2026-10-12')?.spent).toEqual(
      september.spent,
    )
  })

  it('names the day with no sum when the month before holds nothing', () => {
    expect(previousToDay(counted('2026-10'), counted('2026-09'), '2026-10-02')).toEqual({
      day: 2,
      spent: null,
    })
  })

  it('says nothing of a month not running — it is compared whole', () => {
    const september = counted('2026-09', [spending(100, '2026-09-05')])
    expect(previousToDay(counted('2026-08'), counted('2026-07'), '2026-10-12')).toBeNull()
    expect(previousToDay(september, counted('2026-08'), '2026-10-12')).toBeNull()
  })

  it('keeps a zero to the day apart from no month at all', () => {
    const september = counted('2026-09', [spending(100, '2026-09-20')])
    expect(previousToDay(counted('2026-10'), september, '2026-10-12')).toEqual({
      day: 12,
      spent: money(0n, 'AMD'),
    })
  })
})
