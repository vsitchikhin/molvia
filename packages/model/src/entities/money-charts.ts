import { percentChange, previousMonth } from '#model/entities/money-month'
import type { MoneyMonth, Month } from '#model/entities/money-month'
import { divideRounded, INT8_MAX } from '#model/support/decimal'
import { nameIdentity } from '#model/support/search-key'
import type { Currency, Money } from '#model/values/money'
import { RATE_SCALE } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

/** «6 месяцев · 12 месяцев» (handoff 03): how many months the charts show, ending with this one. */
export const CHART_PERIODS = [6, 12] as const
export type ChartPeriod = (typeof CHART_PERIODS)[number]

/** The card of exchanges looks back twelve months whatever the period (handoff 03, Р-13). */
export const EXCHANGE_LOSS_MONTHS = 12

/**
 * How tall a bar or a point is, in thousandths of the tallest the card shows — the server's to say,
 * so the phone divides nothing (CLAUDE.md): it only turns a level into a height.
 */
export const CHART_LEVEL = 1000

/** The months of a period, oldest first, ending with `current`. */
export function chartMonths(current: Month, count: number): Month[] {
  const months = [current]
  while (months.length < count) months.unshift(previousMonth(months[0] ?? current))
  return months
}

function levelOf(minor: bigint, tallest: bigint): number {
  if (tallest <= 0n || minor <= 0n) return 0
  return Number(divideRounded(minor * BigInt(CHART_LEVEL), tallest))
}

function tallestOf(values: readonly bigint[]): bigint {
  return values.reduce((most, value) => (value > most ? value : most), 0n)
}

/** A month has something to show: anything spent — counted or not — or anything that came in. */
function holdsData(month: MoneyMonth): boolean {
  return month.days.length > 0 || month.income.minor > 0n || month.incomeUncounted.length > 0
}

/** The mean of whole minor units, rounded half away from zero, as every figure of «Деньги» is. */
function meanOf(values: readonly bigint[], currency: Currency): Money | null {
  if (values.length === 0) return null
  const sum = values.reduce((total, value) => total + value, 0n)
  if (sum > INT8_MAX || sum < -INT8_MAX) return null
  return { minor: divideRounded(sum, BigInt(values.length)), currency }
}

export interface ChartMonth {
  readonly month: Month
  readonly spent: Money
  /** What had no rate to the spending currency on its day — «не посчитано» under the figure. */
  readonly uncounted: readonly Money[]
  readonly spentIncome: Money | null
  readonly income: Money
  readonly incomeUncounted: readonly Money[]
  /**
   * «Разница» (owner's decision В-2): what came in less what went out, both in the income currency;
   * null when either side is not whole — no rate of the month, or anything «не посчитано».
   */
  readonly difference: Money | null
  /** «−8 % к августу»: null when the month before spent nothing, or past what a number holds. */
  readonly change: number | null
  readonly spentLevel: number
  readonly incomeLevel: number
  readonly spentIncomeLevel: number | null
}

export interface CategorySeries {
  readonly categoryId: string
  readonly average: Money | null
  readonly averageLevel: number | null
  readonly points: readonly {
    readonly month: Month
    readonly amount: Money
    readonly change: number | null
    readonly level: number
  }[]
}

export interface MoneyCharts {
  readonly spendCurrency: Currency
  readonly incomeCurrency: Currency
  readonly months: readonly ChartMonth[]
  /**
   * The first month of the period with anything in it, or null when there is none: the screen's
   * «Графики появятся с первыми тратами», and where every average starts (Р-5).
   */
  readonly since: Month | null
  readonly spentAverage: Money | null
  readonly differenceAverage: Money | null
  readonly categories: readonly CategorySeries[]
}

/**
 * A change as the wire can carry it (adversarial d9 А): `percentChange` is a whole number of any
 * size — 0,01 ֏ in August and 10¹⁴ ֏ in September is ten thousand billion per cent — and one past
 * 2⁵³ took the whole screen down. Such a figure says nothing a person can use; it is left unsaid.
 */
function changeOf(current: Money, previous: Money): number | null {
  const change = percentChange(current, previous)
  return change !== null && Number.isSafeInteger(change) ? change : null
}

/** Nothing spent in the month is «не посчитано»: its spending, and each category's, may be averaged. */
function spentWhole(month: MoneyMonth): boolean {
  return month.uncounted.length === 0
}

/** Nothing of the month is «не посчитано»: «Разница» of it is the whole month's. */
function whole(month: MoneyMonth): boolean {
  return spentWhole(month) && month.incomeUncounted.length === 0
}

/**
 * The months of «Графики» side by side (MOL-74), from months already counted by `moneyMonth` — the
 * very figures «Деньги» shows for each (requirements 4): nothing here is converted or counted anew,
 * only laid out. `before` is the month before the first, there only for the first bar's «к августу».
 *
 * **An average is of the closed months from the first with anything in it** (Р-5, Р-15): a person
 * who started in August is not averaged over four empty months, and the running month, half spent,
 * is not an average's month. With no closed month to average there is no average. **A month with
 * anything «не посчитано» has no «Разница» and is not in its average** (adversarial d9 В): a salary in
 * dollars on a day with no dollar made the month «−25 000 ₽» and dragged the average under zero. **Its
 * spending is averaged unless the spending itself is short** (review С-8, d9 round 2 В2): an income
 * does not change what was spent. A category spent nowhere in the period has no average.
 *
 * `categories` are the owner's to offer besides those spent in the period (adversarial А, d9 Г): a
 * category tapped on an older month of «Деньги» is drawn as its months of nothing, never swapped for
 * another. Spent ones come first, largest first; the rest in the order given.
 */
export function moneyCharts(
  months: readonly MoneyMonth[],
  before: MoneyMonth,
  categories: readonly string[] = [],
): MoneyCharts {
  const first = months[0]
  const last = months.at(-1)
  if (!first || !last) throw new Error('moneyCharts needs at least one month')
  const spend = last.spendCurrency
  const income = last.incomeCurrency

  const sinceIndex = months.findIndex(holdsData)
  const since = sinceIndex === -1 ? null : (months[sinceIndex]?.month ?? null)
  // The running month is the last of a period; the ones before it are closed.
  const closed = sinceIndex === -1 ? [] : months.slice(sinceIndex, -1)
  const spentAveraged = closed.filter(spentWhole)
  const averaged = closed.filter(whole)

  const spentTallest = tallestOf(months.map((month) => month.spent.minor))
  const flowTallest = tallestOf(
    months.flatMap((month) => [month.income.minor, month.spentIncome?.minor ?? 0n]),
  )
  const differenceOf = (month: MoneyMonth): Money | null =>
    month.spentIncome === null || !whole(month)
      ? null
      : { minor: month.income.minor - month.spentIncome.minor, currency: income }

  const chartMonthsOf = months.map((month, index): ChartMonth => {
    const previous = index === 0 ? before : months[index - 1]
    return {
      month: month.month,
      spent: month.spent,
      uncounted: month.uncounted,
      spentIncome: month.spentIncome,
      income: month.income,
      incomeUncounted: month.incomeUncounted,
      difference: differenceOf(month),
      change: previous ? changeOf(month.spent, previous.spent) : null,
      spentLevel: levelOf(month.spent.minor, spentTallest),
      incomeLevel: levelOf(month.income.minor, flowTallest),
      spentIncomeLevel:
        month.spentIncome === null ? null : levelOf(month.spentIncome.minor, flowTallest),
    }
  })

  const amountIn = (month: MoneyMonth | undefined, categoryId: string): Money => ({
    minor: month?.byCategory.find((row) => row.categoryId === categoryId)?.amount.minor ?? 0n,
    currency: spend,
  })
  const spentIds = new Set(months.flatMap((month) => month.byCategory.map((row) => row.categoryId)))
  const categoryIds = [...new Set([...spentIds, ...categories])]
  // The sum of a category over the period orders the series and goes nowhere else: bigint, since
  // twelve months of one category may be more than money holds (adversarial d9 А).
  const totalOf = (categoryId: string) =>
    months.reduce((sum, month) => sum + amountIn(month, categoryId).minor, 0n)
  const orderOf = (categoryId: string) => {
    const given = categories.indexOf(categoryId)
    return given === -1 ? categories.length : given
  }
  const series = categoryIds
    .map((categoryId): CategorySeries => {
      const amounts = months.map((month) => amountIn(month, categoryId))
      const spent = amounts.some(({ minor }) => minor > 0n)
      const average = spent
        ? meanOf(
            spentAveraged.map((month) => amountIn(month, categoryId).minor),
            spend,
          )
        : null
      const tallest = tallestOf([...amounts.map(({ minor }) => minor), average?.minor ?? 0n])
      return {
        categoryId,
        average,
        averageLevel: average === null ? null : levelOf(average.minor, tallest),
        points: amounts.map((amount, index) => ({
          month: months[index]?.month ?? '',
          amount,
          change: changeOf(amount, amountIn(index === 0 ? before : months[index - 1], categoryId)),
          level: levelOf(amount.minor, tallest),
        })),
      }
    })
    .map((one) => ({ one, total: totalOf(one.categoryId), order: orderOf(one.categoryId) }))
    .sort((a, b) =>
      a.total !== b.total
        ? a.total > b.total
          ? -1
          : 1
        : a.order !== b.order
          ? a.order - b.order
          : a.one.categoryId < b.one.categoryId
            ? -1
            : 1,
    )
    .map(({ one }) => one)

  const differences = averaged.map(differenceOf)
  return {
    spendCurrency: spend,
    incomeCurrency: income,
    months: chartMonthsOf,
    since,
    spentAverage: meanOf(
      spentAveraged.map((month) => month.spent.minor),
      spend,
    ),
    // A month with anything not converted leaves the average rather than counting as nothing.
    differenceAverage: meanOf(
      differences.filter((difference) => difference !== null).map(({ minor }) => minor),
      income,
    ),
    categories: series,
  }
}

/** One exchange as the card of losses needs it: already measured and converted by the server. */
export interface ExchangeLossInput {
  readonly note: string | null
  readonly exchangedOn: string
  /**
   * How much more — below zero, less — the exchange gave than the central bank of its day, and what
   * the bank would have given, both in the spending currency; null when either is not known — no
   * comparison, or no rate of that day to the spending currency (Р-6).
   */
  readonly difference: Money | null
  readonly expected: Money | null
}

export interface ExchangeLossGroup {
  /** The place as the newest exchange of the group wrote it; null — «Без места». */
  readonly place: string | null
  readonly count: number
  readonly difference: Money
  /** Weighted by what was exchanged (Р-7), in hundredths of a percent: −721 is «−7,21 %». */
  readonly percent: number
  /** The length of its bar from the centre line, signed, in thousandths of the widest (handoff 03). */
  readonly level: number
}

export interface ExchangeLosses {
  readonly total: Money
  readonly groups: readonly ExchangeLossGroup[]
  /** Exchanges of the twelve months that could not be measured or converted — named, never summed. */
  readonly uncounted: number
}

function hundredthsOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0
  return Number(divideRounded(part * 10_000n, whole))
}

/**
 * «Обмены против курса ЦБ РА» by exchanger (owner's decision В-1): the exchanges grouped by where
 * they were made — «Где и заметка» read as `nameIdentity` reads a name, so «Аэропорт», « аэропорт »
 * and one with an invisible mark are one place — each with its count, its difference and its
 * percent weighted by the money: ten dollars with friends do not weigh what eight hundred at the
 * airport do (Р-7). Worst first. Null when there is nothing measured to show — no card at all.
 */
export function exchangeLosses(
  exchanges: readonly ExchangeLossInput[],
  currency: Currency,
): ExchangeLosses | null {
  const groups = new Map<
    string,
    { place: string | null; newest: string; count: number; difference: bigint; expected: bigint }
  >()
  let uncounted = 0
  let total = 0n
  for (const exchange of exchanges) {
    const { difference, expected } = exchange
    if (difference === null || expected === null || expected.minor <= 0n) {
      uncounted += 1
      continue
    }
    const place = exchange.note === null ? '' : nameIdentity(exchange.note)
    const held = groups.get(place)
    const sum = total + difference.minor
    if (sum > INT8_MAX || sum < -INT8_MAX || (held?.expected ?? 0n) + expected.minor > INT8_MAX) {
      uncounted += 1
      continue
    }
    total = sum
    const written = exchange.note?.trim() ?? null
    groups.set(
      place,
      held
        ? {
            // The group is named as its newest exchange wrote the place.
            ...(exchange.exchangedOn >= held.newest
              ? { place: written, newest: exchange.exchangedOn }
              : { place: held.place, newest: held.newest }),
            count: held.count + 1,
            difference: held.difference + difference.minor,
            expected: held.expected + expected.minor,
          }
        : {
            place: written,
            newest: exchange.exchangedOn,
            count: 1,
            difference: difference.minor,
            expected: expected.minor,
          },
    )
  }
  if (groups.size === 0) return null

  const measured = [...groups.values()].map((group) => ({
    ...group,
    percent: hundredthsOf(group.difference, group.expected),
  }))
  const widest = measured.reduce((most, { percent }) => Math.max(most, Math.abs(percent)), 0)
  return {
    total: { minor: total, currency },
    uncounted,
    groups: measured
      .sort((a, b) =>
        a.percent !== b.percent
          ? a.percent - b.percent
          : a.difference !== b.difference
            ? a.difference < b.difference
              ? -1
              : 1
            : (a.place ?? '') < (b.place ?? '')
              ? -1
              : 1,
      )
      .map((group) => ({
        place: group.place,
        count: group.count,
        difference: { minor: group.difference, currency },
        percent: group.percent,
        level: widest === 0 ? 0 : Math.round((group.percent * CHART_LEVEL) / widest),
      })),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function dayAfter(day: string, days = 1): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The days a line of the rate is read on (Р-14): every Sunday from `from` to `today`, and today
 * itself when it is not one — the week's last rate, as the owner's sheet reads the pair weekly.
 */
export function weekEnds(from: string, today: string): string[] {
  const days: string[] = []
  const weekday = new Date(`${from}T00:00:00.000Z`).getUTCDay()
  for (let day = dayAfter(from, (7 - weekday) % 7); day <= today; day = dayAfter(day, 7)) {
    days.push(day)
  }
  if (days.at(-1) !== today) days.push(today)
  return days
}

export interface RateLinePoint {
  readonly day: string
  /** The rate on the line's side — `per` one unit, so many of `of`; null — a gap, never a zero. */
  readonly rate: ExchangeRate | null
  readonly level: number | null
}

export interface RateLine {
  readonly points: readonly RateLinePoint[]
  /** The person's own exchanges of the pair, either way, on the line's side, at their week. */
  readonly exchanges: readonly {
    readonly day: string
    readonly week: number
    readonly rate: ExchangeRate
    readonly level: number
  }[]
}

/** The rate turned to `per → of`, from its own six digits when it is kept the other way. */
function sideOf(rate: ExchangeRate, per: Currency, of: Currency): ExchangeRate | null {
  if (rate.base === per && rate.quote === of) return rate
  if (rate.base === of && rate.quote === per) {
    return {
      ...rate,
      base: per,
      quote: of,
      scaled: divideRounded(RATE_SCALE * RATE_SCALE, rate.scaled),
    }
  }
  return null
}

/**
 * «Курс ₽ и ֏» (owner's decision В-4, Р-14): the central bank's rate of the pair at the end of each
 * week, and the person's own exchanges of the pair as points on it. One side for the whole line —
 * the one the newest known rate reads at least one on (MOL-81) — and the heights between the lowest
 * and the highest the card shows, points included, so a point is never off the card. Null when
 * there is nothing to draw: no rate known in the period and no exchange of the pair.
 */
export function rateLine(
  weeks: readonly { readonly day: string; readonly rate: ExchangeRate | null }[],
  exchanges: readonly { readonly day: string; readonly rate: ExchangeRate }[],
): RateLine | null {
  const newest =
    [...weeks].reverse().find((week) => week.rate !== null)?.rate ?? exchanges.at(-1)?.rate
  if (!newest) return null
  const [per, of] =
    newest.scaled >= RATE_SCALE ? [newest.base, newest.quote] : [newest.quote, newest.base]

  const points = weeks.map((week) => ({
    day: week.day,
    rate: week.rate && sideOf(week.rate, per, of),
  }))
  // Which exchanges are of the period is the caller's to say; each goes on the week it falls in.
  const own = exchanges.flatMap((exchange) => {
    const rate = sideOf(exchange.rate, per, of)
    const week = weeks.findIndex((one) => one.day >= exchange.day)
    return rate && week !== -1 ? [{ day: exchange.day, week, rate }] : []
  })
  const values = [
    ...points.flatMap((point) => (point.rate ? [point.rate.scaled] : [])),
    ...own.map((exchange) => exchange.rate.scaled),
  ]
  if (values.length === 0) return null
  const lowest = values.reduce((least, value) => (value < least ? value : least))
  const highest = values.reduce((most, value) => (value > most ? value : most))
  const levelAt = (scaled: bigint) =>
    highest === lowest
      ? CHART_LEVEL / 2
      : Number(divideRounded((scaled - lowest) * BigInt(CHART_LEVEL), highest - lowest))

  return {
    points: points.map((point) => ({
      day: point.day,
      rate: point.rate,
      level: point.rate ? levelAt(point.rate.scaled) : null,
    })),
    exchanges: own.map((exchange) => ({ ...exchange, level: levelAt(exchange.rate.scaled) })),
  }
}
