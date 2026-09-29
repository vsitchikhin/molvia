import {
  EXCHANGE_LOSS_MONTHS,
  categoryOrder,
  chartMonths,
  convertAcross,
  convertSigned,
  exchangeLosses,
  exchangeRateOf,
  isRateFresh,
  moneyCharts,
  moneyChartsViewOf,
  monthOf,
  previousMonth,
  rateLine,
  weekEnds,
  yerevanDate,
} from '@molvia/model'
import type {
  Actor,
  ChartPeriod,
  Exchange,
  ExchangeLossInput,
  ExchangeRate,
  MoneyChartsView,
  MoneyMonth,
} from '@molvia/model'
import { RATE_READS_AT_ONCE, comparisonOf, officialRatesOn } from './exchanges'
import { countMonth, monthRate, monthRows, settleThaws } from './money-month'
import { dayRates } from './money-rates'
import type { DayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'
import { todayOf } from './today'
import type { Today } from './today'

type Repositories = Pick<
  TripRepositories,
  'spendings' | 'spendingCategories' | 'money' | 'exchanges' | 'incomes' | 'rates'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'> & Today

/**
 * Each of `items` through `read`, a few at a time: the reads of the cache are independent, and at
 * most as many hold a connection as «Обмен денег» lets (`RATE_READS_AT_ONCE`) — 53 weeks at once
 * would take the whole pool (adversarial d9, round 2).
 */
async function few<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const done: R[] = []
  for (let at = 0; at < items.length; at += RATE_READS_AT_ONCE) {
    done.push(...(await Promise.all(items.slice(at, at + RATE_READS_AT_ONCE).map(read))))
  }
  return done
}

/**
 * The exchanges of the last twelve months against the central bank of each one's day, in the
 * spending currency (Р-6): a difference in another currency — dollars from roubles — is converted by
 * the bank's rate of that day, since nobody named a price for it; with none, it is named, not summed.
 *
 * **Only a rate fresh for the exchange's day measures it here** (adversarial Е): `comparisonOf` takes
 * the bank's latest, however old, and a cache stopped five weeks ago summed a rouble exchange by a
 * rate the same answer's line called «no rate», while a dollar one of that day was named. «Обмен
 * денег» still sets every exchange beside the latest it has — a line of its own, with the rate
 * printed by it; a sum of twelve months of them would say nothing of how old each was.
 */
async function lossesOf(
  repositories: Repositories,
  owner: Owner,
  rates: DayRates,
  exchanges: readonly Exchange[],
) {
  const cached = await officialRatesOn(
    repositories,
    exchanges.map(({ exchangedOn }) => exchangedOn),
  )
  const spend = owner.spendCurrency
  const inputs = await few(exchanges, async (exchange): Promise<ExchangeLossInput> => {
    const { received, exchangedOn, note } = exchange
    const { measure, difference } = comparisonOf(exchange, cached.get(exchangedOn) ?? [])
    const unknown = { note, exchangedOn, difference: null, expected: null }
    if (!measure || !difference || !isRateFresh(yerevanDate(measure.asOf), exchangedOn)) {
      return unknown
    }
    // What the bank would have given for the same money: what came, less what came beyond it.
    const expected = { minor: received.minor - difference.minor, currency: received.currency }
    if (received.currency === spend) return { note, exchangedOn, difference, expected }
    // The cache of the day is asked once, however many ask for it (`dayRates`).
    const rate = await rates.official(received.currency, spend, exchangedOn)
    const inSpend = rate && {
      difference: convertSigned(difference, rate),
      expected: convertAcross(expected, rate),
    }
    return inSpend?.difference && inSpend.expected
      ? { note, exchangedOn, difference: inSpend.difference, expected: inSpend.expected }
      : unknown
  })
  return exchangeLosses(inputs, spend)
}

/**
 * «Курс ₽ и ֏» (Р-14): the central bank's rate between the income and the spending currency at the
 * end of every week of the period — by the rule «Деньги» counts an income by, fresh for its day or
 * a gap — and the person's own exchanges of the pair on it.
 */
async function lineOf(
  owner: Owner,
  rates: DayRates,
  exchanges: readonly Exchange[],
  from: string,
  today: string,
) {
  const { incomeCurrency: income, spendCurrency: spend } = owner
  if (income === spend) return null
  // A few at a time: nothing here is written, and `dayRates` reads the cache once per day.
  const weeks: { day: string; rate: ExchangeRate | null }[] = await few(
    weekEnds(from, today),
    async (day) => ({ day, rate: await rates.official(income, spend, day) }),
  )
  const pair = new Set([income, spend])
  const own = exchanges
    .filter(
      ({ given, received, exchangedOn }) =>
        exchangedOn >= from &&
        exchangedOn <= today &&
        pair.has(given.currency) &&
        pair.has(received.currency),
    )
    .flatMap((exchange) => {
      const rate = exchangeRateOf(exchange)
      return rate ? [{ day: exchange.exchangedOn, rate }] : []
    })
  return rateLine(weeks, own)
}

/**
 * `GET /money/charts` (MOL-74): the months of the period counted by the function «Деньги» counts one
 * by — the same rows, the same rate of the month, frozen by this read as by opening it (Р-4) — so a
 * bar is the month on «Деньгах» (requirements 4). The rows of the whole period are read once (Р-3).
 * A write that lands while the months are being frozen lets them go after (`settleThaws`).
 */
export async function moneyChartsOf(
  repositories: Repositories,
  owner: Owner,
  period: ChartPeriod,
  now: Date = new Date(),
): Promise<MoneyChartsView> {
  const today = todayOf(owner, now)
  const current = monthOf(today)
  const months = chartMonths(current, period)
  const first = months[0] ?? current
  const before = previousMonth(first)
  const lossFrom = `${chartMonths(current, EXCHANGE_LOSS_MONTHS)[0] ?? current}-01`

  const [rates, categories, salaryShiftDay, rows] = await Promise.all([
    dayRates(repositories, owner),
    repositories.spendingCategories.list(owner.id),
    repositories.money.salaryShift(owner.id),
    monthRows(repositories, owner, before, current),
  ])
  const exchanges = rates.basis.exchanges

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
  // The month before is there for «к августу» alone, as on «Деньгах» (Н-6).
  const previous = await countMonth(owner, rates, before, rows, categories, null, 'frozen', null)

  // One after the other, so no more than `RATE_READS_AT_ONCE` hold a connection (review С-11).
  const losses = await lossesOf(
    repositories,
    owner,
    rates,
    exchanges.filter(({ exchangedOn }) => exchangedOn >= lossFrom && exchangedOn <= today),
  )
  const line = await lineOf(owner, rates, exchanges, `${first}-01`, today)
  // Every category the owner can choose is offered, spent in the period or not (adversarial А).
  const offered = categoryOrder(categories)
    .filter((category) => category.archivedAt === null)
    .map((category) => category.id)
  return moneyChartsViewOf(
    period,
    moneyCharts(counted, previous, offered),
    categories,
    losses,
    line,
  )
}
