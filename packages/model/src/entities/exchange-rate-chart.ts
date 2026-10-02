import { CHART_LEVEL, hundredthsOf } from '#model/entities/money-charts'
import { divideRounded } from '#model/support/decimal'
import { currencySchema } from '#model/values/money'
import type { Currency } from '#model/values/money'
import { marketSideOf } from '#model/values/market-rates'
import type {
  ForeignCurrency,
  MarketChannel,
  MarketRate,
  MarketSide,
} from '#model/values/market-rates'
import { OFFICIAL_RATE_FRESH_DAYS, RATE_SCALE, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

/**
 * The row the line of «Курс рубля за 12 месяцев» is drawn by (MOL-161, Р-3): all bank clients, the
 * only one the central bank keeps a history of. People's cash and non-cash are collected from
 * 30.09.2026 only, and the exchange offices come a week at a time with no archive (MOL-137).
 */
export const RATE_CHART_CHANNEL = 'banksAll' satisfies MarketChannel

/** The smallest step of the axis: it prints two digits, and a finer one would print a tick twice. */
const MIN_STEP = RATE_SCALE / 100n

const DAY_MS = 24 * 60 * 60 * 1000

function dayAfter(day: string, days = 1): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function daysFrom(from: string, day: string): number {
  return Math.round((Date.parse(day) - Date.parse(from)) / DAY_MS)
}

/** A market figure beside an exchange, as the list of «Обмен денег» already carries it. */
interface QuoteInput {
  readonly basis: MarketChannel
  readonly rate: ExchangeRate
  readonly difference: { readonly minor: bigint }
}

/** An exchange as the list of «Обмен денег» carries it — the fields the chart reads. */
export interface RateChartExchangeInput {
  readonly id: string
  readonly exchangedOn: string
  readonly given: { readonly currency: Currency }
  readonly received: { readonly minor: bigint; readonly currency: Currency }
  readonly note: string | null
  readonly rate: ExchangeRate | null
  readonly market: { readonly best: QuoteInput; readonly own: QuoteInput | null } | null
  /**
   * The exchange as «Обмены против рынка» measures it — what it gave beyond the market and what the
   * market would have given, both in the spending currency — so a point's percent is the very
   * number of a place of one there, rounded from the same drams (adversarial В). Null: it is
   * «без сравнения» there, and the point has no percent.
   */
  readonly measured: { readonly difference: bigint; readonly expected: bigint } | null
}

/** One currency against the dram, and the bank's side its line is drawn on. */
export interface RateChartPairKey {
  readonly currency: ForeignCurrency
  readonly side: MarketSide
}

/**
 * The periods the chart offers, in months back from today (MOL-168, В-1 «б»): the last month, half a
 * year and the year — the window of «Обмены против рынка».
 */
export const RATE_CHART_MONTHS = [1, 6, 12] as const
export type RateChartMonths = (typeof RATE_CHART_MONTHS)[number]

/**
 * What a point of the line is (MOL-168, Р-3): a month by days — by weeks it is four or five points,
 * not a line — and half a year and a year by weeks, as the owner's sheet reads the pair.
 */
export type RateChartStep = 'day' | 'week'
export const RATE_CHART_STEP = { 1: 'day', 6: 'week', 12: 'week' } as const satisfies Record<
  RateChartMonths,
  RateChartStep
>

/** One period of a pair: its own steps, exchanges and axis, the scale of its own figures. */
export interface RateChartPeriod {
  readonly step: RateChartStep
  /** Every day or every week's end of the period, and today; `rate` null is a gap, never a zero. */
  readonly steps: readonly {
    readonly day: string
    readonly rate: ExchangeRate | null
    readonly x: number
    readonly level: number | null
  }[]
  /** The person's exchanges of the pair on the line's side, oldest first, each on its own day. */
  readonly exchanges: readonly {
    readonly id: string
    readonly day: string
    /** The step the exchange falls in: its own day, or the week it was made in. */
    readonly step: number
    readonly x: number
    readonly rate: ExchangeRate
    readonly level: number
    readonly place: string | null
    /** Hundredths of a percent against the market it was measured by; null — no market that day. */
    readonly percent: number | null
    /** That market (В-1): where the mark from the point ends. */
    readonly market: {
      readonly rate: ExchangeRate
      readonly level: number
      readonly basis: MarketChannel
    } | null
  }[]
  /** The ticks of the axis: three round values within the figures, or one. */
  readonly levels: readonly { readonly rate: ExchangeRate; readonly level: number }[]
}

export interface RateChartPair extends RateChartPairKey {
  /**
   * Each period by its months; null — no figure of the market in any of its steps, while the year
   * has one: the card stays with its controls and says so (Р-6). A pair with none in the year is
   * left out.
   */
  readonly periods: {
    readonly 1: RateChartPeriod | null
    readonly 6: RateChartPeriod | null
    readonly 12: RateChartPeriod
  }
}

export interface RateChart {
  readonly pairs: readonly RateChartPair[]
}

/**
 * The first day of the last `months` months (MOL-168, В-1 «б»): the day after the same day of the
 * month that many months back — the last day of a shorter month in its place — so the 2nd of October
 * looks back a month from the 3rd of September, and the 31st of March from the 1st. Taken from the
 * same day itself, with today, a month was a day longer than one: on the day of a monthly exchange
 * «Месяц» held the last one too, and «Обмены против рынка» summed thirteen exchanges for twelve
 * months, twelve the next day (adversarial В). The year is the window of «Обмены против рынка» too.
 */
export function ratePeriodFrom(today: string, months: number): string {
  const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - months
  const year = Math.floor(index / 12)
  const month = index - year * 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(Number(today.slice(8, 10)), last)
  return dayAfter(
    `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  )
}

/** The days the month is read on: every day from `from` to `today` (MOL-168, В-2 «а»). */
export function rateDays(from: string, today: string): string[] {
  const days: string[] = []
  for (let day = from; day <= today; day = dayAfter(day)) days.push(day)
  return days
}

/**
 * The days the line is read on: every Sunday from `from` to `today`, and today itself when it is
 * not one — the week's last figure, as the owner's sheet reads the pair weekly (Р-14 of MOL-74).
 */
export function rateWeeks(from: string, today: string): string[] {
  const days: string[] = []
  const weekday = new Date(`${from}T00:00:00.000Z`).getUTCDay()
  for (let day = dayAfter(from, (7 - weekday) % 7); day <= today; day = dayAfter(day, 7)) {
    days.push(day)
  }
  if (days.at(-1) !== today) days.push(today)
  return days
}

/**
 * A step's figure: the latest row dated no later than its end and fresh for it by the week a rate
 * stays fresh — the rule every comparison with the market reads by (Р-2 of MOL-137). None — a gap.
 * A day of the month takes it too (MOL-168, В-2 «а»): a Saturday is Friday's figure, the very one an
 * exchange of that Saturday is measured by — the bank publishes on working days only.
 */
export function stepRate(rows: readonly MarketRate[], end: string): MarketRate | null {
  const since = dayAfter(end, -OFFICIAL_RATE_FRESH_DAYS)
  let latest: MarketRate | null = null
  for (const row of rows) {
    if (row.date > end || row.date < since) continue
    if (!latest || row.date > latest.date) latest = row
  }
  return latest
}

/**
 * Which pairs the chart offers (Р-5), the currency of conversion first, and the side of each (В-2):
 * every currency changed against the dram in the window, on the side of its latest exchange — the
 * list comes newest first, so the first met of a day is the latest. With none, the currency of
 * conversion on the side of selling it, when it is not the dram: a newcomer sees the line alone.
 */
export function rateChartPairs(
  exchanges: readonly Pick<RateChartExchangeInput, 'exchangedOn' | 'given' | 'received'>[],
  from: string,
  today: string,
  income: Currency,
): RateChartPairKey[] {
  const sides = new Map<ForeignCurrency, { side: MarketSide; day: string }>()
  for (const exchange of exchanges) {
    if (exchange.exchangedOn < from || exchange.exchangedOn > today) continue
    const pair = marketSideOf(exchange.given.currency, exchange.received.currency)
    if (!pair) continue
    const held = sides.get(pair.currency)
    if (!held || exchange.exchangedOn > held.day) {
      sides.set(pair.currency, { side: pair.side, day: exchange.exchangedOn })
    }
  }
  if (sides.size === 0) return income === 'AMD' ? [] : [{ currency: income, side: 'bankBuys' }]
  const order = (currency: Currency) =>
    currency === income ? -1 : currencySchema.options.indexOf(currency)
  return [...sides.entries()]
    .sort(([one], [other]) => order(one) - order(other))
    .map(([currency, { side }]) => ({ currency, side }))
}

const STEP_DIGITS = [5n, 3n, 2n, 1n]

/**
 * The ticks of the axis (handoff 05, Р-8): three values a round step apart — one, two, three or
 * five of a power of ten, «0,30» for the rouble — each a multiple of that power, all three within
 * the figures, the widest step that fits. When none does, one tick near the middle.
 */
export function rateLevels(lowest: bigint, highest: bigint): bigint[] {
  const range = highest - lowest
  let power = MIN_STEP
  while (power * 10n <= range) power *= 10n
  for (; power >= MIN_STEP; power /= 10n) {
    for (const digit of STEP_DIGITS) {
      const step = digit * power
      if (step * 2n > range) continue
      const middle = divideRounded(lowest + highest, 2n * power) * power
      for (const centre of [middle, middle - power, middle + power]) {
        if (centre - step >= lowest && centre + step <= highest) {
          return [centre - step, centre, centre + step]
        }
      }
    }
  }
  return [divideRounded(lowest + highest, 2n * MIN_STEP) * MIN_STEP]
}

/** The narrowest scale, in hundredths of the middle figure (adversarial Г2). */
const SCALE_PERCENT = 1n

/**
 * The figures the card's height spans: the lowest to the highest, and no narrower than a hundredth
 * of their middle — and two steps of the axis — around it (adversarial Г2). Stretched over the
 * figures alone, a year of one rate with an exchange 0,07 % off it drew that 0,07 % the whole height
 * of the card; a year of the market spans ten percent and more, and is drawn as it is.
 */
export function rateScale(lowest: bigint, highest: bigint): [bigint, bigint] {
  const middle = (lowest + highest) / 2n
  const least = (middle * SCALE_PERCENT) / 100n
  const span = least > 2n * MIN_STEP ? least : 2n * MIN_STEP
  if (highest - lowest >= span) return [lowest, highest]
  const from = middle - span / 2n
  return [from, from + span]
}

/** A rate kept with the dram as its quote — drams per unit, the side every figure here is on. */
function inDrams(rate: ExchangeRate, currency: ForeignCurrency): bigint | null {
  if (rate.base === currency && rate.quote === 'AMD') return rate.scaled
  if (rate.base === 'AMD' && rate.quote === currency) {
    return divideRounded(RATE_SCALE * RATE_SCALE, rate.scaled)
  }
  return null
}

function drams(
  currency: ForeignCurrency,
  scaled: bigint,
  day: string,
  source: ExchangeRate['source'] = 'official',
): ExchangeRate {
  return { base: currency, quote: 'AMD', scaled, source, asOf: yerevanMidnight(day) }
}

/**
 * One period of a pair (MOL-161, MOL-168): the market at every step of the period, the person's
 * exchanges on it, each with its percent against the market it was measured by — its own channel
 * when named, else the best of its day, the very comparison of its card and of «Обмены против рынка»
 * (Р-4) — and the mark at that market (В-1). Exchanges of the other side are not drawn: their market
 * is another line (В-2). Heights and positions are thousandths of the period's own scale, the
 * server's to say. No figure in any step — null.
 */
function ratePeriod(
  currency: ForeignCurrency,
  side: MarketSide,
  onSide: readonly MarketRate[],
  exchanges: readonly RateChartExchangeInput[],
  from: string,
  today: string,
  step: RateChartStep,
): RateChartPeriod | null {
  const ends = step === 'day' ? rateDays(from, today) : rateWeeks(from, today)
  const span = Math.max(1, daysFrom(from, today))
  const xOf = (day: string) => Math.round((daysFrom(from, day) * CHART_LEVEL) / span)

  const steps = ends.map((day) => ({ day, row: stepRate(onSide, day) }))
  if (steps.every(({ row }) => row === null)) return null

  // The list comes newest first: turned, and sorted by the day alone — a stable sort — two
  // exchanges of one day stay in the order they were made, the latest last, as the pairs read it.
  const own = [...exchanges]
    .reverse()
    .flatMap((exchange) => {
      const pair = marketSideOf(exchange.given.currency, exchange.received.currency)
      const day = exchange.exchangedOn
      if (pair?.currency !== currency || pair.side !== side) return []
      if (day < from || day > today || !exchange.rate) return []
      const scaled = inDrams(exchange.rate, currency)
      if (scaled === null) return []
      const offered = exchange.market?.own ?? exchange.market?.best ?? null
      // A market that would have given nothing for the money is no market to draw a mark to.
      const expected = offered ? exchange.received.minor - offered.difference.minor : 0n
      const measure = expected > 0n ? offered : null
      const market = measure && inDrams(measure.rate, currency)
      const { measured } = exchange
      return [
        {
          exchange,
          scaled,
          market: measure && market !== null ? { scaled: market, measure } : null,
          percent:
            measured && measured.expected > 0n
              ? hundredthsOf(measured.difference, measured.expected)
              : null,
        },
      ]
    })
    .sort((one, other) =>
      one.exchange.exchangedOn === other.exchange.exchangedOn
        ? 0
        : one.exchange.exchangedOn < other.exchange.exchangedOn
          ? -1
          : 1,
    )

  const figures = [
    ...steps.flatMap(({ row }) => (row ? [row.scaled] : [])),
    ...own.flatMap((point) => [point.scaled, ...(point.market ? [point.market.scaled] : [])]),
  ]
  // The heights span the scale, never stretched to a tick: every tick lies within it — a single
  // one is rounded off the middle by half a step at most, and the scale is two steps wide.
  const [lowest, highest] = rateScale(
    figures.reduce((least, value) => (value < least ? value : least)),
    figures.reduce((most, value) => (value > most ? value : most)),
  )
  const ticks = rateLevels(lowest, highest)
  const levelAt = (scaled: bigint) =>
    Number(divideRounded((scaled - lowest) * BigInt(CHART_LEVEL), highest - lowest))

  return {
    step,
    steps: steps.map(({ day, row }) => ({
      day,
      rate: row && drams(currency, row.scaled, row.date),
      x: xOf(day),
      level: row && levelAt(row.scaled),
    })),
    exchanges: own.map(({ exchange, scaled, market, percent }) => ({
      id: exchange.id,
      day: exchange.exchangedOn,
      step: ends.findIndex((end) => end >= exchange.exchangedOn),
      x: xOf(exchange.exchangedOn),
      // The person's own, as the exchange's card says it.
      rate: drams(currency, scaled, exchange.exchangedOn, 'personal'),
      level: levelAt(scaled),
      // Named as «Обмены против рынка» names its place.
      place: exchange.note?.trim() ?? null,
      percent,
      market: market && {
        rate: market.measure.rate,
        level: levelAt(market.scaled),
        basis: market.measure.basis,
      },
    })),
    levels: ticks.map((scaled) => ({
      rate: drams(currency, scaled, today),
      level: levelAt(scaled),
    })),
  }
}

/**
 * «Курс рубля за месяц, 6 и 12 месяцев» (MOL-161, MOL-168): each pair in each period, all three in
 * one answer (Р-2) — a change of the period goes nowhere for an answer. The pairs and their sides
 * are the year's (Р-1), so a month with no exchange of a pair shows its line with no points. A pair
 * with no figure in any week of the year is left out; with none left, null — no card.
 */
export function rateChart(
  pairs: readonly (RateChartPairKey & { readonly rows: readonly MarketRate[] })[],
  exchanges: readonly RateChartExchangeInput[],
  today: string,
): RateChart | null {
  const drawn = pairs.flatMap(({ currency, side, rows }): RateChartPair[] => {
    const onSide = rows.filter(
      (row) => row.channel === RATE_CHART_CHANNEL && row.currency === currency && row.side === side,
    )
    const periodOf = (months: RateChartMonths) =>
      ratePeriod(
        currency,
        side,
        onSide,
        exchanges,
        ratePeriodFrom(today, months),
        today,
        RATE_CHART_STEP[months],
      )
    const year = periodOf(12)
    return year ? [{ currency, side, periods: { 1: periodOf(1), 6: periodOf(6), 12: year } }] : []
  })
  return drawn.length > 0 ? { pairs: drawn } : null
}
