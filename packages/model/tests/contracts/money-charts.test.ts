import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  moneyChartYearCodec,
  moneyChartYearViewOf,
  yearSchema,
} from '#model/contracts/money-charts'
import { yearCharts } from '#model/entities/money-chart-year'
import { moneyMonth } from '#model/entities/money-month'
import type { SpendingCategory } from '#model/entities/spending-category'
import { money } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const GROCERIES = '00000000-0000-4000-9000-000000000001'
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
        transferId: null,
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

  it('carries a year past what money holds as no sum, through the codec both ways (d9 А of MOL-74)', () => {
    const past = { ...view(), spent: null, spentIncome: null, slices: [] }
    expect(z.decode(moneyChartYearCodec, z.encode(moneyChartYearCodec, past))).toEqual(past)
  })

  it('carries the day the running month is compared by, and refuses one that is not a day', () => {
    const wire = z.encode(moneyChartYearCodec, view())
    expect(wire.comparedTo).toBe('2026-09-20')
    expect(moneyChartYearCodec.safeParse({ ...wire, comparedTo: '2026-09' }).success).toBe(false)
  })

  it('reads a year kept before the flags of conversion as «≈», as it was drawn (MOL-184)', () => {
    const wire = z.encode(moneyChartYearCodec, view())
    const months = wire.months.map((month): Record<string, unknown> => ({ ...month }))
    for (const month of months) {
      delete month.spentEstimated
      delete month.incomeEstimated
    }
    expect(moneyChartYearCodec.parse({ ...wire, months }).months[0]).toMatchObject({
      spentEstimated: true,
      incomeEstimated: true,
    })
  })

  it('refuses a year of eleven months and a field the phone does not know', () => {
    const wire = z.encode(moneyChartYearCodec, view())
    expect(moneyChartYearCodec.safeParse({ ...wire, months: wire.months.slice(1) }).success).toBe(
      false,
    )
    expect(moneyChartYearCodec.safeParse({ ...wire, boost: 1 }).success).toBe(false)
  })
})
