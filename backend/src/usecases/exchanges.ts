import {
  DomainError,
  ERROR,
  EXCHANGE_LOSS_MONTHS,
  OFFICIAL_RATE_FRESH_DAYS,
  RATE_SCALE,
  bestQuote,
  convertAcross,
  convertSigned,
  currencySchema,
  exchangeLosses,
  exchangeLossesViewOf,
  exchangeRateChartViewOf,
  exchangeRateOf,
  exchangersPending,
  heldEstimate,
  isRateFresh,
  lastReceipt,
  latestDay,
  marketQuotesOn,
  marketQuotesToday,
  marketRateOf,
  marketSideOf,
  officialDifference,
  ownRates,
  pickOfficialRate,
  RATE_CHART_CHANNEL,
  rateChart,
  rateChartPairs,
  ratePeriodFrom,
  receiptDay,
  resourceIdOf,
  uprightOf,
  yerevanDate,
} from '@molvia/model'
import type {
  Actor,
  AmdRate,
  CachedRate,
  Currency,
  Exchange,
  ExchangeAmendBody,
  ExchangeBody,
  ExchangeLossInput,
  ExchangeRate,
  ExchangeRevision,
  ExchangeView,
  ExchangesResponse,
  Income,
  MarketQuote,
  MarketRate,
  MarketToday,
  Money,
  OfficialRate,
  OfficialRateOf,
  OwnRates,
  RatePreference,
  Receipt,
  ReceiptView,
} from '@molvia/model'
import { keptSide, knownAccounts, sideOf } from './account-of'
import { dayOfMoment, endOfDay, todayOf } from './today'
import type { Today } from './today'
import type { TripRepositories } from '@/db/unit-of-work'

/** What the person's own money is walked from — «Доходы» reads it too. */
type OwnMoneyRepositories = Pick<TripRepositories, 'exchanges' | 'incomes' | 'rates'>
type Repositories = OwnMoneyRepositories & Pick<TripRepositories, 'marketRates'>
/** A write also lets go of the months frozen without it (MOL-73, В-6). */
type Writing = Repositories & Pick<TripRepositories, 'money' | 'moneyAccounts'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'> & Today

const FOREIGN = currencySchema.options.filter(
  (currency): currency is AmdRate['currency'] => currency !== 'AMD',
)

/** How many days of the cache are read at once: a long list must not take the whole pool (Ч-3). */
export const RATE_READS_AT_ONCE = 8

/** The official rates cached on or before each of `days`, one query a day, a few at a time. */
export async function officialRatesOn(
  { rates }: Pick<Repositories, 'rates'>,
  days: Iterable<string>,
): Promise<ReadonlyMap<string, readonly CachedRate[]>> {
  const distinct = [...new Set(days)]
  const cached = new Map<string, readonly CachedRate[]>()
  for (let start = 0; start < distinct.length; start += RATE_READS_AT_ONCE) {
    const batch = distinct.slice(start, start + RATE_READS_AT_ONCE)
    const read = await Promise.all(batch.map((day) => rates.latestOnOrBefore(FOREIGN, day)))
    batch.forEach((day, index) => cached.set(day, read[index] ?? []))
  }
  return cached
}

const DAY_MS_RATES = 24 * 60 * 60 * 1000

/** The day `days` before `day`, both `YYYY-MM-DD`. */
function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(day) - days * DAY_MS_RATES).toISOString().slice(0, 10)
}

/**
 * The market rows of the week before each of `days` (MOL-137): one query a day, a few at a time,
 * as the official cache is read.
 */
async function marketRatesOn(
  { marketRates }: Pick<Repositories, 'marketRates'>,
  days: Iterable<string>,
): Promise<ReadonlyMap<string, readonly MarketRate[]>> {
  const distinct = [...new Set(days)]
  const read = new Map<string, readonly MarketRate[]>()
  for (let start = 0; start < distinct.length; start += RATE_READS_AT_ONCE) {
    const batch = distinct.slice(start, start + RATE_READS_AT_ONCE)
    const rows = await Promise.all(
      batch.map((day) =>
        marketRates.between(FOREIGN, daysBefore(day, OFFICIAL_RATE_FRESH_DAYS), day),
      ),
    )
    batch.forEach((day, index) => read.set(day, rows[index] ?? []))
  }
  return read
}

/**
 * An exchange set beside the market of its day (MOL-137): the best figure for the person among
 * the channels they could have used (owner's decision В-1), and their own channel when they named
 * it and it was not the best. Each is measured as the official comparison is — on the side the
 * exchange's own rate is printed by, the difference in the received currency. Null for a pair
 * without the dram (В-4) and for a day without a single figure.
 */
export function marketComparisonOf(
  exchange: Exchange,
  rows: readonly MarketRate[],
  exchangersThrough: string | null,
  today: string,
): ExchangeView['market'] {
  const side = marketSideOf(exchange.given.currency, exchange.received.currency)
  if (!side) return null
  const quotes = marketQuotesOn(rows, side.currency, side.side, exchange.exchangedOn)
  const measured = (quote: MarketQuote | null) => {
    const rate = quote ? marketRateOf(quote, side.currency) : null
    const difference = rate ? officialDifference(exchange, rate) : null
    return quote && rate && difference
      ? { channel: quote.channel, basis: quote.basis, rate, difference }
      : null
  }
  const bestOne = bestQuote(quotes, side.side)
  const best = measured(bestOne)
  if (!best) return null
  const ownOne = quotes.find((quote) => quote.channel === exchange.channel) ?? null
  return {
    best,
    own: ownOne && ownOne.channel !== bestOne?.channel ? measured(ownOne) : null,
    exchangersPending: exchangersPending(quotes, exchangersThrough, exchange.exchangedOn, today),
  }
}

/**
 * «Курсы по данным ЦБ РА» (MOL-137, В-1): for each currency, the central bank's own rate of today
 * — never an open source standing in for it, which the block's words would name the central bank
 * (review П-3) — and each channel's latest figures, each dated by its own day. The best for the
 * person is marked among the figures of the latest day still fresh today: an exchange office of last
 * week is shown with its date, but set beside today's banks it is not today's best — a card compares
 * with it only on its own day (review П-5).
 */
export function marketTodayOf(
  latest: readonly MarketRate[],
  official: readonly CachedRate[],
  today: string,
): MarketToday[] {
  return FOREIGN.map((currency): MarketToday => {
    const buys = marketQuotesToday(latest, currency, 'bankBuys', today)
    const sells = marketQuotesToday(latest, currency, 'bankSells', today)
    const fresh = (quotes: readonly MarketQuote[]) => {
      const recent = quotes.filter((quote) => isRateFresh(quote.date, today))
      const newest = recent.reduce((day, quote) => (quote.date > day ? quote.date : day), '')
      return recent.filter((quote) => quote.date === newest)
    }
    const bestBuys = bestQuote(fresh(buys), 'bankBuys')
    const bestSells = bestQuote(fresh(sells), 'bankSells')
    const channels = [...new Set([...buys, ...sells].map((quote) => quote.channel))]
    return {
      currency,
      official: freshOfficialRate(
        currency,
        'AMD',
        official.filter((row) => row.provider === 'cba'),
        today,
      ),
      quotes: channels.flatMap((channel) => {
        const buy = buys.find((quote) => quote.channel === channel) ?? null
        const sell = sells.find((quote) => quote.channel === channel) ?? null
        const basis = buy?.basis ?? sell?.basis
        if (basis === undefined) return []
        return [
          {
            channel,
            basis,
            buys: buy ? marketRateOf(buy, currency) : null,
            sells: sell ? marketRateOf(sell, currency) : null,
            bestBuys: bestBuys?.channel === channel,
            bestSells: bestSells?.channel === channel,
          },
        ]
      }),
    }
  })
}

/**
 * A rate that jumped when it arrived is not a fact to measure by — it may be a comma in the wrong
 * place at the bank (MOL-39, Р-19): the rate before the jump is used when there is one, and
 * otherwise none (review С-5).
 */
function steadyOf(official: OfficialRate | null): ExchangeRate | null {
  return official?.jumped ? official.previous : (official?.rate ?? null)
}

/**
 * The official rate of `base` into a currency on an exchange's day, by the rule a trip started
 * that day would have used — what money of no known cost is valued at (MOL-42, В-1). Only a rate
 * fresh for that day, as a trip's is (a Friday rate on Sunday): the rule for a trip falls back to
 * the freshest it has and says `rateStale`, and here nothing would say it — an old number would
 * turn an honest «unknown» into a confident «valued» (adversarial Ж3).
 */
export function officialRateOf(
  cached: ReadonlyMap<string, readonly CachedRate[]>,
  base: Currency,
): OfficialRateOf {
  return (currency, day) => freshOfficialRate(base, currency, cached.get(day) ?? [], day)
}

/** The official rate of the pair on `day`, judged as above and fresh for that day — or null. */
export function freshOfficialRate(
  base: Currency,
  quote: Currency,
  rows: readonly CachedRate[],
  day: string,
): ExchangeRate | null {
  const rate = steadyOf(pickOfficialRate(base, quote, rows, day))
  return rate && isRateFresh(yerevanDate(rate.asOf), day) ? rate : null
}

/**
 * The official rate between two currencies on `day`, fresh for it, on whichever side its number is
 * at least one — as «Деньги» count by it (MOL-73, С-1) — or null.
 */
export function officialAcross(
  one: Currency,
  other: Currency,
  rows: readonly CachedRate[],
  day: string,
): ExchangeRate | null {
  if (one === other) return null
  const forward = freshOfficialRate(one, other, rows, day)
  if (forward && forward.scaled >= RATE_SCALE) return forward
  return freshOfficialRate(other, one, rows, day) ?? forward
}

/**
 * «Обмены против рынка» (MOL-152, in MOL-159): the exchanges of the twelve months to today by place,
 * each measured exactly as its card is — against the market of its day by its own channel when the
 * person named it, else by the best for them (owner's decision В-3) — so the card and the sum never
 * disagree, and the market is not read twice. A difference in another currency comes into the
 * spending one by the official rate of that day (Р-6 of MOL-74); with none, or no market — a pair
 * without the dram, a day with no figure — the exchange is named, never summed, and never set beside
 * the central bank instead (handoff 05).
 */
export function marketLossesOf(
  measures: ReadonlyMap<string, ExchangeLossInput>,
  spend: Currency,
): ExchangesResponse['losses'] {
  const losses = exchangeLosses([...measures.values()], spend)
  return losses && exchangeLossesViewOf(losses)
}

/**
 * The first day of the twelve months «Обмены против рынка» and the year of the line of the rate look
 * back on: from the day after the same day a year ago (MOL-168, В-1 «б», adversarial В) — one window,
 * so a point of the year always has the percent of its place.
 */
function windowFrom(today: string): string {
  return ratePeriodFrom(today, EXCHANGE_LOSS_MONTHS)
}

/**
 * Each exchange of the twelve months as «Обмены против рынка» measures it, by its id: the sum is
 * made of these, and a point of the line of the rate takes its percent from the very same drams
 * (MOL-161, adversarial В) — counted apart, the two rounded at different places and «−0,67 %» stood
 * beside «−0,66 %» for one exchange.
 */
export function marketMeasuresOf(
  views: readonly ExchangeView[],
  cached: ReadonlyMap<string, readonly CachedRate[]>,
  spend: Currency,
  today: string,
): ReadonlyMap<string, ExchangeLossInput> {
  const from = windowFrom(today)
  return new Map(
    views
      .filter(({ exchangedOn }) => exchangedOn >= from && exchangedOn <= today)
      .map((view) => [view.id, marketMeasureOf(view, cached, spend)]),
  )
}

/** One exchange against its market, in the spending currency, or unknown — «без сравнения». */
function marketMeasureOf(
  view: ExchangeView,
  cached: ReadonlyMap<string, readonly CachedRate[]>,
  spend: Currency,
): ExchangeLossInput {
  const { note, exchangedOn, received } = view
  const unknown = { note, exchangedOn, difference: null, expected: null }
  const measure = view.market?.own ?? view.market?.best
  if (!measure) return unknown
  const { difference } = measure
  // What the market would have given for the same money: what came, less what came beyond it.
  const expected = { minor: received.minor - difference.minor, currency: received.currency }
  if (received.currency === spend) return { note, exchangedOn, difference, expected }
  const rate = officialAcross(received.currency, spend, cached.get(exchangedOn) ?? [], exchangedOn)
  const inSpend = rate && {
    difference: convertSigned(difference, rate),
    expected: convertAcross(expected, rate),
  }
  return inSpend?.difference && inSpend.expected
    ? { note, exchangedOn, difference: inSpend.difference, expected: inSpend.expected }
    : unknown
}

/**
 * The day the currency of conversion changed on, or null when it never did — in the phone's zone
 * (adversarial round 4 Ч): the change is a moment the server stamped, and «before it» is compared
 * with days the phone names. By Yerevan's, a salary typed at 23:40 in Moscow right after the change
 * was «the old reckoning».
 */
export function sinceDay(since: Date | null, owner: Today = {}): string | null {
  return since ? dayOfMoment(owner, since) : null
}

/**
 * An exchange compared with the official rate of its own day — the rate a trip started that day
 * would have taken, by the same rule (`pickOfficialRate`). A jumped rate is measured by the one
 * before it, and without one there is no comparison. «Обмен денег» and «Графики» (MOL-74) measure
 * by this one function, so the card of losses sums the very differences the list shows.
 */
export function comparisonOf(
  exchange: Exchange,
  rows: readonly CachedRate[],
): {
  rate: ExchangeRate | null
  official: OfficialRate | null
  measure: ExchangeRate | null
  difference: Money | null
} {
  const { given, received, exchangedOn } = exchange
  const rate = exchangeRateOf(exchange)
  const official = pickOfficialRate(given.currency, received.currency, rows, exchangedOn)
  const backward = steadyOf(pickOfficialRate(received.currency, given.currency, rows, exchangedOn))
  // The bank's rate on the side the exchange's own is printed by, built from the cache that
  // side: the plate sets the two one under the other, and near parity each chose its own side —
  // «1,01 $/€» over «1,01 €/$» (adversarial Г). Without a rate of the exchange, the side at least
  // one (MOL-81); the difference is measured by whichever it is.
  const forward = steadyOf(official)
  const measure = rate
    ? rate.base === given.currency
      ? forward
      : backward
    : uprightOf(forward, backward)
  const difference = measure ? officialDifference(exchange, measure) : null
  return { rate, official, measure, difference }
}

/** One exchange as the list shows it, with its comparison — or why there is none. */
function viewsOf(
  exchanges: readonly Exchange[],
  cached: ReadonlyMap<string, readonly CachedRate[]>,
  history: ReadonlyMap<string, readonly ExchangeRevision[]>,
  market: ReadonlyMap<string, readonly MarketRate[]>,
  exchangersThrough: string | null,
  today: string,
): ExchangeView[] {
  return [...exchanges].reverse().map((exchange): ExchangeView => {
    const { given, received, exchangedOn } = exchange
    const { rate, official, measure, difference } = comparisonOf(
      exchange,
      cached.get(exchangedOn) ?? [],
    )
    return {
      id: exchange.id,
      exchangedOn,
      given,
      received,
      heldBefore: exchange.heldBefore,
      note: exchange.note,
      channel: exchange.channel,
      givenAccountId: exchange.givenAccountId,
      receivedAccountId: exchange.receivedAccountId,
      revision: exchange.revision,
      amendedAt: exchange.amendedAt,
      history: (history.get(exchange.id) ?? []).map(
        ({ given, received, exchangedOn, heldBefore, note, channel, replacedAt }) => ({
          given,
          received,
          exchangedOn,
          heldBefore,
          note,
          channel,
          replacedAt,
        }),
      ),
      rate,
      official:
        official && measure && difference
          ? { rate: measure, provider: official.provider, difference }
          : null,
      officialDoubtful: !!official?.jumped && !measure,
      market: marketComparisonOf(exchange, market.get(exchangedOn) ?? [], exchangersThrough, today),
    }
  })
}

/**
 * Every exchange and income, newest first, with whether it gave its currency a price — what the
 * sheets ask «сколько было до» by (MOL-66). The order is the walk's, turned round.
 */
export function receiptsOf(
  receipts: readonly Receipt[],
  priced: ReadonlySet<string>,
): ReceiptView[] {
  return [...receipts]
    .sort((a, b) => {
      const [dayA, dayB] = [receiptDay(a), receiptDay(b)]
      if (dayA !== dayB) return dayA < dayB ? 1 : -1
      const time = b.createdAt.getTime() - a.createdAt.getTime()
      // The walk breaks a tie by the name, and this is its order turned round (self-review).
      return time !== 0 ? time : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
    .map((receipt) => ({
      id: receipt.id,
      currency: 'given' in receipt ? receipt.received.currency : receipt.amount.currency,
      on: receiptDay(receipt),
      priced: priced.has(receipt.id),
    }))
}

/**
 * From when the purchases count against the money of an exchange. From the moment it was written
 * when that was on its own day: a purchase that morning was paid with the money held before, which
 * `heldBefore` already names (А4). An exchange written later, under an earlier day, counts from the
 * end of that day — what was bought between the exchange and its record was bought with its money,
 * and counting only from the record lost all of it (round 2, В3). What was bought later on the day
 * of such an exchange is lost instead: the day has no hours to tell before from after.
 */
function spentFrom(receipt: Receipt, owner: Today): Date {
  // The end of the phone's day (adversarial round 4 У): the day is the phone's, so is its midnight.
  const end = endOfDay(owner, receiptDay(receipt))
  return receipt.createdAt < end ? receipt.createdAt : end
}

/** What «Обмен денег» and «Доходы» are both built from — see `ownMoney`. */
interface OwnMoney {
  readonly preference: RatePreference
  readonly base: Currency
  readonly quote: Currency
  readonly baseSince: string | null
  readonly exchanges: readonly Exchange[]
  readonly incomes: readonly Income[]
  readonly cached: ReadonlyMap<string, readonly CachedRate[]>
  readonly rates: OwnRates
  readonly heldEstimates: ExchangesResponse['heldEstimates']
  readonly receipts: readonly ReceiptView[]
}

/**
 * The person's own money as of today, walked once for either screen (MOL-66): the exchanges and
 * incomes, the official rates of their days, the rates they make, what each currency is likely
 * still held at, and every exchange and income with whether it gave its currency a price.
 *
 * The cache of official rates is read once for every day of an exchange and of an income in a
 * currency that needs valuing: the same rows compare each exchange with the bank and value money
 * whose cost nobody named.
 */
export async function ownMoney(
  repositories: OwnMoneyRepositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<OwnMoney> {
  const { exchanges, incomes } = repositories
  const today = todayOf(owner, now)
  const base = owner.incomeCurrency
  const quote = owner.spendCurrency
  const [{ preference, since }, list, received] = await Promise.all([
    exchanges.rateSettings(owner.id),
    exchanges.list(owner.id),
    incomes.list(owner.id),
  ])
  const cached = await officialRatesOn(repositories, [
    ...list.map(({ exchangedOn }) => exchangedOn),
    ...received
      .filter(({ amount }) => amount.currency !== base)
      .map(({ receivedOn }) => receivedOn),
  ])

  const receipts: Receipt[] = [...list, ...received]
  const baseSince = sinceDay(since, owner)
  // Walked to the phone's today (MOL-121): an exchange of a day Yerevan has not reached did give its
  // currency a price, and a second one that night must be asked «сколько было до» — an answer not
  // asked is lost for good (adversarial О).
  const rates = ownRates(receipts, base, quote, today, officialRateOf(cached, base), baseSince)

  const currencies = [
    ...new Set(
      receipts.map((receipt) =>
        'given' in receipt ? receipt.received.currency : receipt.amount.currency,
      ),
    ),
  ].filter((currency) => currency !== base)
  const heldEstimates = await Promise.all(
    currencies.map(async (currency) => {
      const last = lastReceipt(receipts, currency, today)
      if (!last) return null
      const spent = await exchanges.spentSince(owner.id, currency, spentFrom(last, owner))
      const estimate = heldEstimate(receipts, last, spent)
      if (!estimate) return null
      const from: 'exchange' | 'income' = 'given' in last ? 'exchange' : 'income'
      return { ...estimate, from }
    }),
  )

  return {
    preference,
    base,
    quote,
    baseSince,
    exchanges: list,
    incomes: received,
    cached,
    rates,
    heldEstimates: heldEstimates.filter((estimate) => estimate !== null),
    receipts: receiptsOf(receipts, rates.priced),
  }
}

/**
 * «Курс рубля за месяц, 6 и 12 месяцев» (MOL-161, MOL-168): the pairs and their side from the
 * exchanges of the year — the window of «Обмены против рынка» — the line of all bank clients read
 * once for the year and drawn for each period, and each point with the very comparison its card
 * carries (`market` of the list), so the two never disagree.
 */
export async function rateChartOf(
  { marketRates }: Pick<Repositories, 'marketRates'>,
  views: readonly ExchangeView[],
  measures: ReadonlyMap<string, ExchangeLossInput>,
  income: Currency,
  today: string,
): Promise<ExchangesResponse['rateCharts']> {
  const from = windowFrom(today)
  const pairs = rateChartPairs(views, from, today, income)
  if (pairs.length === 0) return null
  const rows = await marketRates.series(
    RATE_CHART_CHANNEL,
    pairs.map(({ currency }) => currency),
    // The first week's figure may be up to a week older than its end.
    daysBefore(from, OFFICIAL_RATE_FRESH_DAYS),
    today,
  )
  const chart = rateChart(
    pairs.map((pair) => ({ ...pair, rows })),
    views.map((view) => {
      const measure = measures.get(view.id)
      const measured =
        measure?.difference && measure.expected
          ? { difference: measure.difference.minor, expected: measure.expected.minor }
          : null
      return { ...view, measured }
    }),
    today,
  )
  return chart && exchangeRateChartViewOf(chart)
}

/**
 * «Обмен денег» whole (MOL-40, MOL-42): the preference, the pair a trip started today would convert
 * by, the wallet of that pair and the cost of every other currency held as of today, the hints for
 * the next exchange into each currency, and every exchange, newest first. Everything a figure on
 * the screen is comes from here — the phone divides nothing.
 */
export async function exchangesOverview(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  // The day of the phone, as the rest of the screen counts it (MOL-121).
  const today = todayOf(owner, now)
  const [money, history, latest, exchangersThrough, official] = await Promise.all([
    ownMoney(repositories, owner, now),
    repositories.exchanges.history(owner.id),
    repositories.marketRates.latest(),
    repositories.marketRates.through('exchanger'),
    repositories.rates.latestOnOrBefore(FOREIGN, today),
  ])
  const market = await marketRatesOn(
    repositories,
    money.exchanges
      .filter((exchange) => marketSideOf(exchange.given.currency, exchange.received.currency))
      .map((exchange) => exchange.exchangedOn),
  )
  const { base, quote, rates } = money
  const views = viewsOf(money.exchanges, money.cached, history, market, exchangersThrough, today)
  const measures = marketMeasuresOf(views, money.cached, owner.spendCurrency, today)
  const chart = await rateChartOf(repositories, views, measures, owner.incomeCurrency, today)
  return {
    preference: money.preference,
    pair: base === quote ? null : { base, quote },
    wallet: rates.wallet,
    costs: [...rates.costs],
    walletUnknown: rates.unknownAt,
    heldEstimates: money.heldEstimates,
    baseSince: money.baseSince,
    exchanges: views,
    receipts: [...money.receipts],
    marketToday: marketTodayOf(latest, official, today),
    losses: marketLossesOf(measures, owner.spendCurrency),
    rateCharts: chart,
  }
}

/**
 * The screen as it is on opening. A removed exchange is final from here: the screen that offered
 * it back is gone (В-5).
 */
export async function readExchanges(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id)
  return exchangesOverview(repositories, owner, now)
}

/** The day of the owner's live exchange, or null — what a write lets the frozen months go from. */
async function dayOfExchange(
  repositories: Pick<Repositories, 'exchanges'>,
  owner: Pick<Owner, 'id'>,
  id: string,
): Promise<string | null> {
  const own = resourceIdOf(id)
  const exchanges = await repositories.exchanges.list(owner.id)
  return exchanges.find((exchange) => exchange.id === own)?.exchangedOn ?? null
}

/** The earlier of two days, the known one when only one is. */
export function earlier(one: string | null, other: string): string {
  return one !== null && one < other ? one : other
}

/**
 * «Записать обмен». The day is the person's to name — their phone's (MOL-121) — but not a day that
 * has not come yet anywhere (`latestDay`). The walk takes no link after the request's today, so an
 * exchange of a day the phone has not reached enters no trip it starts (the same line «not from the
 * future» draws for an official rate). 201 for a new exchange, and the screen whole either way.
 */
export async function recordExchange(
  repositories: Writing,
  owner: Owner,
  body: ExchangeBody,
  now: Date = new Date(),
): Promise<{ overview: ExchangesResponse; created: boolean }> {
  if (body.exchangedOn > latestDay(now)) throw new DomainError(ERROR.EXCHANGE_IN_FUTURE)
  const accounts = await knownAccounts(repositories, owner)
  // Left out stays left out: a repeat from a screen older than accounts is still a repeat (Р-26).
  const sent = {
    ...body,
    ...(body.givenAccountId === undefined
      ? {}
      : { givenAccountId: sideOf(accounts, body.givenAccountId, body.given.currency) }),
    ...(body.receivedAccountId === undefined
      ? {}
      : { receivedAccountId: sideOf(accounts, body.receivedAccountId, body.received.currency) }),
  }
  await repositories.exchanges.purgeRemoved(owner.id)
  const { created } = await repositories.exchanges.add(owner.id, sent)
  await repositories.money.thaw(owner.id, body.exchangedOn)
  return { overview: await exchangesOverview(repositories, owner, now), created }
}

/**
 * «Сохранить правку» (MOL-42, В-3): the exchange as it should now be, the version before it kept.
 * The same «not after today» as a new exchange. Trips already started keep the rate they took;
 * trips from now on count by the amended exchange — and its history says why the two differ.
 */
export async function amendExchange(
  repositories: Writing,
  owner: Owner,
  id: string,
  body: ExchangeAmendBody,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  if (body.exchangedOn > latestDay(now)) throw new DomainError(ERROR.EXCHANGE_IN_FUTURE)
  await repositories.exchanges.purgeRemoved(owner.id)
  const own = resourceIdOf(id)
  const held = (await repositories.exchanges.list(owner.id)).find((exchange) => exchange.id === own)
  const accounts = await knownAccounts(repositories, owner)
  const givenAccountId = sideOf(
    accounts,
    keptSide(accounts, held?.givenAccountId ?? null, body.givenAccountId, body.given.currency),
    body.given.currency,
  )
  const receivedAccountId = sideOf(
    accounts,
    keptSide(
      accounts,
      held?.receivedAccountId ?? null,
      body.receivedAccountId,
      body.received.currency,
    ),
    body.received.currency,
  )
  const { accountsOnly } = await repositories.exchanges.amend(owner.id, id, {
    ...body,
    givenAccountId,
    receivedAccountId,
  })
  // Only the accounts moved: the rate is the same fact, and so is every month (Р-15).
  if (!accountsOnly) {
    await repositories.money.thaw(owner.id, earlier(held?.exchangedOn ?? null, body.exchangedOn))
  }
  return exchangesOverview(repositories, owner, now)
}

/**
 * «Удалить обмен» (Р-4): no amending, a wrong exchange is removed and entered again. Trips
 * already started keep the rate they took; only trips from now on see the wallet without it.
 * Removed and not yet final: the one removed before it is, since only the latest is offered back
 * — but never this one, when the removal is sent again after a lost answer (round 3, Д2).
 */
export async function removeExchange(
  repositories: Writing,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id, id)
  const day = await dayOfExchange(repositories, owner, id)
  await repositories.exchanges.remove(owner.id, id)
  if (day !== null) await repositories.money.thaw(owner.id, day)
  return exchangesOverview(repositories, owner, now)
}

/**
 * «Вернуть» (В-5): the removed exchange as it was, `created_at` included. Again after a lost answer
 * it is the same success. Nothing to bring back — already final, or someone else's — answers as a
 * missing row does.
 */
export async function restoreExchange(
  repositories: Writing,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  if (!(await repositories.exchanges.restore(owner.id, id))) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  const day = await dayOfExchange(repositories, owner, id)
  if (day !== null) await repositories.money.thaw(owner.id, day)
  return exchangesOverview(repositories, owner, now)
}

/**
 * «Мой / Официальный» (В-3): for trips from now on — a trip keeps the rate it took. The months of
 * «Деньги» are counted by it, not snapshotted by it, so every frozen one is let go and counted by the
 * new rule when next read (MOL-73, owner's decision В-8): two past months by two rules, decided by
 * which was opened first, was the alternative.
 */
export async function chooseRatePreference(
  repositories: Writing,
  owner: Owner,
  preference: RatePreference,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id)
  await repositories.exchanges.setPreference(owner.id, preference)
  await repositories.money.thaw(owner.id)
  return exchangesOverview(repositories, owner, now)
}
