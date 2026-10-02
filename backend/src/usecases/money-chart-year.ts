import {
  DomainError,
  ERROR,
  TRIP_CATEGORY,
  USUAL_MONTHS,
  budgetMonthOf,
  categoryOrder,
  chartMonths,
  moneyChartYearViewOf,
  monthOf,
  previousMonth,
  yearCharts,
} from '@molvia/model'
import type { Actor, MoneyChartYearView, MoneyMonth } from '@molvia/model'
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
 * `GET /money/years/:year/charts` (MOL-160): «Графики → Год». **Every month of the year is counted
 * as `GET /money/months/:month` counts it** — the same rows, the same rate of the month, a closed one
 * frozen by this read as by opening it, as the charts of MOL-74 froze theirs (Р-2) — so a bar is the
 * month on «Деньгах» and the year is their sum. **The months of the usual before the year are counted
 * with no rate and never frozen** (Р-3 of MOL-158): the average needs only their sums in the spending
 * currency. A year still to come is no year to look at: 404, as a malformed one is.
 */
export async function moneyChartYearOf(
  repositories: Repositories,
  owner: Owner,
  year: string,
  now: Date = new Date(),
): Promise<MoneyChartYearView> {
  const today = todayOf(owner, now)
  const current = monthOf(today)
  if (`${year}-01` > current) throw new DomainError(ERROR.NOT_FOUND)
  const past = `${year}-12` < current
  const last = past ? `${year}-12` : current
  const months = chartMonths(last, Number(last.slice(5, 7)))
  // The usual's window ends with the year's last closed month (owner's decision В-1).
  const window = chartMonths(past ? last : previousMonth(current), USUAL_MONTHS)
  const before = window.filter((month) => month < `${year}-01`)

  const [rates, categories, salaryShiftDay, rows, firstSpent] = await Promise.all([
    dayRates(repositories, owner),
    repositories.spendingCategories.list(owner.id),
    repositories.money.salaryShift(owner.id),
    monthRows(repositories, owner, before[0] ?? `${year}-01`, last),
    repositories.money.firstSpentDay(owner.id),
  ])

  const counted: MoneyMonth[] = []
  try {
    // One month after another: a closed month's rate may be frozen by this very read.
    for (const month of months) {
      const { rate, kind } = await monthRate(repositories, owner, rates, month, today)
      counted.push(
        await countMonth(owner, rates, month, rows, categories, rate, kind, salaryShiftDay),
      )
    }
  } finally {
    await settleThaws(repositories, owner, rates.basis)
  }
  const usual: MoneyMonth[] = []
  for (const month of before) {
    usual.push(
      await countMonth(owner, rates, month, rows, categories, null, 'frozen', salaryShiftDay),
    )
  }
  // The first month of the whole history: what was spent first, or what came in first, as it counts.
  const firsts = [
    ...(firstSpent === null ? [] : [monthOf(firstSpent)]),
    ...rows.incomes.map((income) => budgetMonthOf(income, salaryShiftDay)),
  ].sort()

  return moneyChartYearViewOf(
    yearCharts({
      year,
      months: counted,
      before: usual,
      today,
      groceries: categories.find((category) => category.preset === TRIP_CATEGORY)?.id,
      categories: categoryOrder(categories).map((category) => ({
        id: category.id,
        archived: category.archivedAt !== null,
      })),
      firstMonth: firsts[0] ?? null,
    }),
    categories,
  )
}
