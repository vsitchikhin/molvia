import type { RateRepository } from '@/db/rates-repository'
import type { RateFeed } from '@/rates/feed'

/**
 * How many times in a row the Central Bank of Armenia may fail before the open sources are asked
 * too (MOL-39, В-7): at an hourly refresh, about five hours of silence. The count is in memory, so
 * a restart starts it again — the trip waits a week before it takes a fallback anyway.
 */
export const FALLBACK_AFTER_FAILURES = 5

export interface RefreshLog {
  warn(details: object, message: string): void
}

export interface RefreshDeps {
  /** The Central Bank of Armenia — asked first on every refresh, whatever happened before. */
  readonly primary: RateFeed
  /** Open sources in order of trust; the first to answer is written and the rest are not asked. */
  readonly fallbacks: readonly RateFeed[]
  readonly rates: Pick<RateRepository, 'upsert'>
  readonly log: RefreshLog
}

/**
 * The refresh the schedule runs. Returns one run of it, holding the count of the central bank's
 * failures between runs. A run never throws: a server without a fresh rate still serves — the
 * trip takes the last one with its date — so a failure is a line in the log and nothing more.
 */
export function officialRatesRefresh({
  primary,
  fallbacks,
  rates,
  log,
}: RefreshDeps): () => Promise<void> {
  let failures = 0

  async function take(feed: RateFeed): Promise<boolean> {
    try {
      const answer = await feed.fetchLatest()
      await rates.upsert(answer.rates)
      return true
    } catch (error) {
      log.warn({ provider: feed.provider, error: String(error) }, 'official rate refresh failed')
      return false
    }
  }

  return async () => {
    if (await take(primary)) {
      failures = 0
      return
    }
    failures += 1
    if (failures <= FALLBACK_AFTER_FAILURES) return

    for (const fallback of fallbacks) {
      if (await take(fallback)) return
    }
  }
}
