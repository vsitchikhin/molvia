import { isRateFresh, yerevanDate } from '@molvia/model'
import type { RateRepository } from '@/db/rates-repository'
import { FOREIGN } from '@/rates/feed'
import type { Published, RateFeed } from '@/rates/feed'

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
  /** Open sources in order of trust: the Bank of Russia, then the aggregator. */
  readonly fallbacks: readonly RateFeed[]
  readonly rates: Pick<RateRepository, 'upsert' | 'latestOnOrBefore'>
  readonly log: RefreshLog
  readonly now?: () => Date
}

/**
 * The refresh the schedule runs. Returns one run of it, holding the count of the central bank's
 * failures between runs. A run never throws: a server without a fresh rate still serves — the
 * trip takes the last one with its date — so a failure is a line in the log and nothing more.
 *
 * The open sources are asked when the central bank is silent, and silent has two faces (MOL-39,
 * Р-18): it fails more than five times in a row, or it answers with a rate over a week old — a
 * service that hangs on its last date looks exactly like one that is fine. Each open source that
 * answers is written; the next is asked only if this one failed or is as stale.
 */
export function officialRatesRefresh({
  primary,
  fallbacks,
  rates,
  log,
  now = () => new Date(),
}: RefreshDeps): () => Promise<void> {
  let failures = 0

  /** The provider's answer, or null — its failure logged, with how old the cache already is. */
  async function fetchFrom(feed: RateFeed, lastKnown: string | null): Promise<Published | null> {
    try {
      return await feed.fetchLatest()
    } catch (error) {
      log.warn({ provider: feed.provider, err: error, lastKnown }, 'official rate fetch failed')
      return null
    }
  }

  // A write that fails is the database's failure, not the provider's: it is logged as such and
  // does not count against the central bank (adversarial Г).
  async function store(answer: Published): Promise<void> {
    try {
      await rates.upsert(answer.rates)
    } catch (error) {
      log.warn({ provider: answer.provider, err: error }, 'official rate cache write failed')
    }
  }

  async function lastCentralDate(today: string): Promise<string | null> {
    try {
      const rows = await rates.latestOnOrBefore(FOREIGN, today)
      const dates = rows.filter((row) => row.provider === 'cba').map((row) => row.date)
      return dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b))
    } catch {
      return null
    }
  }

  return async () => {
    const today = yerevanDate(now())
    const lastKnown = await lastCentralDate(today)

    const central = await fetchFrom(primary, lastKnown)
    if (central) {
      failures = 0
      await store(central)
    } else {
      failures += 1
    }

    const centralDate = central?.date ?? lastKnown
    const stale = centralDate !== null && !isRateFresh(centralDate, today)
    if (failures <= FALLBACK_AFTER_FAILURES && !stale) return

    for (const fallback of fallbacks) {
      const answer = await fetchFrom(fallback, lastKnown)
      if (!answer) continue
      await store(answer)
      if (isRateFresh(answer.date, today)) return
    }
  }
}
