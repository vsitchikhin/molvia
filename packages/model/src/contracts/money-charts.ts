import { z } from 'zod'
import { exchangeLossesCodec, exchangeLossesViewOf } from './exchange'
import { monthSchema } from './money'
import { spendingCategoryViewCodec, spendingCategoryViewOf } from './spending'
import { exchangeDaySchema } from '#model/entities/exchange'
import { CHART_LEVEL } from '#model/entities/money-charts'
import type { ExchangeLosses, MoneyCharts, RateLine } from '#model/entities/money-charts'
import type { MonthCharts } from '#model/entities/money-chart-month'
import { categoryOrder } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'
import { rateCodec } from '#model/values/rates'

/** `?period=6|12`, six when not named (handoff 03); anything else is refused by its name. */
export const moneyChartsQuerySchema = z.strictObject({
  period: z
    .enum(['6', '12'])
    .default('6')
    .transform((period) => (period === '12' ? 12 : 6)),
})

const level = z.int().min(0).max(CHART_LEVEL)

/**
 * `GET /money/charts` (MOL-74): the months of «Графики» side by side, the exchanges against the
 * central bank by exchanger and the rate of the pair by week — counted by the server, every height
 * included, so the phone only draws. A month here is the month of `GET /money/months/:month`.
 */
export const moneyChartsCodec = z.strictObject({
  period: z.union([z.literal(6), z.literal(12)]),
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  since: monthSchema.nullable(),
  months: z.array(
    z.strictObject({
      month: monthSchema,
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
  ),
  spentAverage: moneyCodec.nullable(),
  differenceAverage: signedMoneyCodec.nullable(),
  categories: z.array(
    z.strictObject({
      category: spendingCategoryViewCodec,
      average: moneyCodec.nullable(),
      averageLevel: level.nullable(),
      points: z.array(
        z.strictObject({
          month: monthSchema,
          amount: moneyCodec,
          change: z.int().nullable(),
          level,
        }),
      ),
    }),
  ),
  /** Null — no exchange of the twelve months could be measured: no card (handoff 03). */
  exchanges: exchangeLossesCodec.nullable(),
  /** Null — one currency for both, or nothing known of the pair in the period (Р-14). */
  rate: z
    .strictObject({
      points: z.array(
        z.strictObject({
          day: exchangeDaySchema,
          rate: rateCodec.nullable(),
          level: level.nullable(),
        }),
      ),
      exchanges: z.array(
        z.strictObject({
          day: exchangeDaySchema,
          week: z.int().min(0),
          rate: rateCodec,
          level,
        }),
      ),
    })
    .nullable(),
})
export type MoneyChartsView = z.output<typeof moneyChartsCodec>

/** The charts as they go on the wire, each series of a category named by its category. */
export function moneyChartsViewOf(
  period: 6 | 12,
  charts: MoneyCharts,
  categories: readonly SpendingCategory[],
  exchanges: ExchangeLosses | null,
  rate: RateLine | null,
): MoneyChartsView {
  const named = new Map(categoryOrder(categories).map((category) => [category.id, category]))
  return {
    period,
    spendCurrency: charts.spendCurrency,
    incomeCurrency: charts.incomeCurrency,
    since: charts.since,
    months: charts.months.map((month) => ({
      ...month,
      uncounted: [...month.uncounted],
      incomeUncounted: [...month.incomeUncounted],
    })),
    spentAverage: charts.spentAverage,
    differenceAverage: charts.differenceAverage,
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
    exchanges: exchanges && exchangeLossesViewOf(exchanges),
    rate: rate && {
      points: rate.points.map((point) => ({ ...point })),
      exchanges: rate.exchanges.map((exchange) => ({ ...exchange })),
    },
  }
}

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
  slices: z.array(
    z.strictObject({
      categoryId: z.uuid().nullable(),
      amount: moneyCodec,
      income: moneyCodec.nullable(),
      count: z.int().min(1),
      level,
      members: z.array(z.uuid()),
    }),
  ),
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
