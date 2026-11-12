import { inDrams } from '#model/entities/exchange-rate-chart'
import { CHART_LEVEL, countedLosses, hundredthsOf, levelOf } from '#model/entities/money-charts'
import type { ExchangeLossInput } from '#model/entities/money-charts'
import { divideRounded } from '#model/support/decimal'
import type { Money } from '#model/values/money'
import type { ExchangeChannel, ForeignCurrency } from '#model/values/market-rates'
import { printedRate, RATE_SCALE } from '#model/values/rates'
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
export interface VsMarketBarInput extends ExchangeLossInput {
  readonly id: string
  /** Its place in the order the exchanges were made, the later the larger: two of a day keep it. */
  readonly made: number
  /**
   * The difference its card sets beside the market, in the currency received — whose sign is the
   * tone (MOL-190: one sign a row, the money's) — or null with no market.
   */
  readonly cardDifference: bigint | null
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
 * A bar for every exchange of the twelve months, oldest first, two of one day in the order they were
 * made (MOL-348, handoff 02): up — more than the market of its day gave, down — less, as tall as its
 * money in the spending currency against the furthest. The sum is given the exchanges in their order,
 * and the bars are measured as it counts them (`countedLosses`): an exchange it leaves out is a bar
 * «без сравнения» on the line, never one by the central bank.
 */
export function vsMarketBars(exchanges: readonly VsMarketBarInput[]): VsMarketBar[] {
  const counted = countedLosses(exchanges)
  const measured = exchanges.map((one, index) => {
    const loss = counted[index]
    return loss && one.cardDifference !== null
      ? { ...loss, cardDifference: one.cardDifference }
      : null
  })
  const furthest = measured.reduce((most, one) => {
    const minor = one ? magnitude(one.difference.minor) : 0n
    return minor > most ? minor : most
  }, 0n)
  return exchanges
    .map((one, index) => ({ one, measure: measured[index] ?? null }))
    .sort((a, b) =>
      a.one.exchangedOn === b.one.exchangedOn
        ? a.one.made - b.one.made
        : a.one.exchangedOn < b.one.exchangedOn
          ? -1
          : 1,
    )
    .map(({ one, measure }) => {
      const written = one.note?.trim() ?? ''
      const head = {
        id: one.id,
        exchangedOn: one.exchangedOn,
        place: written === '' ? null : written,
      }
      if (!measure) return { ...head, difference: null, percent: null, sign: null, level: 0 }
      const { difference, expected, cardDifference } = measure
      const level = levelOf(magnitude(difference.minor), furthest)
      return {
        ...head,
        difference,
        percent: hundredthsOf(difference.minor, expected.minor),
        sign: signOf(cardDifference),
        level: difference.minor < 0n ? -level : level,
      }
    })
}

function magnitude(minor: bigint): bigint {
  return minor < 0n ? -minor : minor
}

/** One currency of «Курсы по данным ЦБ РА» as `marketTodayOf` gives it. */
export interface MarketTrackInput {
  readonly currency: ForeignCurrency
  readonly official: ExchangeRate | null
  readonly quotes: readonly {
    readonly channel: ExchangeChannel
    readonly buys: ExchangeRate | null
    readonly sells: ExchangeRate | null
    /** Starred: the best of its side for the person (`bestBuys`, `bestSells`). */
    readonly bestBuys: boolean
    readonly bestSells: boolean
    /** Among the figures of the latest day still fresh today — the ones the star is chosen from. */
    readonly latestBuys: boolean
    readonly latestSells: boolean
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
  /** Where the person sells — the bank buys: the star, the latest day's by figure, the rest after. */
  readonly sell: MarketTrackRow[]
  /** Where the person buys — the bank sells: the same order, the lowest first. */
  readonly buy: MarketTrackRow[]
}

/**
 * One track a currency, shared by both lists and the central bank (MOL-348, handoff 05): each
 * figure's place on it, and each list in the order that suits the person — the starred first, then
 * the rest of the latest day the star was chosen among, by figure, then the older ones, by figure
 * (review №2, adversarial А3: an exchange office of last week stood first, unstarred, over the star).
 * A track of one figure, or of equal ones, stands them all in its middle.
 */
export function marketTrack(input: MarketTrackInput): MarketTrack {
  const { currency } = input
  const drams = (rate: ExchangeRate | null) => (rate ? inDrams(rate, currency) : null)
  const rows = input.quotes.map((quote) => ({
    channel: quote.channel,
    sell: { figure: drams(quote.buys), best: quote.bestBuys, latest: quote.latestBuys },
    buy: { figure: drams(quote.sells), best: quote.bestSells, latest: quote.latestSells },
  }))
  const official = drams(input.official)
  const figures = [...rows.flatMap(({ sell, buy }) => [sell.figure, buy.figure]), official].filter(
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
  const list = (side: 'sell' | 'buy') => {
    // Selling, the higher figure is the better; buying, the lower.
    const better = (a: bigint, b: bigint) => (side === 'sell' ? b - a : a - b)
    const rank = (row: { best: boolean; latest: boolean }) => (row.best ? 0 : row.latest ? 1 : 2)
    return (
      rows
        .flatMap((row) => {
          const { figure, ...mark } = row[side]
          return figure === null ? [] : [{ channel: row.channel, figure, ...mark }]
        })
        // A stable sort: two equal figures keep the order of the channels.
        .sort((a, b) => rank(a) - rank(b) || Math.sign(Number(better(a.figure, b.figure))))
        .map(({ channel, figure }) => ({ channel, at: at(figure) }))
    )
  }
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
 * which stands to the left is all the line says, by the figures as they are printed (`printedRate`) —
 * two that print the same stand together in the middle (adversarial А2: «4,87» and «4,87» stood at
 * either end). Near one the two may print on either side of it; then by the figures themselves, on the
 * side the own rate is printed. A rate of another pair — none.
 */
export function walletTrack(own: ExchangeRate, official: ExchangeRate): WalletTrack | null {
  const same = own.base === official.base && own.quote === official.quote
  const turned = own.base === official.quote && own.quote === official.base
  if (!same && !turned) return null
  const mine = printedRate(own)
  const bank = printedRate(official)
  const shown =
    mine.of === bank.of
      ? signOf(mine.hundredths - bank.hundredths)
      : nearOne(
          own,
          same ? official.scaled : divideRounded(RATE_SCALE * RATE_SCALE, official.scaled),
        )
  if (shown === 0) return { own: CHART_LEVEL / 2, official: CHART_LEVEL / 2 }
  return shown > 0
    ? { own: TRACK_HIGH, official: TRACK_LOW }
    : { own: TRACK_LOW, official: TRACK_HIGH }
}

/** The own rate against the bank's on the own rate's sides, as the own rate is printed. */
function nearOne(own: ExchangeRate, theirs: bigint): MoneySign {
  const higher = signOf(own.scaled - theirs)
  // Printed under one, the number shown is the inverse, and «higher» turns.
  return own.scaled >= RATE_SCALE ? higher : (-higher as MoneySign)
}
