import { RATE_MAX, RATE_MIN } from '@molvia/model'
import type { AmdRate, RateProvider } from '@molvia/model'

/** What one provider published in one answer: every currency the product holds, for one day. */
export interface Published {
  readonly provider: RateProvider
  readonly date: string
  readonly rates: readonly AmdRate[]
}

/** A provider the refresh can ask. It throws on anything it cannot read whole (MOL-39, Р-4). */
export interface RateFeed {
  readonly provider: RateProvider
  fetchLatest(): Promise<Published>
}

/** Every currency but the dram — the rates are against it, so it has no row of its own. */
export const FOREIGN: readonly AmdRate['currency'][] = ['RUB', 'USD', 'EUR']

/**
 * A provider slower than this is down, as far as an hourly refresh cares. Generous because
 * nobody waits on it — the trip reads the cache — and the Central Bank of Armenia took six
 * seconds to answer on 19.09.2026.
 */
export const FEED_TIMEOUT_MS = 30_000

export class FeedError extends Error {
  constructor(provider: RateProvider, reason: string) {
    super(`${provider}: ${reason}`)
    this.name = 'FeedError'
  }
}

/**
 * Checks a parsed answer the same way for every provider. Strict on purpose: a partial write is
 * worse than none — half the currencies «fresh» and half silently yesterday's — so one missing
 * or implausible currency refuses the whole answer.
 */
export function published(
  provider: RateProvider,
  date: string,
  scaled: ReadonlyMap<string, bigint | null>,
): Published {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new FeedError(provider, `unreadable date ${JSON.stringify(date)}`)
  }
  const rates = FOREIGN.map((currency): AmdRate => {
    const value = scaled.get(currency)
    if (value === undefined) throw new FeedError(provider, `no ${currency}`)
    if (value === null || value < RATE_MIN || value > RATE_MAX) {
      throw new FeedError(provider, `implausible ${currency}`)
    }
    return { provider, currency, date, scaled: value }
  })
  return { provider, date, rates }
}

/** `fetch` with the timeout every feed shares; anything but 200 is the provider being down. */
export async function request(
  provider: RateProvider,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
  if (!response.ok) throw new FeedError(provider, `HTTP ${String(response.status)}`)
  return response
}
