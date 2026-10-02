import { USUAL_MIN_CLOSED, USUAL_MONTHS, runningOf, upTo } from '#model/entities/money-chart-month'
import type { MonthSlice, Running } from '#model/entities/money-chart-month'
import {
  changeOf,
  chartMonths,
  donutSlices,
  holdsData,
  levelOf,
  meanOf,
  tallestOf,
} from '#model/entities/money-charts'
import { monthOf, nextMonth, previousMonth } from '#model/entities/money-month'
import type { MoneyMonth, Month } from '#model/entities/money-month'
import { convertAcross } from '#model/entities/trip'
import { INT8_MAX } from '#model/support/decimal'
import type { Currency, Money } from '#model/values/money'

/**
 * What a month of the year is to the bars (handoff MOL-157 04): one with a bar, one before the
 * owner's first month with anything in it, or one still to come — the last two are a label with no
 * bar and nothing to choose, quiet months rather than zeros (Р-4).
 */
export type YearMonthKind = 'data' | 'before' | 'future'

export interface YearMonth {
  readonly month: Month
  readonly kind: YearMonthKind
  readonly spent: Money
  readonly uncounted: readonly Money[]
  readonly spentIncome: Money | null
  readonly income: Money
  readonly incomeUncounted: readonly Money[]
  /** «Разница» of MOL-74: null when either side is not whole. */
  readonly difference: Money | null
  /**
   * «+73 % к среднему»: a closed month against the average, the running one against the usual to the
   * same day (owner's decision В-2); null with no average or past what a number holds.
   */
  readonly change: number | null
  readonly spentLevel: number
  readonly incomeLevel: number
  readonly spentIncomeLevel: number | null
}

export interface YearCategoryPoint {
  readonly month: Month
  readonly amount: Money
  /** Against the category's average, the running month to the same day; null as `YearMonth`'s. */
  readonly change: number | null
  readonly level: number
}

export interface YearCategory {
  readonly categoryId: string
  readonly average: Money | null
  readonly averageLevel: number | null
  readonly points: readonly YearCategoryPoint[]
}

export interface YearCharts {
  readonly year: string
  /** The year is today's: it has a running month and months still to come. */
  readonly running: boolean
  readonly spendCurrency: Currency
  readonly incomeCurrency: Currency
  /** The months of the year with a bar — «2026 · 9 месяцев» (Р-5). */
  readonly monthsShown: number
  /** The year's spending; null past what money holds — no ring then, never a failed answer. */
  readonly spent: Money | null
  /** The months' «≈» added up, each by its own month's rate; null when one has none (Р-3). */
  readonly spentIncome: Money | null
  /**
   * Why the year has no «≈», said by the server (adversarial М′): `rate` — a month spent in has no
   * rate; `beyond` — the sum, or the sum of the months' «≈», is past what money holds. Null with one.
   */
  readonly spentIncomeMissing: 'rate' | 'beyond' | null
  readonly uncounted: readonly Money[]
  readonly slices: readonly MonthSlice[]
  /** Always twelve, January first. */
  readonly months: readonly YearMonth[]
  /**
   * The dashed line: the usual month of «Месяц» (owner's decision В-1) — the mean of the closed
   * months up to the year's last closed one, at most `USUAL_MONTHS`, from the first with anything in
   * it — and the months it is of; null below `USUAL_MIN_CLOSED`.
   */
  readonly average: {
    readonly amount: Money
    readonly level: number
    readonly from: Month
    readonly to: Month
    readonly months: number
  } | null
  /**
   * The first month with an average, while there is none — «Среднее появится после октября», the
   * month named being the one before it. That month is of this year and still to come, December
   * included, so the first may be January of the next (review 3); null otherwise, and the screen says
   * how many of the three there are instead (`closedCount`, Р-6).
   */
  readonly averageFrom: Month | null
  readonly closedCount: number
  /**
   * Why there is no average, said by the server and never guessed by the screen (adversarial З):
   * `few` — below three closed months; `uncounted` — three and more, each short in what was spent;
   * `beyond` — a sum past what money holds. Null when there is one.
   */
  readonly averageMissing: 'few' | 'uncounted' | 'beyond' | null
  /**
   * The day of the running month it is compared to the usual by: today, or the last day spent on when
   * it is later — a rent dated tomorrow (Р-6 of MOL-158). The screen names this day, never the phone's
   * (review 4). Null for a year with no running month.
   */
  readonly comparedTo: string | null
  /** What came in less what went out over the year; null when a month of it has no «Разница» (Р-7). */
  readonly differenceTotal: Money | null
  /** The months of the year with something and no «Разница» — what `differenceTotal` lacks. */
  readonly differenceMissing: readonly Month[]
  /** The owner's first month with anything in it, of the whole history; null — a newcomer (Р-9). */
  readonly firstMonth: Month | null
  readonly categories: readonly YearCategory[]
}

export interface YearChartsInput {
  readonly year: string
  /** The year's months from January to today's or December, counted as «Деньги» count them. */
  readonly months: readonly MoneyMonth[]
  /** Months before the year that the usual may reach, oldest first, counted with no rate (Р-2). */
  readonly before: readonly MoneyMonth[]
  readonly today: string
  readonly groceries: string | undefined
  /** The owner's categories in the order of the chips, archived ones marked (Р-8 of the review). */
  readonly categories: readonly { readonly id: string; readonly archived: boolean }[]
  readonly firstMonth: Month | null
}

/** A sum that money still holds, or null (adversarial d9 А of MOL-74: nothing may fail the answer). */
function held(sum: bigint): bigint | null {
  return sum > INT8_MAX || sum < -INT8_MAX ? null : sum
}

/** Amounts of one currency or several, added per currency; a sum past money starts another entry. */
function addedUp(amounts: readonly Money[]): Money[] {
  const sums: Money[] = []
  for (const amount of amounts) {
    const at = sums.findLastIndex((sum) => sum.currency === amount.currency)
    const sum = at === -1 ? null : held((sums[at]?.minor ?? 0n) + amount.minor)
    if (at === -1 || sum === null) sums.push(amount)
    else sums[at] = { minor: sum, currency: amount.currency }
  }
  return sums
}

const ZERO = (currency: Currency): Money => ({ minor: 0n, currency })

/**
 * «Графики → Год» (MOL-160, handoff MOL-157 04): the calendar year (owner's decision В-2 of MOL-155)
 * from months already counted by `moneyMonth`, each exactly as «Деньги» count it — so a bar is its
 * month there, and the year is the sum of its months, each by the rate of its own month (Р-3).
 *
 * **The average is the usual month of «Месяц»** (owner's decision В-1): the closed months up to the
 * year's last closed one — December of a past year, the month before today's in the running one —
 * at most `USUAL_MONTHS` back and from the first with anything in it, so January does not lose the
 * line every year, and only from `USUAL_MIN_CLOSED` of them (В-2 of the review of MOL-157). A month
 * short in anything spent leaves the average, one short in a category that category's, and neither
 * moves the threshold (Р-4 of MOL-158). **The running month is compared with the usual to the same
 * day** (owner's decision В-2), as on «Месяц»: on the 12th, against a whole month it is always «less».
 */
export function yearCharts(input: YearChartsInput): YearCharts {
  const { year, today, groceries } = input
  const current = monthOf(today)
  // January at least: a year still to come is no year to look at, and is refused before this.
  const january = input.months[0]
  if (!january) throw new Error('yearCharts needs the year to have begun')
  const spend = january.spendCurrency
  const income = january.incomeCurrency
  const counted = new Map([...input.before, ...input.months].map((month) => [month.month, month]))

  const calendar = Array.from(
    { length: 12 },
    (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`,
  )
  const kindOf = (month: Month): YearMonthKind => {
    const one = counted.get(month)
    if (month > current) return 'future'
    if (!one) return 'before'
    if (!holdsData(one) && (input.firstMonth === null || month < input.firstMonth)) return 'before'
    return 'data'
  }
  const kinds = calendar.map(kindOf)
  const shown = calendar.flatMap((month, index) => {
    const one = counted.get(month)
    return kinds[index] === 'data' && one ? [one] : []
  })

  // The usual's window: closed months up to the year's last closed one.
  const lastClosed = `${year}-12` < current ? `${year}-12` : previousMonth(current)
  const window = chartMonths(lastClosed, USUAL_MONTHS).flatMap((month) => {
    const one = counted.get(month)
    return one && month < current ? [one] : []
  })
  const since = window.find(holdsData)?.month ?? null
  const used = since === null ? [] : window.filter((month) => month.month >= since)
  const enough = used.length >= USUAL_MIN_CLOSED
  let from = since ?? input.firstMonth
  if (from !== null) for (let step = 0; step < USUAL_MIN_CLOSED; step += 1) from = nextMonth(from)
  // «после декабря» is a promise to this year too: its last closed month is December (review 3).
  const averageFrom =
    !enough &&
    from !== null &&
    from.length === 7 &&
    from > current &&
    previousMonth(from) <= `${year}-12`
      ? from
      : null

  // The running month is read to today, or to the last day spent on when it is later (Р-6 of MOL-158).
  const runningMonth = counted.get(current)
  const cutoff = runningMonth
    ? runningMonth.days.reduce(
        (latest, day) => Math.max(latest, Number(day.day.slice(8, 10))),
        Number(today.slice(8, 10)),
      )
    : 0
  const runs = new Map<Month, Running>(
    used.map((month) => [month.month, runningOf(month, groceries)]),
  )
  const toDay = (month: MoneyMonth, list: (run: Running) => readonly bigint[] | undefined) => {
    const run = runs.get(month.month)
    return run ? upTo(list(run), run.length, cutoff) : 0n
  }

  const spentWhole = used.filter((month) => month.uncounted.length === 0)
  const average = enough
    ? meanOf(
        spentWhole.map((month) => month.spent.minor),
        spend,
      )
    : null
  const usualToDay = enough
    ? meanOf(
        spentWhole.map((month) => toDay(month, (run) => run.total)),
        spend,
      )
    : null

  const wholeMonth = (month: MoneyMonth) =>
    month.uncounted.length === 0 && month.incomeUncounted.length === 0
  const differenceOf = (month: MoneyMonth): Money | null =>
    month.spentIncome === null || !wholeMonth(month)
      ? null
      : { minor: month.income.minor - month.spentIncome.minor, currency: income }
  // A sum not whole is compared with nothing (adversarial Д of MOL-158): «не посчитано» stands by it.
  const changeAgainst = (
    month: Month,
    amount: Money,
    whole: Money | null,
    sameDay: Money | null,
    short: boolean,
  ) =>
    short
      ? null
      : month === current
        ? sameDay && changeOf(amount, sameDay)
        : whole && changeOf(amount, whole)

  const spentTallest = tallestOf([...shown.map((month) => month.spent.minor), average?.minor ?? 0n])
  const flowTallest = tallestOf(
    shown.flatMap((month) => [month.income.minor, month.spentIncome?.minor ?? 0n]),
  )
  const months = calendar.map((month, index): YearMonth => {
    const one = counted.get(month)
    const kind = kinds[index] ?? 'future'
    if (kind !== 'data' || !one) {
      return {
        month,
        kind,
        spent: ZERO(spend),
        uncounted: [],
        spentIncome: null,
        income: ZERO(income),
        incomeUncounted: [],
        difference: null,
        change: null,
        spentLevel: 0,
        incomeLevel: 0,
        spentIncomeLevel: null,
      }
    }
    return {
      month,
      kind,
      spent: one.spent,
      uncounted: one.uncounted,
      spentIncome: one.spentIncome,
      income: one.income,
      incomeUncounted: one.incomeUncounted,
      difference: differenceOf(one),
      change: changeAgainst(month, one.spent, average, usualToDay, one.uncounted.length > 0),
      spentLevel: levelOf(one.spent.minor, spentTallest),
      incomeLevel: levelOf(one.income.minor, flowTallest),
      spentIncomeLevel:
        one.spentIncome === null ? null : levelOf(one.spentIncome.minor, flowTallest),
    }
  })

  // The ring: the year's categories, each the sum of its months, largest first.
  const order = new Map(input.categories.map((category, index) => [category.id, index]))
  const amountIn = (month: MoneyMonth | undefined, categoryId: string): bigint =>
    month?.byCategory.find((row) => row.categoryId === categoryId)?.amount.minor ?? 0n
  const yearOf = new Map<string, bigint>()
  for (const month of shown) {
    for (const row of month.byCategory) {
      yearOf.set(row.categoryId, (yearOf.get(row.categoryId) ?? 0n) + row.amount.minor)
    }
  }
  const byOrder = (a: { id: string; sum: bigint }, b: { id: string; sum: bigint }) =>
    a.sum !== b.sum
      ? a.sum > b.sum
        ? -1
        : 1
      : (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size) || (a.id < b.id ? -1 : 1)
  const ranked = [...yearOf].map(([id, sum]) => ({ id, sum })).sort(byOrder)
  const total = held(ranked.reduce((sum, row) => sum + row.sum, 0n))
  const spent = total === null ? null : { minor: total, currency: spend }

  /** What the categories came to in the income currency, each month by its own rate (Р-3). */
  const inIncome = (members: readonly string[]): Money | null => {
    let sum = 0n
    for (const month of shown) {
      const minor = members.reduce((all, id) => all + amountIn(month, id), 0n)
      if (minor === 0n) continue
      const amount = { minor, currency: spend }
      const converted =
        spend === income
          ? { minor, currency: income }
          : month.rate
            ? convertAcross(amount, month.rate)
            : null
      const next = converted && held(sum + converted.minor)
      if (next === null) return null
      sum = next
    }
    return { minor: sum, currency: income }
  }
  const slices =
    spent === null
      ? []
      : donutSlices(
          ranked.map((row) => ({
            categoryId: row.id,
            amount: { minor: row.sum, currency: spend },
          })),
        ).map((slice): MonthSlice => {
          const members =
            slice.categoryId === null
              ? ranked.slice(-slice.count).map((row) => row.id)
              : [slice.categoryId]
          return {
            ...slice,
            income: inIncome(members),
            members: slice.categoryId === null ? members : [],
          }
        })

  const spentIncomeSum = shown.every((month) => month.spentIncome !== null)
    ? held(shown.reduce((sum, month) => sum + (month.spentIncome?.minor ?? 0n), 0n))
    : null
  const differences = shown.map(differenceOf)
  const differenceMissing = shown
    .filter((_, index) => differences[index] === null)
    .map((month) => month.month)
  const differenceSum =
    shown.length > 0 && differenceMissing.length === 0
      ? held(differences.reduce((sum, one) => sum + (one?.minor ?? 0n), 0n))
      : null

  // «Категория по месяцам»: every live category and every one spent in the year (Р-8 of the review).
  const live = input.categories.filter((one) => !one.archived).map((one) => one.id)
  const offered = [...new Set([...ranked.map((row) => row.id), ...live])]
    .map((id) => ({ id, sum: yearOf.get(id) ?? 0n }))
    .sort(byOrder)
  const categories = offered.map(({ id }): YearCategory => {
    const counts = used.filter((month) => !month.uncountedIn.includes(id))
    const spentInWindow = counts.some((month) => amountIn(month, id) > 0n)
    const categoryAverage =
      enough && spentInWindow
        ? meanOf(
            counts.map((month) => amountIn(month, id)),
            spend,
          )
        : null
    const categoryToDay =
      enough && spentInWindow
        ? meanOf(
            counts.map((month) => toDay(month, (run) => run.byCategory.get(id))),
            spend,
          )
        : null
    const amounts = calendar.map((month, index) =>
      kinds[index] === 'data' ? amountIn(counted.get(month), id) : 0n,
    )
    const tallest = tallestOf([...amounts, categoryAverage?.minor ?? 0n])
    return {
      categoryId: id,
      average: categoryAverage,
      averageLevel: categoryAverage === null ? null : levelOf(categoryAverage.minor, tallest),
      points: calendar.map((month, index): YearCategoryPoint => {
        const amount = { minor: amounts[index] ?? 0n, currency: spend }
        return {
          month,
          amount,
          change:
            kinds[index] === 'data'
              ? changeAgainst(
                  month,
                  amount,
                  categoryAverage,
                  categoryToDay,
                  counted.get(month)?.uncountedIn.includes(id) ?? false,
                )
              : null,
          level: levelOf(amount.minor, tallest),
        }
      }),
    }
  })

  const first = used[0]
  const last = used.at(-1)
  return {
    year,
    running: current.slice(0, 4) === year,
    spendCurrency: spend,
    incomeCurrency: income,
    monthsShown: shown.length,
    spent,
    // The «≈» of no sum is no «≈» (adversarial И): «—» over «≈ 24 000 000 000 000 000 ₽» said two things.
    spentIncome:
      spent === null || spentIncomeSum === null
        ? null
        : { minor: spentIncomeSum, currency: income },
    spentIncomeMissing:
      spent !== null && spentIncomeSum !== null
        ? null
        : spent !== null && shown.some((month) => month.spentIncome === null)
          ? 'rate'
          : 'beyond',
    uncounted: addedUp(shown.flatMap((month) => month.uncounted)),
    slices,
    months,
    average:
      average && first && last
        ? {
            amount: average,
            level: levelOf(average.minor, spentTallest),
            from: first.month,
            to: last.month,
            months: used.length,
          }
        : null,
    averageFrom,
    averageMissing:
      average !== null ? null : !enough ? 'few' : spentWhole.length === 0 ? 'uncounted' : 'beyond',
    comparedTo:
      runningMonth && current.startsWith(year)
        ? `${current}-${String(cutoff).padStart(2, '0')}`
        : null,
    closedCount: used.length,
    differenceTotal: differenceSum === null ? null : { minor: differenceSum, currency: income },
    differenceMissing,
    firstMonth: input.firstMonth,
    categories,
  }
}
