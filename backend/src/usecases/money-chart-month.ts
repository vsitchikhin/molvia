import {
  TRIP_CATEGORY,
  USUAL_MONTHS,
  categoryOrder,
  chartMonths,
  moneyChartMonthViewOf,
  monthCharts,
  monthOf,
  previousMonth,
} from '@molvia/model'
import type { Actor, MoneyChartMonthView, MoneyMonth } from '@molvia/model'
import { countMonth, monthRate, monthRows, settleThaws } from './money-month'
import { dayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'
import { todayOf } from './today'
import type { Today } from './today'

type Repositories = Pick<
  TripRepositories,
  'spendings' | 'spendingCategories' | 'money' | 'exchanges' | 'incomes' | 'rates'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'> & Today

/**
 * `GET /money/months/:month/charts` (MOL-158): «Графики → Месяц». The month itself is counted as
 * `GET /money/months/:month` counts it — the same rows, the same rate of the month, frozen by this
 * read as by opening it — so the ring is the month on «Деньгах». **The months of the usual are
 * counted with no rate of their own** (Р-3), as «the month before» of «Деньги» is: the usual needs
 * only their sums in the spending currency, which every spending holds by the rate of its own day,
 * so reading the charts of September does not freeze a year of months behind it.
 */
export async function moneyChartMonthOf(
  repositories: Repositories,
  owner: Owner,
  month: string,
  now: Date = new Date(),
): Promise<MoneyChartMonthView> {
  const today = todayOf(owner, now)
  const current = monthOf(today)
  const window = chartMonths(previousMonth(month), USUAL_MONTHS)

  const [rates, categories, salaryShiftDay, rows] = await Promise.all([
    dayRates(repositories, owner),
    repositories.spendingCategories.list(owner.id),
    repositories.money.salaryShift(owner.id),
    monthRows(repositories, owner, window[0] ?? month, month),
  ])
  let frozen: Awaited<ReturnType<typeof monthRate>>
  try {
    frozen = await monthRate(repositories, owner, rates, month, today)
  } finally {
    // Only a closed month is frozen by a read, so only it is held against what landed meanwhile.
    if (month < current) await settleThaws(repositories, owner, rates.basis)
  }
  const selected = await countMonth(
    owner,
    rates,
    month,
    rows,
    categories,
    frozen.rate,
    frozen.kind,
    salaryShiftDay,
  )
  const before: MoneyMonth[] = []
  // One after the other: the rates of the days are read through one cache, a few at a time.
  for (const one of window.filter((each) => each < current)) {
    before.push(await countMonth(owner, rates, one, rows, categories, null, 'frozen', null))
  }

  return moneyChartMonthViewOf(
    monthCharts({
      selected,
      before,
      today,
      groceries: categories.find((category) => category.preset === TRIP_CATEGORY)?.id,
      categories: categoryOrder(categories).map((category) => ({
        id: category.id,
        archived: category.archivedAt !== null,
      })),
    }),
    categories,
  )
}
