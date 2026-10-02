import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  moneyChartsCodec,
  moneyChartsQuerySchema,
  moneyChartsViewOf,
  moneyChartYearCodec,
  moneyChartYearViewOf,
  yearSchema,
} from '#model/contracts/money-charts'
import { yearCharts } from '#model/entities/money-chart-year'
import { exchangeLosses, moneyCharts, rateLine } from '#model/entities/money-charts'
import { moneyMonth } from '#model/entities/money-month'
import type { MoneyMonth } from '#model/entities/money-month'
import type { SpendingCategory } from '#model/entities/spending-category'
import { money } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'

const GROCERIES = '00000000-0000-4000-9000-000000000001'
const REMOVED = '00000000-0000-4000-9000-000000000002'

const categories: SpendingCategory[] = [
  {
    id: GROCERIES,
    actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
    preset: 'groceries',
    name: null,
    colour: null,
    archivedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  },
]

function month(name: string, spent: bigint, byCategory: [string, bigint][] = []): MoneyMonth {
  return {
    month: name,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: money(spent, 'AMD'),
    uncounted: [],
    uncountedIn: [],
    foreign: [],
    spentIncome: money(spent / 4n, 'RUB'),
    income: money(10_000_00n, 'RUB'),
    incomeUncounted: [],
    incomeCount: 0,
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    rate: null,
    rateKind: 'frozen',
    byCategory: byCategory.map(([categoryId, minor]) => ({
      categoryId,
      amount: money(minor, 'AMD'),
    })),
    days: [],
  }
}

describe('moneyChartsQuerySchema', () => {
  it('is six months unless twelve are asked for', () => {
    expect(moneyChartsQuerySchema.parse({})).toEqual({ period: 6 })
    expect(moneyChartsQuerySchema.parse({ period: '6' })).toEqual({ period: 6 })
    expect(moneyChartsQuerySchema.parse({ period: '12' })).toEqual({ period: 12 })
  })

  it('refuses any other period and any other parameter', () => {
    for (const period of ['7', '0', '', '12 ', 'twelve']) {
      expect(moneyChartsQuerySchema.safeParse({ period }).success).toBe(false)
    }
    expect(moneyChartsQuerySchema.safeParse({ period: '6', actorId: 'x' }).success).toBe(false)
  })
})

describe('moneyChartsCodec', () => {
  it('carries the charts whole, and names a series only by a category the owner has', () => {
    const charts = moneyCharts(
      [
        month('2026-08', 200_000_00n, [
          [GROCERIES, 150_000_00n],
          [REMOVED, 50_000_00n],
        ]),
        month('2026-09', 100_000_00n, [[GROCERIES, 100_000_00n]]),
      ],
      month('2026-07', 0n),
    )
    const losses = exchangeLosses(
      [
        {
          note: 'Аэропорт',
          exchangedOn: '2026-08-25',
          difference: money(-14_604_00n, 'AMD'),
          expected: money(202_600_00n, 'AMD'),
        },
      ],
      'AMD',
    )
    const line = rateLine(
      [
        {
          day: '2026-09-27',
          rate: {
            base: 'RUB',
            quote: 'AMD',
            scaled: parseRate('4.061021'),
            source: 'official',
            asOf: yerevanMidnight('2026-09-26'),
          },
        },
      ],
      [],
    )
    const view = moneyChartsViewOf(6, charts, categories, losses, line)
    expect(view.categories.map((series) => series.category.id)).toEqual([GROCERIES])

    const wire = z.encode(moneyChartsCodec, view)
    expect(wire.months[0]?.spent).toEqual({ amount: '200000.00', currency: 'AMD' })
    expect(wire.exchanges?.groups[0]).toMatchObject({
      place: 'Аэропорт',
      percent: -721,
      difference: { amount: '-14604.00', currency: 'AMD' },
    })
    expect(wire.rate?.points[0]?.rate?.rate).toBe('4.061021')
    expect(z.decode(moneyChartsCodec, wire)).toEqual(view)
  })

  it('refuses a height above the tallest and a field the phone does not know', () => {
    const view = moneyChartsViewOf(
      12,
      moneyCharts([month('2026-09', 1n)], month('2026-08', 0n)),
      categories,
      null,
      null,
    )
    const wire = z.encode(moneyChartsCodec, view)
    expect(moneyChartsCodec.safeParse(wire).success).toBe(true)
    const tall = { ...wire, months: [{ ...wire.months[0], spentLevel: 1001 }] }
    expect(moneyChartsCodec.safeParse(tall).success).toBe(false)
    expect(moneyChartsCodec.safeParse({ ...wire, sponsored: true }).success).toBe(false)
  })
})

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const PETS = '00000000-0000-4000-9000-000000000002'

const yearCategories: SpendingCategory[] = [
  {
    id: GROCERIES,
    actorId: OWNER,
    preset: 'groceries',
    name: null,
    colour: null,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    id: PETS,
    actorId: OWNER,
    preset: 'pets',
    name: null,
    colour: null,
    archivedAt: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
]

function counted(month: string, groceries: bigint) {
  return moneyMonth({
    month,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spendings: [
      {
        id: `00000000-0000-4000-8000-0000000000${month.slice(5)}`,
        actorId: OWNER,
        spentOn: `${month}-10`,
        amount: money(groceries, 'AMD'),
        categoryId: GROCERIES,
        note: null,
        place: null,
        rate: null,
        accountId: null,
        debited: null,
        revision: 1,
        createdAt: new Date(`${month}-10T10:00:00Z`),
        amendedAt: null,
      },
    ],
    trips: [],
    incomes: [],
    salaryShiftDay: null,
    categories: yearCategories,
    rate: {
      base: 'RUB',
      quote: 'AMD',
      scaled: parseRate('5'),
      source: 'official',
      asOf: yerevanMidnight(`${month}-01`),
    },
    rateKind: 'frozen',
    inSpend: () => null,
    incomeInIncome: () => null,
  })
}

function view() {
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'].map((month) =>
    counted(month, 300_000n),
  )
  return moneyChartYearViewOf(
    yearCharts({
      year: '2026',
      months,
      before: [],
      today: '2026-09-20',
      groceries: GROCERIES,
      categories: yearCategories.map((one) => ({ id: one.id, archived: one.archivedAt !== null })),
      firstMonth: '2026-06',
    }),
    yearCategories,
  )
}

describe('yearSchema', () => {
  it('is a year of four digits whose January a rate may be dated by', () => {
    expect(yearSchema.safeParse('2026').success).toBe(true)
    expect(yearSchema.safeParse('0000').success).toBe(false)
    expect(yearSchema.safeParse('26').success).toBe(false)
    expect(yearSchema.safeParse('2026-01').success).toBe(false)
  })
})

describe('moneyChartYearCodec (MOL-160)', () => {
  it('carries the year whole and back, every series named by its category', () => {
    const sent = view()
    const wire = z.encode(moneyChartYearCodec, sent)
    expect(z.decode(moneyChartYearCodec, wire)).toEqual(sent)
    expect(sent.months).toHaveLength(12)
    expect(sent.average).toMatchObject({ from: '2026-06', to: '2026-08', months: 3 })
    // A removed category not spent in the year is offered nowhere (Р-8 of the review).
    expect(sent.categories.map((one) => one.category.id)).toEqual([GROCERIES])
  })

  it('refuses a year of eleven months and a field the phone does not know', () => {
    const wire = z.encode(moneyChartYearCodec, view())
    expect(moneyChartYearCodec.safeParse({ ...wire, months: wire.months.slice(1) }).success).toBe(
      false,
    )
    expect(moneyChartYearCodec.safeParse({ ...wire, boost: 1 }).success).toBe(false)
  })
})
