import { PUBLISHED, RATE_MAX, RATE_MIN, currencySchema, isRateDay } from '@molvia/model'
import type { AmdRate, RateProvider } from '@molvia/model'

/** What one provider published in one answer: every currency it publishes (`PUBLISHED`), for one day. */
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

/**
 * Every currency but the dram — what the cache is read for, whatever provider quotes it. Taken from
 * the schema, as the table's CHECK is. What each provider is asked for is its own set, `PUBLISHED`
 * (MOL-230): a currency added to the schema and to a provider's set there is asked of it, rather
 * than accepted by the cache and silently never fetched.
 */
export const FOREIGN: readonly AmdRate['currency'][] = currencySchema.options.filter(
  (currency): currency is AmdRate['currency'] => currency !== 'AMD',
)

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
 * Checks a parsed answer the same way for every provider, against the currencies it publishes
 * (`PUBLISHED`, MOL-230): the Central Bank of Armenia has no dinar, and that is not a gap. Strict on
 * purpose: a partial write is worse than none — half the currencies «fresh» and half silently
 * yesterday's — so one missing or implausible currency of its own refuses the whole answer.
 */
export function published(
  provider: RateProvider,
  date: string,
  scaled: ReadonlyMap<string, bigint | null>,
): Published {
  if (!isRateDay(date)) throw new FeedError(provider, `unreadable date ${JSON.stringify(date)}`)
  const rates = PUBLISHED[provider].map((currency): AmdRate => {
    const value = scaled.get(currency)
    if (value === undefined) throw new FeedError(provider, `no ${currency}`)
    if (value === null || value < RATE_MIN || value > RATE_MAX) {
      throw new FeedError(provider, `implausible ${currency}`)
    }
    return { provider, currency, date, scaled: value }
  })
  return { provider, date, rates }
}

/**
 * Why a request got no answer at all, in the words of Node's `fetch` (MOL-153): they speak of a
 * public address the server asked, never of a person, so they are the feed's own words. The reason
 * is in `cause`, and not always as a code — `redirect count exceeded` has only its message, and a
 * refused connection to `localhost` only its code, under an `AggregateError` with no message.
 */
function unanswered(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
  if (!(cause instanceof Error)) return 'no answer'
  const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : ''
  return cause.message || code || cause.name
}

/** `fetch` with the timeout every feed shares; a request with no answer is the provider down. */
export async function reach(
  provider: RateProvider,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
  } catch (error) {
    throw new FeedError(provider, unanswered(error))
  }
}

/** `reach`, and anything but 200 is the provider being down too. */
export async function request(
  provider: RateProvider,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await reach(provider, url, init)
  if (!response.ok) throw new FeedError(provider, `HTTP ${String(response.status)}`)
  return response
}
