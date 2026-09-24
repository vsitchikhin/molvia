import {
  DomainError,
  ERROR,
  exchangeRateOf,
  heldEstimate,
  officialDifference,
  pickOfficialRate,
  walletRate,
  yerevanDate,
  yerevanMidnight,
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
 * asked once per day of the list, not once per exchange.
 */
async function viewsOf(
  { rates }: Pick<Repositories, 'rates'>,
  exchanges: readonly Exchange[],
): Promise<ExchangeView[]> {
  const cached = new Map<string, Awaited<ReturnType<typeof rates.latestOnOrBefore>>>()
  const views: ExchangeView[] = []
  for (const exchange of [...exchanges].reverse()) {
    const { given, received, exchangedOn } = exchange
    const key = `${exchangedOn}:${given.currency}:${received.currency}`
    let rows = cached.get(key)
    if (!rows) {
      rows = await rates.latestOnOrBefore(foreign(given.currency, received.currency), exchangedOn)
      cached.set(key, rows)
    }
    const official = pickOfficialRate(given.currency, received.currency, rows, exchangedOn)
    const difference = official ? officialDifference(exchange, official.rate) : null
    views.push({
      id: exchange.id,
      exchangedOn,
      given,
      received,
      heldBefore: exchange.heldBefore,
      rate: exchangeRateOf(exchange),
      official:
        official && difference
          ? { rate: official.rate, provider: official.provider, difference }
          : null,
    })
  }
  return views
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
  const held = last
    ? heldEstimate(
        last,
        await exchanges.spentSince(owner.id, quote, yerevanMidnight(last.exchangedOn)),
      )
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
