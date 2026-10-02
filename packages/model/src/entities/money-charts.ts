import { percentChange, previousMonth } from '#model/entities/money-month'
import type { MoneyMonth, Month } from '#model/entities/money-month'
import { divideRounded, INT8_MAX } from '#model/support/decimal'
import { nameIdentity } from '#model/support/search-key'
import type { Currency, Money } from '#model/values/money'

/** «Обмены против рынка» look back twelve months (handoff MOL-74 03, Р-13). */
export const EXCHANGE_LOSS_MONTHS = 12

/**
 * How tall a bar or a point is, in thousandths of the tallest the card shows — the server's to say,
 * so the phone divides nothing (CLAUDE.md): it only turns a level into a height.
 */
export const CHART_LEVEL = 1000

/**
 * How many categories a ring names at most (MOL-156, handoff MOL-157 03): past them the rest are one
 * sector, «Остальные». Seven names are all seven — an «Остальные» of one is a name hidden for nothing.
 */
export const DONUT_SECTORS = 6

/**
 * A sector of the ring: a category, or «Остальные» (`categoryId` null) with how many categories are
 * in it. `level` is thousandths of the whole ring, and the levels of a ring add up to exactly
 * `CHART_LEVEL`, so the phone turns them into angles and the ring closes.
 */
export interface DonutSlice {
  readonly categoryId: string | null
  readonly amount: Money
  readonly count: number
  readonly level: number
}

/**
 * The ring of a month's categories, in the order of `byCategory` — largest first, «Остальные» last.
 * The levels are shared out by the largest remainder, so no rounding opens a gap or overlaps.
 */
export function donutSlices(
  byCategory: readonly { readonly categoryId: string; readonly amount: Money }[],
): DonutSlice[] {
  const named =
    byCategory.length > DONUT_SECTORS + 1 ? byCategory.slice(0, DONUT_SECTORS) : byCategory
  const rest = byCategory.slice(named.length)
  const [first] = byCategory
  if (!first) return []
  const sectors: { categoryId: string | null; minor: bigint; count: number }[] = named.map(
    ({ categoryId, amount }) => ({ categoryId, minor: amount.minor, count: 1 }),
  )
  if (rest.length > 0) {
    const minor = rest.reduce((sum, { amount }) => sum + amount.minor, 0n)
    sectors.push({ categoryId: null, minor, count: rest.length })
  }
  const whole = sectors.reduce((sum, { minor }) => sum + minor, 0n)
  if (whole <= 0n) return sectors.map((sector) => sliceOf(sector, first.amount.currency, 0))

  const scaled = sectors.map(({ minor }) => minor * BigInt(CHART_LEVEL))
  const levels = scaled.map((value) => Number(value / whole))
  let left = CHART_LEVEL - levels.reduce((sum, level) => sum + level, 0)
  const byRemainder = scaled
    .map((value, index) => ({ index, remainder: value % whole }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    )
  for (const { index } of byRemainder) {
    if (left <= 0) break
    levels[index] = (levels[index] ?? 0) + 1
    left -= 1
  }
  return sectors.map((sector, index) => sliceOf(sector, first.amount.currency, levels[index] ?? 0))
}

function sliceOf(
  sector: { categoryId: string | null; minor: bigint; count: number },
  currency: Currency,
  level: number,
): DonutSlice {
  return {
    categoryId: sector.categoryId,
    amount: { minor: sector.minor, currency },
    count: sector.count,
    level,
  }
}

/** The months of a period, oldest first, ending with `current`. */
export function chartMonths(current: Month, count: number): Month[] {
  const months = [current]
  while (months.length < count) months.unshift(previousMonth(months[0] ?? current))
  return months
}

export function levelOf(minor: bigint, tallest: bigint): number {
  if (tallest <= 0n || minor <= 0n) return 0
  return Number(divideRounded(minor * BigInt(CHART_LEVEL), tallest))
}

export function tallestOf(values: readonly bigint[]): bigint {
  return values.reduce((most, value) => (value > most ? value : most), 0n)
}

/** A month has something to show: anything spent — counted or not — or anything that came in. */
export function holdsData(month: MoneyMonth): boolean {
  return month.days.length > 0 || month.income.minor > 0n || month.incomeUncounted.length > 0
}

/** The mean of whole minor units, rounded half away from zero, as every figure of «Деньги» is. */
export function meanOf(values: readonly bigint[], currency: Currency): Money | null {
  if (values.length === 0) return null
  const sum = values.reduce((total, value) => total + value, 0n)
  if (sum > INT8_MAX || sum < -INT8_MAX) return null
  return { minor: divideRounded(sum, BigInt(values.length)), currency }
}

/**
 * A change as the wire can carry it (adversarial d9 А): `percentChange` is a whole number of any
 * size — 0,01 ֏ in August and 10¹⁴ ֏ in September is ten thousand billion per cent — and one past
 * 2⁵³ took the whole screen down. Such a figure says nothing a person can use; it is left unsaid.
 */
export function changeOf(current: Money, previous: Money): number | null {
  const change = percentChange(current, previous)
  return change !== null && Number.isSafeInteger(change) ? change : null
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
