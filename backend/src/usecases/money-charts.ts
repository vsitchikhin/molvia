import {
  EXCHANGE_LOSS_MONTHS,
  chartMonths,
  convertAcross,
  convertSigned,
  exchangeLosses,
  exchangeRateOf,
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
import { comparisonOf, officialRatesOn } from './exchanges'
import { countMonth, monthRate, monthRows } from './money-month'
import { dayRates } from './money-rates'
import type { DayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<
  TripRepositories,
  'spendings' | 'spendingCategories' | 'money' | 'exchanges' | 'incomes' | 'rates'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

/**
 * The exchanges of the last twelve months against the central bank of each one's day, in the
 * spending currency (Р-6): a difference in another currency — dollars from roubles — is converted by
 * the bank's rate of that day, since nobody named a price for it; with none, it is named, not summed.
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
  const inputs: ExchangeLossInput[] = []
  for (const exchange of exchanges) {
    const { received, exchangedOn, note } = exchange
    const { difference } = comparisonOf(exchange, cached.get(exchangedOn) ?? [])
    const unknown = { note, exchangedOn, difference: null, expected: null }
    if (!difference) {
      inputs.push(unknown)
      continue
    }
    // What the bank would have given for the same money: what came, less what came beyond it.
    const expected = { minor: received.minor - difference.minor, currency: received.currency }
    if (received.currency === spend) {
      inputs.push({ note, exchangedOn, difference, expected })
      continue
    }
    const rate = await rates.official(received.currency, spend, exchangedOn)
    const measured = rate && {
      difference: convertSigned(difference, rate),
      expected: convertAcross(expected, rate),
    }
    inputs.push(
      measured?.difference && measured.expected
        ? { note, exchangedOn, difference: measured.difference, expected: measured.expected }
        : unknown,
    )
  }
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
  const weeks: { day: string; rate: ExchangeRate | null }[] = []
  // One after another: each asks the cache for its own day, and a period is at most 53 weeks.
  for (const day of weekEnds(from, today)) {
    weeks.push({ day, rate: await rates.official(income, spend, day) })
  }
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
 */
export async function moneyChartsOf(
  repositories: Repositories,
  owner: Owner,
  period: ChartPeriod,
  now: Date = new Date(),
): Promise<MoneyChartsView> {
  const today = yerevanDate(now)
  const current = monthOf(today)
  const months = chartMonths(current, period)
  const first = months[0] ?? current
  const before = previousMonth(first)
  const lossFrom = `${chartMonths(current, EXCHANGE_LOSS_MONTHS)[0] ?? current}-01`

  const [rates, categories, salaryShiftDay, rows, exchanges] = await Promise.all([
    dayRates(repositories, owner),
    repositories.spendingCategories.list(owner.id),
    repositories.money.salaryShift(owner.id),
    monthRows(repositories, owner, before, current),
    repositories.exchanges.list(owner.id),
  ])

  const counted: MoneyMonth[] = []
  // One month after another: a closed month's rate may be frozen by this very read.
  for (const month of months) {
    const { rate, kind } = await monthRate(repositories, owner, rates, month, today)
    counted.push(
      await countMonth(owner, rates, month, rows, categories, rate, kind, salaryShiftDay),
    )
  }
  // The month before is there for «к августу» alone, as on «Деньгах» (Н-6).
  const previous = await countMonth(owner, rates, before, rows, categories, null, 'frozen', null)

  const [losses, line] = await Promise.all([
    lossesOf(
      repositories,
      owner,
      rates,
      exchanges.filter(({ exchangedOn }) => exchangedOn >= lossFrom && exchangedOn <= today),
    ),
    lineOf(owner, rates, exchanges, `${first}-01`, today),
  ])
  return moneyChartsViewOf(period, moneyCharts(counted, previous), categories, losses, line)
}
