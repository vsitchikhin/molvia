import {
  changeOf,
  DONUT_SECTORS,
  donutSlices,
  holdsData,
  levelOf,
  meanOf,
  tallestOf,
} from '#model/entities/money-charts'
import type { DonutSlice } from '#model/entities/money-charts'
import { categoryOfEntry, lastDayOf, monthOf, nextMonth } from '#model/entities/money-month'
import type { MoneyMonth, Month } from '#model/entities/money-month'
import { convertAcross } from '#model/entities/trip'
import type { Currency, Money } from '#model/values/money'

/**
 * How many closed months a «usual month» needs (handoff MOL-157 08, owner's decision В-2 of the
 * review): with one or two, an average is one odd month dressed as a habit, and the screen says
 * when the comparison comes instead.
 */
export const USUAL_MIN_CLOSED = 3

/**
 * How far back a «usual month» looks (MOL-158, owner's decision В-2): the closed months of the year
 * before the one shown — every season is in it, and a new rent is forgotten within a year.
 */
export const USUAL_MONTHS = 12

/** «Против обычного» names at most this many categories (handoff 03). */
export const DEVIATIONS_SHOWN = 5

/** A sector of the month's ring, with what it is in the income currency and who is in «Остальные». */
export interface MonthSlice extends DonutSlice {
  /** The sector by the month's rate — «25 % · ≈ 15 821 ₽»; null when the month has no rate. */
  readonly income: Money | null
  /** The categories of «Остальные», largest first; empty for a named sector. */
  readonly members: readonly string[]
}

/** A category against its usual month: «68 076 ֏ · обычно 13 900 ֏ · +390 %». */
export interface Deviation {
  readonly categoryId: string
  readonly amount: Money
  /** The usual sum; zero when the category was spent in no usual month — «новая». */
  readonly average: Money
  /** Whole percent against the usual; null when the usual is nothing — «новая». */
  readonly change: number | null
  /** Thousandths of the largest sum or usual of the card's rows — one scale for the card. */
  readonly level: number
  readonly averageLevel: number
}

export interface PaceDay {
  readonly day: string
  /** Spent from the first of the month to the end of this day. */
  readonly cumulative: Money
  /** The same by the month's rate; null when the month has none. */
  readonly income: Money | null
  /** Thousandths of the highest point of both lines. */
  readonly level: number
}

export interface PacePoint {
  readonly day: string
  readonly cumulative: Money
  readonly level: number
}

export interface MonthCharts {
  readonly month: Month
  /** The month is today's: compared with the usual month to the same day, not with a whole one. */
  readonly running: boolean
  readonly spendCurrency: Currency
  readonly incomeCurrency: Currency
  readonly spent: Money
  readonly spentIncome: Money | null
  readonly uncounted: readonly Money[]
  readonly slices: readonly MonthSlice[]
  /**
   * The closed months the usual is taken over — the first and the last, and how many; null while
   * there are fewer than `USUAL_MIN_CLOSED`, and then `usualFrom` says after which month it comes.
   */
  readonly usual: { readonly from: Month; readonly to: Month; readonly months: number } | null
  /** The closed months from the first with anything in it, oldest first — «закрыт только август». */
  readonly closed: readonly Month[]
  readonly usualFrom: Month | null
  readonly deviations: readonly Deviation[]
  readonly pace: { readonly days: readonly PaceDay[]; readonly usual: readonly PacePoint[] | null }
}

function lengthOf(month: Month): number {
  return Number(lastDayOf(month).slice(8, 10))
}

function dayOf(month: Month, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`
}

/**
 * The month's spending by day, added up from the first: `[0]` is nothing, `[d]` is everything to the
 * end of day `d` — in all and per category. Only what a rate counted, as every sum of the month.
 */
interface Running {
  readonly length: number
  readonly total: readonly bigint[]
  readonly byCategory: ReadonlyMap<string, readonly bigint[]>
}

function runningOf(month: MoneyMonth, groceries: string | undefined): Running {
  const length = lengthOf(month.month)
  const daily = Array.from({ length: length + 1 }, () => 0n)
  const byCategory = new Map<string, bigint[]>()
  for (const day of month.days) {
    const at = Number(day.day.slice(8, 10))
    for (const entry of day.entries) {
      if (entry.counted === null) continue
      daily[at] = (daily[at] ?? 0n) + entry.counted.minor
      const categoryId = categoryOfEntry(entry, groceries)
      if (categoryId === undefined) continue
      const list = byCategory.get(categoryId) ?? Array.from({ length: length + 1 }, () => 0n)
      list[at] = (list[at] ?? 0n) + entry.counted.minor
      byCategory.set(categoryId, list)
    }
  }
  const added = (list: readonly bigint[]) => {
    let sum = 0n
    return list.map((value) => (sum += value))
  }
  return {
    length,
    total: added(daily),
    byCategory: new Map([...byCategory].map(([id, list]) => [id, added(list)])),
  }
}

/** To the end of day `day`, or of the month when it is shorter — February has no 31st. */
function upTo(list: readonly bigint[] | undefined, length: number, day: number): bigint {
  return list?.[Math.min(day, length)] ?? 0n
}

export interface MonthChartsInput {
  readonly selected: MoneyMonth
  /** Months before the selected one, oldest first — `USUAL_MONTHS` of them; the open one is left out. */
  readonly before: readonly MoneyMonth[]
  readonly today: string
  /** The owner's «Продукты», where a trip's line is counted. */
  readonly groceries: string | undefined
  /** The owner's categories, archived ones marked — the order a tie falls back to (Р-11). */
  readonly categories: readonly { readonly id: string; readonly archived: boolean }[]
}

/**
 * «Графики → Месяц» (MOL-158, handoff MOL-157 03): the ring, «Против обычного» and «Темп месяца» of
 * one month, from months already counted by `moneyMonth` — the selected one exactly as «Деньги»
 * count it. Nothing is converted here but by the month's own rate, for «≈ в валюте дохода».
 *
 * **The usual month is the mean of the closed months before the selected one** (Р-5, Р-15 of
 * MOL-74), from the first with anything in it and at most `USUAL_MONTHS` back, and only from
 * `USUAL_MIN_CLOSED` of them; the running month is never in it. **The running month is compared to
 * the same day** (review В-3): on the 12th the usual is what the closed months had spent by their
 * 12th, never their whole. The day is today, or the last day spent on when it is later — a rent
 * dated the 15th (Р-6). A month short in a category is left out of that category's usual, a month
 * short in anything spent out of the usual line, as on «Графики» of MOL-74; the threshold counts
 * the calendar months all the same, so «после октября» is a date that holds (Р-4).
 */
export function monthCharts(input: MonthChartsInput): MonthCharts {
  const { selected, today, groceries } = input
  const spend = selected.spendCurrency
  const income = selected.incomeCurrency
  const current = monthOf(today)
  const running = selected.month === current

  const inIncome = (amount: Money): Money | null => {
    if (spend === income || amount.minor === 0n) return { minor: amount.minor, currency: income }
    return selected.rate ? convertAcross(amount, selected.rate) : null
  }

  const closed = input.before.filter(
    (month) => month.month < current && month.month < selected.month,
  )
  const since = [...closed, selected].find(holdsData)?.month ?? null
  const usedClosed = since === null ? [] : closed.filter((month) => month.month >= since)
  const enough = usedClosed.length >= USUAL_MIN_CLOSED
  let usualFrom = since ?? selected.month
  for (let step = 1; step < USUAL_MIN_CLOSED; step += 1) usualFrom = nextMonth(usualFrom)

  const mine = runningOf(selected, groceries)
  const lastSpent = selected.days.reduce(
    (latest, day) => Math.max(latest, Number(day.day.slice(8, 10))),
    0,
  )
  const shownTo = running ? Math.max(Number(today.slice(8, 10)), lastSpent) : mine.length
  // The day the closed months are read to: the same day for the running month, else each whole.
  const cutoff = running ? shownTo : Number.POSITIVE_INFINITY
  const others = usedClosed.map((month) => ({ month, running: runningOf(month, groceries) }))

  // The usual line leaves out a month short in anything spent; a mean past what money holds is no line.
  const whole = others.filter(({ month }) => month.uncounted.length === 0)
  const usualLine =
    enough && whole.length > 0
      ? Array.from({ length: mine.length }, (_, index) =>
          meanOf(
            whole.map(({ running: one }) => upTo(one.total, one.length, index + 1)),
            spend,
          ),
        )
      : null
  const usualKnown = usualLine?.every((point) => point !== null) ? usualLine : null

  const paceValues = mine.total.slice(1, shownTo + 1)
  const tallestPace = tallestOf([...paceValues, ...(usualKnown ?? []).map((point) => point.minor)])
  const pace = {
    days: paceValues.map((minor, index): PaceDay => {
      const cumulative = { minor, currency: spend }
      return {
        day: dayOf(selected.month, index + 1),
        cumulative,
        income: inIncome(cumulative),
        level: levelOf(minor, tallestPace),
      }
    }),
    usual:
      usualKnown?.map((point, index): PacePoint => ({
        day: dayOf(selected.month, index + 1),
        cumulative: point,
        level: levelOf(point.minor, tallestPace),
      })) ?? null,
  }

  const order = new Map(input.categories.map((category, index) => [category.id, index]))
  const archived = new Set(input.categories.filter((one) => one.archived).map((one) => one.id))
  const amountOf = (categoryId: string): bigint =>
    selected.byCategory.find((row) => row.categoryId === categoryId)?.amount.minor ?? 0n
  const averageOf = (categoryId: string): bigint | null => {
    const counted = others.filter(({ month }) => !month.uncountedIn.includes(categoryId))
    if (counted.length === 0) return null
    return (
      meanOf(
        counted.map(({ running: one }) => upTo(one.byCategory.get(categoryId), one.length, cutoff)),
        spend,
      )?.minor ?? null
    )
  }
  const candidates = enough
    ? [
        ...new Set([
          ...selected.byCategory.map((row) => row.categoryId),
          ...others.flatMap(({ running: one }) => [...one.byCategory.keys()]),
        ]),
      ]
    : []
  const rows = candidates
    .map((categoryId) => ({
      categoryId,
      amount: amountOf(categoryId),
      average: averageOf(categoryId) ?? 0n,
    }))
    // Nothing either way says nothing; a category put away and not spent on is not news (Р-5).
    .filter(({ categoryId, amount, average }) =>
      amount === 0n ? average > 0n && !archived.has(categoryId) : true,
    )
    .map((row) => ({
      ...row,
      gap: row.amount > row.average ? row.amount - row.average : row.average - row.amount,
    }))
    .sort((a, b) =>
      a.gap !== b.gap
        ? a.gap > b.gap
          ? -1
          : 1
        : (order.get(a.categoryId) ?? order.size) - (order.get(b.categoryId) ?? order.size) ||
          (a.categoryId < b.categoryId ? -1 : 1),
    )
    .slice(0, DEVIATIONS_SHOWN)
  const tallestRow = tallestOf(rows.flatMap(({ amount, average }) => [amount, average]))
  const deviations = rows.map(({ categoryId, amount, average }): Deviation => {
    const sum = { minor: amount, currency: spend }
    const usual = { minor: average, currency: spend }
    return {
      categoryId,
      amount: sum,
      average: usual,
      change: changeOf(sum, usual),
      level: levelOf(amount, tallestRow),
      averageLevel: levelOf(average, tallestRow),
    }
  })

  const rest = selected.byCategory.length > DONUT_SECTORS + 1 ? DONUT_SECTORS : null
  const slices = donutSlices(selected.byCategory).map((slice): MonthSlice => ({
    ...slice,
    income: inIncome(slice.amount),
    members:
      slice.categoryId === null && rest !== null
        ? selected.byCategory.slice(rest).map((row) => row.categoryId)
        : [],
  }))

  const first = usedClosed[0]
  const last = usedClosed.at(-1)
  return {
    month: selected.month,
    running,
    spendCurrency: spend,
    incomeCurrency: income,
    spent: selected.spent,
    spentIncome: selected.spentIncome,
    uncounted: selected.uncounted,
    slices,
    usual:
      enough && first && last
        ? { from: first.month, to: last.month, months: usedClosed.length }
        : null,
    usualFrom: enough ? null : usualFrom,
    closed: usedClosed.map((one) => one.month),
    deviations,
    pace,
  }
}
