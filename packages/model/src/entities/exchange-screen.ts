import { inDrams } from '#model/entities/exchange-rate-chart'
import { CHART_LEVEL, hundredthsOf, levelOf } from '#model/entities/money-charts'
import { divideRounded } from '#model/support/decimal'
import type { Money } from '#model/values/money'
import type { ExchangeChannel, ForeignCurrency } from '#model/values/market-rates'
import { RATE_SCALE } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

/**
 * The figures of the screen «Обмен денег» drawn anew in MOL-348 — a bar per exchange, a dot on the
 * track of each currency's rates, the line «мой — ЦБ РА» — where every height, position and order
 * is the server's, as on the line of the rate (MOL-161): the phone compares no rates.
 */

export type MoneySign = -1 | 0 | 1

function signOf(minor: bigint): MoneySign {
  return minor < 0n ? -1 : minor > 0n ? 1 : 0
}

/** One exchange of the twelve months as «Обмены против рынка» measures it (`marketMeasuresOf`). */
export interface VsMarketBarInput {
  readonly id: string
  readonly exchangedOn: string
  readonly note: string | null
  /**
   * The difference its card sets beside the market, in the currency received — whose sign is the
   * tone (MOL-190: one sign a row, the money's) — or null with no market.
   */
  readonly cardDifference: bigint | null
  /** The same in the spending currency, and what the market would have given — the sum's figures. */
  readonly difference: Money | null
  readonly expected: Money | null
}

export interface VsMarketBar {
  readonly id: string
  readonly exchangedOn: string
  readonly place: string | null
  /** In the spending currency; null — «без сравнения», in no sum. */
  readonly difference: Money | null
  /** Hundredths of a percent, as a place's: −721 is «−7,21 %». */
  readonly percent: number | null
  readonly sign: MoneySign | null
  /** Signed thousandths of the bar furthest from the line «как по рынку»; 0 — on the line. */
  readonly level: number
}

/**
 * A bar for every exchange of the twelve months, oldest first (MOL-348, handoff 02): up — more than
 * the market of its day gave, down — less, as tall as its drams against the furthest. Two of one day
 * stay in the order they were made: the list comes newest first, and a stable sort by day keeps it.
 * An exchange the sum leaves out is a bar «без сравнения» on the line, never one by the central bank.
 */
export function vsMarketBars(exchanges: readonly VsMarketBarInput[]): VsMarketBar[] {
  const measured = (one: VsMarketBarInput) =>
    one.difference !== null &&
    one.expected !== null &&
    one.expected.minor > 0n &&
    one.cardDifference !== null
  const furthest = exchanges.reduce((most, one) => {
    if (!measured(one) || one.difference === null) return most
    const minor = one.difference.minor < 0n ? -one.difference.minor : one.difference.minor
    return minor > most ? minor : most
  }, 0n)
  return [...exchanges]
    .reverse()
    .sort((a, b) => (a.exchangedOn < b.exchangedOn ? -1 : a.exchangedOn > b.exchangedOn ? 1 : 0))
    .map((one) => {
      const written = one.note?.trim() ?? ''
      const place = written === '' ? null : written
      const { difference, expected, cardDifference } = one
      if (!measured(one) || difference === null || expected === null || cardDifference === null) {
        return {
          id: one.id,
          exchangedOn: one.exchangedOn,
          place,
          difference: null,
          percent: null,
          sign: null,
          level: 0,
        }
      }
      const minor = difference.minor < 0n ? -difference.minor : difference.minor
      const level = levelOf(minor, furthest)
      return {
        id: one.id,
        exchangedOn: one.exchangedOn,
        place,
        difference,
        percent: hundredthsOf(difference.minor, expected.minor),
        sign: signOf(cardDifference),
        level: difference.minor < 0n ? -level : level,
      }
    })
}

/** One currency of «Курсы по данным ЦБ РА» as `marketTodayOf` gives it. */
export interface MarketTrackInput {
  readonly currency: ForeignCurrency
  readonly official: ExchangeRate | null
  readonly quotes: readonly {
    readonly channel: ExchangeChannel
    readonly buys: ExchangeRate | null
    readonly sells: ExchangeRate | null
  }[]
}

export interface MarketTrackRow {
  readonly channel: ExchangeChannel
  /** Thousandths of the currency's track, from its lowest figure to its highest. */
  readonly at: number
}

export interface MarketTrack {
  /** The central bank's dashed line on the same track; null — no rate of it today. */
  readonly official: number | null
  /** Where the person sells — the bank buys — the highest first. */
  readonly sell: readonly MarketTrackRow[]
  /** Where the person buys — the bank sells — the lowest first. */
  readonly buy: readonly MarketTrackRow[]
}

/**
 * One track a currency, shared by both lists and the central bank (MOL-348, handoff 05): each
 * figure's place on it, and each list in the order that suits the person — the best first, as the
 * star marks it. A track of one figure, or of equal ones, stands them all in its middle.
 */
export function marketTrack(input: MarketTrackInput): MarketTrack {
  const { currency } = input
  const drams = (rate: ExchangeRate | null) => (rate ? inDrams(rate, currency) : null)
  const rows = input.quotes.map((quote) => ({
    channel: quote.channel,
    sell: drams(quote.buys),
    buy: drams(quote.sells),
  }))
  const official = drams(input.official)
  const figures = [...rows.flatMap(({ sell, buy }) => [sell, buy]), official].filter(
    (figure): figure is bigint => figure !== null,
  )
  const lowest = figures.reduce(
    (least, figure) => (figure < least ? figure : least),
    figures[0] ?? 0n,
  )
  const highest = figures.reduce(
    (most, figure) => (figure > most ? figure : most),
    figures[0] ?? 0n,
  )
  const at = (figure: bigint) =>
    highest === lowest ? CHART_LEVEL / 2 : levelOf(figure - lowest, highest - lowest)
  const list = (side: 'sell' | 'buy') =>
    rows
      .flatMap((row) => {
        const figure = row[side]
        return figure === null ? [] : [{ channel: row.channel, figure }]
      })
      // A stable sort: two equal figures keep the order of the channels.
      .sort((a, b) =>
        a.figure === b.figure ? 0 : (side === 'sell') === a.figure > b.figure ? -1 : 1,
      )
      .map(({ channel, figure }) => ({ channel, at: at(figure) }))
  return { official: official === null ? null : at(official), sell: list('sell'), buy: list('buy') }
}

/** Where the two dots of «мой — ЦБ РА» stand on their line: the lower figure left. */
export interface WalletTrack {
  readonly own: number
  readonly official: number
}

/** The ends of the line, in thousandths: the labels under them need room inside the card. */
const TRACK_LOW = 150
const TRACK_HIGH = 850

/**
 * The person's rate and the central bank's of today on one line (MOL-348, handoff 04), with no tone:
 * which stands to the left is all the line says, by the figures as they are printed (`formatRate`) —
 * the side whose number is at least one. Equal — both in the middle. A rate of another pair — none.
 */
export function walletTrack(own: ExchangeRate, official: ExchangeRate): WalletTrack | null {
  const same = own.base === official.base && own.quote === official.quote
  const turned = own.base === official.quote && own.quote === official.base
  if (!same && !turned) return null
  const theirs = same ? official.scaled : divideRounded(RATE_SCALE * RATE_SCALE, official.scaled)
  const higher = signOf(own.scaled - theirs)
  // Printed under one, the number shown is the inverse, and «higher» turns.
  const shown = own.scaled >= RATE_SCALE ? higher : -higher
  if (shown === 0) return { own: CHART_LEVEL / 2, official: CHART_LEVEL / 2 }
  return shown > 0
    ? { own: TRACK_HIGH, official: TRACK_LOW }
    : { own: TRACK_LOW, official: TRACK_HIGH }
}
