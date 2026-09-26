import { RATE_SCALE, currencySchema, walletCross } from '@molvia/model'
import type { Actor, AmdRate, CachedRate, Currency, ExchangeRate, Receipt } from '@molvia/model'
import { freshOfficialRate, officialRateOf, officialRatesOn, sinceDay } from './exchanges'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<TripRepositories, 'exchanges' | 'incomes' | 'rates'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency'>

const FOREIGN = currencySchema.options.filter(
  (currency): currency is AmdRate['currency'] => currency !== 'AMD',
)

/**
 * The rates of one day between two currencies, as «Деньги» counts by them (MOL-73). Every one is on
 * whichever side its number is at least one — «390 ֏ за $», «4,1 ֏ за ₽» — since six digits of a
 * small number are four significant ones (С-1, adversarial Д2б), and every official one is fresh for
 * that day (review Р-4): the latest rate the cache holds may be weeks older, and a spending keeps its
 * snapshot for good with nothing to say how old it is. Read once per request: the cache is asked
 * once a day.
 */
export interface DayRates {
  /**
   * By the rule a trip started that day uses (MOL-39, MOL-40): the person's own, from their exchanges
   * and incomes up to that day, when they count by it and the cost of both is known — the pair
   * priced by one walk of the chain and rounded once (review Р-1); otherwise the central bank's.
   */
  between(one: Currency, other: Currency, day: string): Promise<ExchangeRate | null>

  /**
   * The central bank's alone — what an income in another currency is counted by (MOL-66, В-1):
   * never what the money already held cost, which is a price of other money (review Р-2).
   */
  official(one: Currency, other: Currency, day: string): Promise<ExchangeRate | null>
}

export async function dayRates(repositories: Repositories, owner: Owner): Promise<DayRates> {
  const conversion = owner.incomeCurrency
  const [{ preference, since }, exchanges, incomes] = await Promise.all([
    repositories.exchanges.rateSettings(owner.id),
    repositories.exchanges.list(owner.id),
    repositories.incomes.list(owner.id),
  ])
  const receipts: Receipt[] = [...exchanges, ...incomes]
  // What money of no known cost is valued at: the official rate of each receipt's own day.
  const valuing = officialRateOf(
    await officialRatesOn(repositories, [
      ...exchanges.map(({ exchangedOn }) => exchangedOn),
      ...incomes
        .filter(({ amount }) => amount.currency !== conversion)
        .map(({ receivedOn }) => receivedOn),
    ]),
    conversion,
  )
  const cut = sinceDay(since)
  const cache = new Map<string, Promise<readonly CachedRate[]>>()
  const officialRows = (day: string) => {
    const held = cache.get(day)
    if (held) return held
    const read = repositories.rates.latestOnOrBefore(FOREIGN, day)
    cache.set(day, read)
    return read
  }

  async function official(one: Currency, other: Currency, day: string) {
    if (one === other) return null
    const rows = await officialRows(day)
    const forward = freshOfficialRate(one, other, rows, day)
    if (forward && forward.scaled >= RATE_SCALE) return forward
    return freshOfficialRate(other, one, rows, day) ?? forward
  }

  return {
    async between(one, other, day) {
      if (one === other) return null
      const own =
        preference === 'personal'
          ? walletCross(receipts, conversion, one, other, day, valuing, cut)
          : null
      return own ?? official(one, other, day)
    },
    official,
  }
}
