import {
  convertAcross,
  lastDayOf,
  monthOf,
  moneyMonth,
  moneyMonthViewOf,
  previousMonth,
  spendingIn,
  yerevanDate,
} from '@molvia/model'
import type {
  Actor,
  ConvertOn,
  Currency,
  ExchangeRate,
  JournalKey,
  Money,
  MoneyMonth,
  MoneyMonthView,
  SpendingCategory,
} from '@molvia/model'
import { dayRates } from './money-rates'
import type { DayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<
  TripRepositories,
  'spendings' | 'spendingCategories' | 'money' | 'exchanges' | 'incomes' | 'rates'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

/**
 * The rates a month needs, read before it is counted: the pure function asks synchronously, so every
 * day an amount in another currency falls on is looked up first — by `rateOf`, which is the trip's
 * rule for what was spent and the central bank's alone for what came in.
 */
async function converter(
  rateOf: DayRates['between'],
  into: Currency,
  needs: readonly { amount: Money; day: string }[],
): Promise<ConvertOn> {
  const known = new Map<string, ExchangeRate | null>()
  for (const { amount, day } of needs) {
    const key = `${amount.currency}:${day}`
    if (known.has(key) || amount.currency === into) continue
    known.set(key, await rateOf(amount.currency, into, day))
  }
  return (amount, day) => {
    const rate = known.get(`${amount.currency}:${day}`)
    return rate ? convertAcross(amount, rate) : null
  }
}

async function count(
  repositories: Repositories,
  owner: Owner,
  rates: DayRates,
  month: string,
  categories: readonly SpendingCategory[],
  rate: ExchangeRate | null,
  rateKind: 'live' | 'frozen',
): Promise<MoneyMonth> {
  const from = `${month}-01`
  const to = lastDayOf(month)
  const [spendings, trips, incomes] = await Promise.all([
    repositories.spendings.between(owner.id, from, to),
    repositories.money.tripLines(owner.id, from, to),
    repositories.incomes.list(owner.id),
  ])
  const ofMonth = incomes.filter((income) => monthOf(income.receivedOn) === month)
  const [inSpend, incomeInIncome] = await Promise.all([
    converter((one, other, day) => rates.between(one, other, day), owner.spendCurrency, [
      ...trips.map((trip) => ({ amount: trip.amount, day: trip.finishedOn })),
      // A spending whose snapshot is not of the spending currency now — none was known that day,
      // or it was written before a move — is counted as a trip line is (review Р-5).
      ...spendings
        .filter((spending) => spendingIn(spending, owner.spendCurrency) === null)
        .map((spending) => ({ amount: spending.amount, day: spending.spentOn })),
    ]),
    converter(
      (one, other, day) => rates.official(one, other, day),
      owner.incomeCurrency,
      ofMonth.map((income) => ({ amount: income.amount, day: income.receivedOn })),
    ),
  ])
  return moneyMonth({
    month,
    spendCurrency: owner.spendCurrency,
    incomeCurrency: owner.incomeCurrency,
    spendings,
    trips,
    incomes: ofMonth,
    categories,
    rate,
    rateKind,
    inSpend,
    incomeInIncome,
  })
}

/**
 * The month's rate between the spending currency and the income one: today's for the running month,
 * and for a closed one the rate of its last day, frozen the first time it is read — a new exchange
 * today does not rewrite August (handoff 06). A fact of August amended later does: writing, amending,
 * removing or bringing back an exchange or an income of a day lets go of the months from that day on
 * (owner's decision В-6). Nothing known that day, and nothing is frozen: the next read tries again
 * rather than locking an empty answer in.
 */
async function monthRate(
  repositories: Pick<Repositories, 'money'>,
  owner: Owner,
  rates: DayRates,
  month: string,
  today: string,
): Promise<{ rate: ExchangeRate | null; kind: 'live' | 'frozen' }> {
  const base = owner.incomeCurrency
  const quote = owner.spendCurrency
  if (base === quote) return { rate: null, kind: 'live' }
  if (month >= monthOf(today))
    return { rate: await rates.between(base, quote, today), kind: 'live' }

  const frozen = await repositories.money.frozenRate(owner.id, month, base, quote)
  if (frozen) return { rate: frozen, kind: 'frozen' }
  const closing = await rates.between(base, quote, lastDayOf(month))
  if (!closing) return { rate: null, kind: 'frozen' }
  return { rate: await repositories.money.freeze(owner.id, month, closing), kind: 'frozen' }
}

/** `GET /money/months/:month` (MOL-73): the month counted, a page of its journal after `cursor`. */
export async function moneyMonthOf(
  repositories: Repositories,
  owner: Owner,
  month: string,
  cursor?: JournalKey,
  now: Date = new Date(),
): Promise<MoneyMonthView> {
  const today = yerevanDate(now)
  const [rates, categories] = await Promise.all([
    dayRates(repositories, owner),
    repositories.spendingCategories.list(owner.id),
  ])
  const { rate, kind } = await monthRate(repositories, owner, rates, month, today)
  const [counted, before] = await Promise.all([
    count(repositories, owner, rates, month, categories, rate, kind),
    count(repositories, owner, rates, previousMonth(month), categories, null, 'frozen'),
  ])
  // «−8 % к августу» needs an August: a month with nothing in it is no month to compare with.
  const previousSpent = before.days.length > 0 ? before.spent : null
  return moneyMonthViewOf(counted, previousSpent, categories, cursor)
}
