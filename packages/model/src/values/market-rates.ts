import { z } from 'zod'
import type { Currency } from './money'
import { exchangeRateSchema, isRateFresh, yerevanMidnight } from './rates'
import type { ExchangeRate } from './rates'

/**
 * Where the central bank's statistics say money changed hands with clients (MOL-137): banks with
 * people, in cash and not; banks with every client, people and companies alike; exchange offices.
 * Weighted averages of a day's deals — not a rate anybody offers, and never one a trip or a month
 * counts by: the market is only what an exchange is set beside.
 */
export const marketChannelSchema = z.enum(['bankCash', 'bankNoncash', 'banksAll', 'exchanger'])
export type MarketChannel = z.infer<typeof marketChannelSchema>

/**
 * How a person says they exchanged (MOL-137, В-1) — optional. `banksAll` is nobody's own: it only
 * stands in for the non-cash row on days before that row was collected (В-2).
 */
export const exchangeChannelSchema = z.enum(['bankCash', 'bankNoncash', 'exchanger'])
export type ExchangeChannel = z.infer<typeof exchangeChannelSchema>

/**
 * Which side of the counter a rate is, **as the bank says it** — the words of the files, «Buying»
 * and «Selling». `bankBuys` is the rate at which the bank buys the currency: the person sells it
 * and gets drams. The two are easy to swap, so the one place that turns an exchange into a side is
 * `marketSideOf` (Р-1).
 */
export const marketSideSchema = z.enum(['bankBuys', 'bankSells'])
export type MarketSide = z.infer<typeof marketSideSchema>

export type ForeignCurrency = Exclude<Currency, 'AMD'>

/**
 * The currencies the central bank's files of the market carry (MOL-137): the dollar, the euro and
 * the rouble, and «Other» as a sum without a rate. Not every foreign currency — the lari is in none
 * of the three files (MOL-110), so an exchange of lari for drams has no market and says so, and a
 * reader that asked the files for every currency of the product would refuse them all.
 */
export const MARKET_CURRENCIES = ['RUB', 'USD', 'EUR'] as const satisfies readonly ForeignCurrency[]
export type MarketCurrency = (typeof MARKET_CURRENCIES)[number]

/** One published figure: drams per unit of `currency`, on `date`, on one side of one channel. */
export interface MarketRate {
  readonly channel: MarketChannel
  readonly currency: ForeignCurrency
  readonly date: string
  readonly side: MarketSide
  readonly scaled: bigint
}

/**
 * The currency an exchange sold or bought against the dram, and the bank's side of it: given
 * roubles for drams, the bank bought roubles. A pair without the dram has no market (В-4): the
 * files know every currency against the dram only, and roubles into dollars may have been changed
 * in Russia, where the Armenian market says nothing.
 */
export function marketSideOf(
  given: Currency,
  received: Currency,
): { currency: ForeignCurrency; side: MarketSide } | null {
  if (given !== 'AMD' && received === 'AMD') return { currency: given, side: 'bankBuys' }
  if (given === 'AMD' && received !== 'AMD') return { currency: received, side: 'bankSells' }
  return null
}

/** One channel's figure for a day, and which row it came from. */
export interface MarketQuote {
  readonly channel: ExchangeChannel
  /** The row the figure is: the channel itself, or `banksAll` standing in for non-cash (В-2). */
  readonly basis: MarketChannel
  readonly date: string
  readonly scaled: bigint
}

function latestRow(
  rows: readonly MarketRate[],
  channel: MarketChannel,
  currency: ForeignCurrency,
  side: MarketSide,
  day: string | null,
): MarketRate | null {
  return rows.reduce<MarketRate | null>((latest, row) => {
    if (row.channel !== channel || row.currency !== currency || row.side !== side) return latest
    if (day !== null && (row.date > day || !isRateFresh(row.date, day))) return latest
    // Exchange offices publish every day, weekends too: a row of another day is not that day's
    // market, and the week before is exactly what the late file holds (review, major 1).
    if (day !== null && channel === 'exchanger' && row.date !== day) return latest
    return latest === null || row.date > latest.date ? row : latest
  }, null)
}

/**
 * What each channel a person can name gave on `day`, or on the latest day before it within the week
 * a rate stays fresh (Р-2) — the rule of the official rate, so the two stand under one date; the
 * exchange offices, which publish every day, only on that day itself. With
 * `day` null, simply each channel's latest, of any age — what the block of today's rates shows,
 * with the date beside each. The non-cash row missing — every day before its collection began — is
 * taken from the row of all bank clients, which runs within a tenth of a percent of it; the cash
 * row and the exchange offices have no stand-in, since that row runs two and a half percent off the
 * cash one for the rouble (В-2).
 */
export function marketQuotesOn(
  rows: readonly MarketRate[],
  currency: ForeignCurrency,
  side: MarketSide,
  day: string | null,
): MarketQuote[] {
  return exchangeChannelSchema.options.flatMap((channel): MarketQuote[] => {
    const own = latestRow(rows, channel, currency, side, day)
    const row =
      own ?? (channel === 'bankNoncash' ? latestRow(rows, 'banksAll', currency, side, day) : null)
    return row ? [{ channel, basis: row.channel, date: row.date, scaled: row.scaled }] : []
  })
}

/**
 * Each channel's latest figures for the block of today (MOL-137, В-1): of any age, dated — but a
 * non-cash row over a week old gives way to all bank clients fresh today, as a day's comparison
 * would (review, minor 4).
 */
export function marketQuotesToday(
  rows: readonly MarketRate[],
  currency: ForeignCurrency,
  side: MarketSide,
  today: string,
): MarketQuote[] {
  const standIn = latestRow(rows, 'banksAll', currency, side, today)
  return marketQuotesOn(rows, currency, side, null).map((quote) =>
    quote.channel === 'bankNoncash' && !isRateFresh(quote.date, today) && standIn
      ? {
          channel: quote.channel,
          basis: standIn.channel,
          date: standIn.date,
          scaled: standIn.scaled,
        }
      : quote,
  )
}

/** How far back the exchange offices can still come: the file runs some ten days late. */
export const EXCHANGERS_LAG_DAYS = 21

/**
 * The best figure for the person (owner's decision В-1): the highest when the bank buys — more
 * drams for what was sold — and the lowest when it sells — fewer drams for what was bought. A tie
 * goes to the channel named first.
 */
export function bestQuote(quotes: readonly MarketQuote[], side: MarketSide): MarketQuote | null {
  return quotes.reduce<MarketQuote | null>((best, quote) => {
    if (best === null) return quote
    const better = side === 'bankBuys' ? quote.scaled > best.scaled : quote.scaled < best.scaled
    return better ? quote : best
  }, null)
}

/**
 * Whether the exchange offices of `day` are still to come: they reach the central bank's file about
 * ten days late, a week at a time (В-3). Not once the file has passed that day — the day then simply
 * has no row — and, before the first week was ever read, only for a day recent enough to be in a
 * file still to come: the file never carries old weeks (review, minor 8).
 */
export function exchangersPending(
  quotes: readonly MarketQuote[],
  exchangersThrough: string | null,
  day: string,
  today: string,
): boolean {
  if (quotes.some((quote) => quote.channel === 'exchanger')) return false
  if (exchangersThrough !== null) return exchangersThrough < day
  return Date.parse(today) - Date.parse(day) <= EXCHANGERS_LAG_DAYS * 24 * 60 * 60 * 1000
}

/**
 * A market figure as a rate of the currency in drams, so that it is measured and printed as every
 * other rate is. `source` is `official`: it is the central bank's own statistics, not a person's.
 */
export function marketRateOf(quote: MarketQuote, currency: ForeignCurrency): ExchangeRate | null {
  const rate = {
    base: currency,
    quote: 'AMD' as const,
    scaled: quote.scaled,
    source: 'official' as const,
    asOf: yerevanMidnight(quote.date),
  }
  return exchangeRateSchema.safeParse(rate).success ? rate : null
}

/**
 * How many times away from the official rate of its day a market figure may stand before it is
 * misread (Р-7, as revised by the adversarial review А). Fifteen percent was the first bound, and
 * the central bank's own file refuted it: on 3 March 2022 banks sold roubles 27.5 % above the
 * official rate, and with the history since 2022 in the cache the daily file was refused every hour
 * for good. A market in a crisis is still within a factor of two; what the bound is for is not —
 * a volume or a sum in drams read for a rate is thousands of times away, a rate per ten or a hundred
 * units is ten or a hundred.
 */
export const MARKET_BAND_FACTOR = 2n

/** Whether a market figure is where a market figure can be: within a factor of two of the official. */
export function isMarketPlausible(scaled: bigint, official: bigint): boolean {
  return scaled * MARKET_BAND_FACTOR >= official && scaled <= official * MARKET_BAND_FACTOR
}
