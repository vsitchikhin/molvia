import { z } from 'zod'
import { monthSchema } from './money'
import { spendingCategoryViewCodec, spendingCategoryViewOf } from './spending'
import { exchangeDaySchema } from '#model/entities/exchange'
import { CHART_LEVEL } from '#model/entities/money-charts'
import type { MonthCharts } from '#model/entities/money-chart-month'
import type { YearCharts } from '#model/entities/money-chart-year'
import { categoryOrder } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'

const level = z.int().min(0).max(CHART_LEVEL)

/** A sector of a ring, «Остальные» with its members — the month's and the year's alike. */
const sliceCodec = z.strictObject({
  categoryId: z.uuid().nullable(),
  amount: moneyCodec,
  income: moneyCodec.nullable(),
  count: z.int().min(1),
  level,
  members: z.array(z.uuid()),
})

/**
 * `GET /money/months/:month/charts` (MOL-158): «Графики → Месяц» — the ring of the month, the
 * categories against the usual month and the pace by day, every figure and height the server's. The
 * month is the month of `GET /money/months/:month`; `categories` name every sector and row, archived
 * ones included, in the order of the chips.
 */
export const moneyChartMonthCodec = z.strictObject({
  month: monthSchema,
  running: z.boolean(),
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  spent: moneyCodec,
  spentIncome: moneyCodec.nullable(),
  uncounted: z.array(moneyCodec),
  slices: z.array(sliceCodec),
  /** Null below three closed months; `comparedFrom` is then the first month that has one. */
  usual: z.strictObject({ from: monthSchema, to: monthSchema, months: z.int().min(1) }).nullable(),
  comparedFrom: monthSchema.nullable(),
  closed: z.array(monthSchema),
  /** The owner's first month with anything in it; null — a newcomer, offered a start. */
  firstMonth: monthSchema.nullable(),
  deviations: z.array(
    z.strictObject({
      categoryId: z.uuid(),
      amount: moneyCodec,
      average: moneyCodec,
      /** Whole percent against the usual; null — the usual is nothing, «новая». */
      change: z.int().nullable(),
      level,
      averageLevel: level,
    }),
  ),
  pace: z.strictObject({
    days: z.array(
      z.strictObject({
        day: exchangeDaySchema,
        cumulative: moneyCodec,
        income: moneyCodec.nullable(),
        level,
      }),
    ),
    usual: z
      .array(z.strictObject({ day: exchangeDaySchema, cumulative: moneyCodec, level }))
      .nullable(),
  }),
  categories: z.array(spendingCategoryViewCodec),
})
export type MoneyChartMonthView = z.output<typeof moneyChartMonthCodec>

/** The month's charts as they go on the wire, with the owner's categories to name them. */
export function moneyChartMonthViewOf(
  charts: MonthCharts,
  categories: readonly SpendingCategory[],
): MoneyChartMonthView {
  return {
    ...charts,
    uncounted: [...charts.uncounted],
    closed: [...charts.closed],
    slices: charts.slices.map((slice) => ({ ...slice, members: [...slice.members] })),
    deviations: charts.deviations.map((row) => ({ ...row })),
    pace: {
      days: charts.pace.days.map((day) => ({ ...day })),
      usual: charts.pace.usual?.map((point) => ({ ...point })) ?? null,
    },
    usual: charts.usual && { ...charts.usual },
    categories: categoryOrder(categories).map(spendingCategoryViewOf),
  }
}

/** A calendar year as `YYYY`, one whose January a rate may be dated by — as a month is (`monthSchema`). */
export const yearSchema = z
  .string()
  .regex(/^\d{4}$/)
  .refine((year) => monthSchema.safeParse(`${year}-01`).success)

/**
 * `GET /money/years/:year/charts` (MOL-160): «Графики → Год» — the ring of the calendar year, its
 * twelve months with the usual month as a dashed line, what came in and went out, and every category
 * by month. Each month is the month of `GET /money/months/:month`, and the year is their sum.
 */
export const moneyChartYearCodec = z.strictObject({
  year: yearSchema,
  running: z.boolean(),
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  monthsShown: z.int().min(0).max(12),
  /** Null past what money holds: the ring is grey, the answer never fails for it. */
  spent: moneyCodec.nullable(),
  spentIncome: moneyCodec.nullable(),
  uncounted: z.array(moneyCodec),
  slices: z.array(sliceCodec),
  months: z
    .array(
      z.strictObject({
        month: monthSchema,
        kind: z.enum(['data', 'before', 'future']),
        spent: moneyCodec,
        uncounted: z.array(moneyCodec),
        spentIncome: moneyCodec.nullable(),
        income: moneyCodec,
        incomeUncounted: z.array(moneyCodec),
        difference: signedMoneyCodec.nullable(),
        change: z.int().nullable(),
        spentLevel: level,
        incomeLevel: level,
        spentIncomeLevel: level.nullable(),
      }),
    )
    .length(12),
  /** Null below three closed months; `averageFrom` is then the first month that has one, if any. */
  average: z
    .strictObject({
      amount: moneyCodec,
      level,
      from: monthSchema,
      to: monthSchema,
      months: z.int().min(1),
    })
    .nullable(),
  averageFrom: monthSchema.nullable(),
  closedCount: z.int().min(0),
  differenceTotal: signedMoneyCodec.nullable(),
  differenceMissing: z.array(monthSchema),
  /** The owner's first month with anything in it; null — a newcomer, offered a start. */
  firstMonth: monthSchema.nullable(),
  /** Every category of the year's sectors and every live one, largest first (Р-8 of the review). */
  categories: z.array(
    z.strictObject({
      category: spendingCategoryViewCodec,
      average: moneyCodec.nullable(),
      averageLevel: level.nullable(),
      points: z
        .array(
          z.strictObject({
            month: monthSchema,
            amount: moneyCodec,
            change: z.int().nullable(),
            level,
          }),
        )
        .length(12),
    }),
  ),
})
export type MoneyChartYearView = z.output<typeof moneyChartYearCodec>

/** The year's charts as they go on the wire, each series named by its category. */
export function moneyChartYearViewOf(
  charts: YearCharts,
  categories: readonly SpendingCategory[],
): MoneyChartYearView {
  const named = new Map(categories.map((category) => [category.id, category]))
  return {
    ...charts,
    uncounted: [...charts.uncounted],
    slices: charts.slices.map((slice) => ({ ...slice, members: [...slice.members] })),
    months: charts.months.map((month) => ({
      ...month,
      uncounted: [...month.uncounted],
      incomeUncounted: [...month.incomeUncounted],
    })),
    average: charts.average && { ...charts.average },
    differenceMissing: [...charts.differenceMissing],
    categories: charts.categories.flatMap((series) => {
      const category = named.get(series.categoryId)
      return category
        ? [
            {
              category: spendingCategoryViewOf(category),
              average: series.average,
              averageLevel: series.averageLevel,
              points: series.points.map((point) => ({ ...point })),
            },
          ]
        : []
    }),
  }
}
