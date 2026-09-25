import {
  DomainError,
  ERROR,
  currencySchema,
  currencyCosts,
  exchangeRateOf,
  heldEstimate,
  lastReceipt,
  officialDifference,
  pickOfficialRate,
  walletRate,
  yerevanDate,
  yerevanMidnight,
} from '@molvia/model'
import type {
  Actor,
  AmdRate,
  CachedRate,
  Currency,
  Exchange,
  ExchangeBody,
  ExchangeRate,
  ExchangeView,
  ExchangesResponse,
  OfficialRate,
  OfficialRateOf,
  RatePreference,
} from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<TripRepositories, 'exchanges' | 'rates'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

const FOREIGN = currencySchema.options.filter(
  (currency): currency is AmdRate['currency'] => currency !== 'AMD',
)

/** The official rates cached on or before each of `days`, one query a day, all at once. */
export async function officialRatesOn(
  { rates }: Pick<Repositories, 'rates'>,
  days: Iterable<string>,
): Promise<ReadonlyMap<string, readonly CachedRate[]>> {
  return new Map(
    await Promise.all(
      [...new Set(days)].map(
        async (day) => [day, await rates.latestOnOrBefore(FOREIGN, day)] as const,
      ),
    ),
  )
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
 * that day would have used — what money of no known cost is valued at (MOL-42, В-1).
 */
export function officialRateOf(
  cached: ReadonlyMap<string, readonly CachedRate[]>,
  base: Currency,
): OfficialRateOf {
  return (currency, day) => steadyOf(pickOfficialRate(base, currency, cached.get(day) ?? [], day))
}

/** The Yerevan day the currency of conversion changed on, or null when it never did. */
export function sinceDay(since: Date | null): string | null {
  return since ? yerevanDate(since) : null
}

/**
 * One exchange as the list shows it, compared with the official rate of its own day — the rate a
 * trip started that day would have taken, by the same rule (`pickOfficialRate`). A jumped rate is
 * measured by the one before it, and without one the comparison is withheld and the row says why.
 */
function viewsOf(
  exchanges: readonly Exchange[],
  cached: ReadonlyMap<string, readonly CachedRate[]>,
): ExchangeView[] {
  return [...exchanges].reverse().map((exchange): ExchangeView => {
    const { given, received, exchangedOn } = exchange
    const official = pickOfficialRate(
      given.currency,
      received.currency,
      cached.get(exchangedOn) ?? [],
      exchangedOn,
    )
    const measure = steadyOf(official)
    const difference = measure ? officialDifference(exchange, measure) : null
    return {
      id: exchange.id,
      exchangedOn,
      given,
      received,
      heldBefore: exchange.heldBefore,
      rate: exchangeRateOf(exchange),
      official:
        official && measure && difference
          ? { rate: measure, provider: official.provider, difference }
          : null,
      officialDoubtful: !!official?.jumped && !measure,
    }
  })
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * From when the purchases count against the money of an exchange. From the moment it was written
 * when that was on its own day: a purchase that morning was paid with the money held before, which
 * `heldBefore` already names (А4). An exchange written later, under an earlier day, counts from the
 * end of that day — what was bought between the exchange and its record was bought with its money,
 * and counting only from the record lost all of it (round 2, В3). What was bought later on the day
 * of such an exchange is lost instead: the day has no hours to tell before from after.
 */
function spentFrom(exchange: Exchange): Date {
  const endOfDay = new Date(yerevanMidnight(exchange.exchangedOn).getTime() + DAY_MS)
  return exchange.createdAt < endOfDay ? exchange.createdAt : endOfDay
}

/**
 * «Обмен денег» whole (MOL-40, MOL-42): the preference, the pair a trip started today would convert
 * by, the wallet of that pair and the cost of every other currency held by exchange as of today,
 * the hints for the next exchange into each currency, and every exchange, newest first. Everything
 * a figure on the screen is comes from here — the phone divides nothing.
 *
 * The cache of official rates is read once for every day of the list: the same rows compare each
 * exchange with the bank and value money whose cost nobody named.
 */
export async function exchangesOverview(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  const { exchanges } = repositories
  const today = yerevanDate(now)
  const [{ preference, since }, list] = await Promise.all([
    exchanges.rateSettings(owner.id),
    exchanges.list(owner.id),
  ])
  const cached = await officialRatesOn(
    repositories,
    list.map(({ exchangedOn }) => exchangedOn),
  )

  const base = owner.incomeCurrency
  const quote = owner.spendCurrency
  const pair = base === quote ? null : { base, quote }
  const baseSince = sinceDay(since)
  const officialOf = officialRateOf(cached, base)
  const wallet = pair ? walletRate(list, base, quote, today, officialOf, baseSince) : null
  const costs = currencyCosts(list, base, today, officialOf, baseSince).filter(
    ({ rate }) => rate.quote !== quote,
  )

  const received = [...new Set(list.map((exchange) => exchange.received.currency))].filter(
    (currency) => currency !== base,
  )
  const heldEstimates = await Promise.all(
    received.map(async (currency) => {
      const last = lastReceipt(list, currency, today)
      if (!last) return null
      return heldEstimate(
        list,
        last,
        await exchanges.spentSince(owner.id, currency, spentFrom(last)),
      )
    }),
  )

  return {
    preference,
    pair,
    wallet,
    costs,
    heldEstimates: heldEstimates.filter((estimate) => estimate !== null),
    baseSince,
    exchanges: viewsOf(list, cached),
  }
}

/**
 * «Записать обмен». The day is the person's to name, but not a day that has not come yet in
 * Yerevan: a rate from tomorrow would enter today's trips (the same line «not from the future»
 * draws for an official rate). 201 for a new exchange, and the screen whole either way.
 */
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

export async function recordExchange(
  repositories: Repositories,
  owner: Owner,
  body: ExchangeBody,
  now: Date = new Date(),
): Promise<{ overview: ExchangesResponse; created: boolean }> {
  if (body.exchangedOn > yerevanDate(now)) throw new DomainError(ERROR.EXCHANGE_IN_FUTURE)
  await repositories.exchanges.purgeRemoved(owner.id)
  const { created } = await repositories.exchanges.add(owner.id, body)
  return { overview: await exchangesOverview(repositories, owner, now), created }
}

/**
 * «Удалить обмен» (Р-4): no amending, a wrong exchange is removed and entered again. Trips
 * already started keep the rate they took; only trips from now on see the wallet without it.
 * Removed and not yet final: the one removed before it is, since only the latest is offered back
 * — but never this one, when the removal is sent again after a lost answer (round 3, Д2).
 */
export async function removeExchange(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id, id)
  await repositories.exchanges.remove(owner.id, id)
  return exchangesOverview(repositories, owner, now)
}

/**
 * «Вернуть» (В-5): the removed exchange as it was, `created_at` included. Again after a lost answer
 * it is the same success. Nothing to bring back — already final, or someone else's — answers as a
 * missing row does.
 */
export async function restoreExchange(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  if (!(await repositories.exchanges.restore(owner.id, id))) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  return exchangesOverview(repositories, owner, now)
}

/** «Мой / Официальный» (В-3): for trips from now on. */
export async function chooseRatePreference(
  repositories: Repositories,
  owner: Owner,
  preference: RatePreference,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.purgeRemoved(owner.id)
  await repositories.exchanges.setPreference(owner.id, preference)
  return exchangesOverview(repositories, owner, now)
}
