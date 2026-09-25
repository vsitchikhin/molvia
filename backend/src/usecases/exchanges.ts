import {
  DomainError,
  ERROR,
  exchangeRateOf,
  heldEstimate,
  officialDifference,
  pickOfficialRate,
  walletRate,
  yerevanDate,
} from '@molvia/model'
import type {
  Actor,
  AmdRate,
  Currency,
  Exchange,
  ExchangeBody,
  ExchangeView,
  ExchangesResponse,
  RatePreference,
} from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<TripRepositories, 'exchanges' | 'rates'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

function foreign(...currencies: Currency[]): AmdRate['currency'][] {
  return currencies.filter((currency): currency is AmdRate['currency'] => currency !== 'AMD')
}

/**
 * One exchange as the list shows it, compared with the official rate of its own day — the rate a
 * trip started that day would have taken, by the same rule (`pickOfficialRate`). The cache is
 * asked once per day and pair of the list, all at once.
 *
 * A rate that jumped when it arrived is not a fact to measure an exchange by — it may be a comma
 * in the wrong place at the bank (MOL-39, Р-19): the rate before the jump is used when there is
 * one, and otherwise the comparison is withheld and the row says why (review С-5).
 */
async function viewsOf(
  { rates }: Pick<Repositories, 'rates'>,
  exchanges: readonly Exchange[],
): Promise<ExchangeView[]> {
  const keyOf = ({ given, received, exchangedOn }: Exchange) =>
    `${exchangedOn}:${given.currency}:${received.currency}`
  const distinct = new Map(exchanges.map((exchange) => [keyOf(exchange), exchange]))
  const cached = new Map(
    await Promise.all(
      [...distinct].map(
        async ([key, { given, received, exchangedOn }]) =>
          [
            key,
            await rates.latestOnOrBefore(foreign(given.currency, received.currency), exchangedOn),
          ] as const,
      ),
    ),
  )

  return [...exchanges].reverse().map((exchange): ExchangeView => {
    const { given, received, exchangedOn } = exchange
    const official = pickOfficialRate(
      given.currency,
      received.currency,
      cached.get(keyOf(exchange)) ?? [],
      exchangedOn,
    )
    const measure = official?.jumped ? official.previous : (official?.rate ?? null)
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

/**
 * «Обмен денег» whole (MOL-40): the preference, the pair a trip started today would convert by,
 * the wallet of that pair as of today, the hint for its next exchange, and every exchange, newest
 * first. Everything a figure on the screen is comes from here — the phone divides nothing.
 */
export async function exchangesOverview(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  const { exchanges } = repositories
  const today = yerevanDate(now)
  const [preference, list] = await Promise.all([
    exchanges.preference(owner.id),
    exchanges.list(owner.id),
  ])

  const base = owner.incomeCurrency
  const quote = owner.spendCurrency
  const pair = base === quote ? null : { base, quote }
  const wallet = pair ? walletRate(list, base, quote, today) : null

  // The list is in the order the wallet walks it, so the last of the pair is the latest one.
  const last = pair
    ? list.findLast(
        (exchange) =>
          exchange.given.currency === base &&
          exchange.received.currency === quote &&
          exchange.exchangedOn <= today,
      )
    : undefined
  // From the moment the exchange was written, not from the midnight of its day: a purchase that
  // morning was paid with the money held before, which `heldBefore` already names (А4).
  const held = last
    ? heldEstimate(last, await exchanges.spentSince(owner.id, quote, last.createdAt))
    : null

  return {
    preference,
    pair,
    wallet,
    heldEstimate: held,
    exchanges: await viewsOf(repositories, list),
  }
}

/**
 * «Записать обмен». The day is the person's to name, but not a day that has not come yet in
 * Yerevan: a rate from tomorrow would enter today's trips (the same line «not from the future»
 * draws for an official rate). 201 for a new exchange, and the screen whole either way.
 */
export async function recordExchange(
  repositories: Repositories,
  owner: Owner,
  body: ExchangeBody,
  now: Date = new Date(),
): Promise<{ overview: ExchangesResponse; created: boolean }> {
  if (body.exchangedOn > yerevanDate(now)) throw new DomainError(ERROR.EXCHANGE_IN_FUTURE)
  const { created } = await repositories.exchanges.add(owner.id, body)
  return { overview: await exchangesOverview(repositories, owner, now), created }
}

/**
 * «Удалить обмен» (Р-4): no amending, a wrong exchange is removed and entered again. Trips
 * already started keep the rate they took; only trips from now on see the wallet without it.
 */
export async function removeExchange(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.remove(owner.id, id)
  return exchangesOverview(repositories, owner, now)
}

/** «Мой / Официальный» (В-3): for trips from now on. */
export async function chooseRatePreference(
  repositories: Repositories,
  owner: Owner,
  preference: RatePreference,
  now: Date = new Date(),
): Promise<ExchangesResponse> {
  await repositories.exchanges.setPreference(owner.id, preference)
  return exchangesOverview(repositories, owner, now)
}
