import { z } from 'zod'
import { monthSchema } from './money'
import { spendingCategoryViewCodec, spendingCategoryViewOf } from './spending'
import { exchangeDaySchema } from '#model/entities/exchange'
import { CHART_LEVEL } from '#model/entities/money-charts'
import type { ExchangeLosses, MoneyCharts, RateLine } from '#model/entities/money-charts'
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
const signedLevel = z.int().min(-CHART_LEVEL).max(CHART_LEVEL)

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
  exchanges: z
    .strictObject({
      total: signedMoneyCodec,
      uncounted: z.int().min(0),
      groups: z.array(
        z.strictObject({
          place: z.string().nullable(),
          count: z.int().min(1),
          difference: signedMoneyCodec,
          /** Hundredths of a percent: −721 is «−7,21 %». */
          percent: z.int(),
          level: signedLevel,
        }),
      ),
    })
    .nullable(),
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
    exchanges: exchanges && {
      total: exchanges.total,
      uncounted: exchanges.uncounted,
      groups: exchanges.groups.map((group) => ({ ...group })),
    },
    rate: rate && {
      points: rate.points.map((point) => ({ ...point })),
      exchanges: rate.exchanges.map((exchange) => ({ ...exchange })),
    },
  }
}
