import {
  RATE_SCALE,
  currencySchema,
  exchangeRateSchema,
  pickOfficialRate,
  walletRate,
  yerevanMidnight,
} from '@molvia/model'
import type { Actor, AmdRate, CachedRate, Currency, ExchangeRate, Receipt } from '@molvia/model'
import { officialRateOf, officialRatesOn, sinceDay } from './exchanges'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<TripRepositories, 'exchanges' | 'incomes' | 'rates'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency'>

const FOREIGN = currencySchema.options.filter(
  (currency): currency is AmdRate['currency'] => currency !== 'AMD',
)

/**
 * The rate of one currency into another on a day, by the rule a trip started that day uses (MOL-39,
 * MOL-40): the person's own, from their exchanges and incomes up to that day, when they count by it
 * and the cost of both currencies is known; otherwise the central bank's for that day, a jumped rate
 * measured by the one before it. Read once per request: `on` asks the cache per day, a day once.
 */
export interface DayRates {
  on(base: Currency, quote: Currency, day: string): Promise<ExchangeRate | null>
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

  /** How much of `currency` one unit of the currency of conversion is, on `day` — or unknown. */
  function ownCost(currency: Currency, day: string): bigint | null {
    if (currency === conversion) return RATE_SCALE
    return walletRate(receipts, conversion, currency, day, valuing, cut)?.rate.scaled ?? null
  }

  return {
    async on(base, quote, day) {
      if (base === quote) return null
      if (preference === 'personal') {
        const ofQuote = ownCost(quote, day)
        const ofBase = ownCost(base, day)
        if (ofQuote !== null && ofBase !== null) {
          const personal = exchangeRateSchema.safeParse({
            base,
            quote,
            scaled: (ofQuote * RATE_SCALE) / ofBase,
            source: 'personal',
            asOf: yerevanMidnight(day),
          })
          if (personal.success) return personal.data
        }
      }
      const official = pickOfficialRate(base, quote, await officialRows(day), day)
      return official?.jumped ? official.previous : (official?.rate ?? null)
    },
  }
}
