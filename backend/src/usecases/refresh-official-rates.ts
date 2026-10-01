import {
  RATE_JUMP_HISTORY,
  RATE_JUMP_MIN_HISTORY,
  isRateFresh,
  isRateJump,
  yerevanDate,
} from '@molvia/model'
import type { AmdRate, CachedRate } from '@molvia/model'
import type { PastRate, RateRepository } from '@/db/rates-repository'
import { describeFailure } from '@/db/failure'
import { FOREIGN, FeedError } from '@/rates/feed'
import type { Published, RateFeed } from '@/rates/feed'

/**
 * How many times in a row the Central Bank of Armenia may fail before the open sources are asked
 * too (MOL-39, В-7): at an hourly refresh, about five hours of silence. The count is in memory, so
 * a restart starts it again — the trip waits a week before it takes a fallback anyway.
 */
export const FALLBACK_AFTER_FAILURES = 5

/**
 * Where the central bank's history is filled from (MOL-137, Р-4): the first working day of 2022,
 * the first day of the market's own history, so an exchange as old as the market has an official
 * rate beside it too.
 */
export const OFFICIAL_HISTORY_FROM = '2022-01-01'

/** How often the history is asked again: the holes a failure leaves are closed within a day. */
export const HISTORY_EVERY_MS = 24 * 60 * 60 * 1000

/**
 * After a failed history, how long until it is asked again: not the next hour — a refusal of the
 * archive's content stays a refusal, and the whole archive is half a megabyte (review, minor 3).
 */
export const HISTORY_RETRY_MS = 6 * 60 * 60 * 1000

export interface RefreshLog {
  warn(details: object, message: string): void
}

/** The central bank's archive of its official rate — asked for the whole history at once. */
export interface RateHistoryFeed {
  fetchRange(from: string, to: string): Promise<readonly AmdRate[]>
}

export interface RefreshDeps {
  /** The Central Bank of Armenia — asked first on every refresh, whatever happened before. */
  readonly primary: RateFeed
  /** Open sources in order of trust: the Bank of Russia, then the aggregator. */
  readonly fallbacks: readonly RateFeed[]
  readonly rates: Pick<RateRepository, 'upsert' | 'latestOnOrBefore' | 'history'>
  readonly log: RefreshLog
  readonly now?: () => Date
  /** The archive to fill the cache's past from (MOL-137); none, and only the latest is asked. */
  readonly history?: {
    readonly feed: RateHistoryFeed
    readonly rates: Pick<RateRepository, 'insertMissing' | 'between'>
  }
}

/**
 * The days of `archive` the cache does not have, each judged for a jump as it would have been had
 * it arrived on its day: against the central bank's rates before it — kept and new together — in
 * the order of the days (MOL-137, Р-4). A day the cache has is left as it is.
 */
export function missingDays(
  archive: readonly AmdRate[],
  kept: readonly CachedRate[],
): CachedRate[] {
  const have = new Set(kept.map((row) => `${row.currency} ${row.date}`))
  const byCurrency = new Map<string, { date: string; scaled: bigint; fresh: AmdRate | null }[]>()
  for (const row of kept) {
    const rows = byCurrency.get(row.currency) ?? []
    rows.push({ date: row.date, scaled: row.scaled, fresh: null })
    byCurrency.set(row.currency, rows)
  }
  for (const rate of archive) {
    if (have.has(`${rate.currency} ${rate.date}`)) continue
    const rows = byCurrency.get(rate.currency) ?? []
    rows.push({ date: rate.date, scaled: rate.scaled, fresh: rate })
    byCurrency.set(rate.currency, rows)
  }
  const missing: CachedRate[] = []
  for (const rows of byCurrency.values()) {
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    rows.forEach((row, index) => {
      if (!row.fresh) return
      const before = rows
        .slice(Math.max(0, index - RATE_JUMP_HISTORY), index)
        .reverse()
        .map((earlier) => earlier.scaled)
      missing.push({ ...row.fresh, jump: isRateJump(row.scaled, before) })
    })
  }
  return missing
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
  history,
}: RefreshDeps): () => Promise<void> {
  let failures = 0
  let historyAt: number | null = null

  /**
   * The history, once a day (MOL-137, Р-4): the whole archive since 2022 in one answer — a fifth
   * of a second for two years, measured — and only the days the cache lacks written. A failure is
   * a line in the log, and the next hour asks again.
   */
  async function fillHistory(today: string): Promise<void> {
    if (!history) return
    if (historyAt !== null && now().getTime() - historyAt < HISTORY_EVERY_MS) return
    try {
      const archive = await history.feed.fetchRange(OFFICIAL_HISTORY_FROM, today)
      // A refusal like any other: logged by the catch and asked again in six hours (review П-4).
      const future = archive.find((rate) => rate.date > today)
      if (future) throw new FeedError('cba', `range: ${future.date} is in the future`)
      const kept = await history.rates.between('cba', OFFICIAL_HISTORY_FROM, today)
      const missing = missingDays(archive, kept)
      for (const rate of missing.filter((row) => row.jump)) {
        log.warn(
          {
            provider: 'cba',
            currency: rate.currency,
            date: rate.date,
            scaled: String(rate.scaled),
          },
          'official rate jumped',
        )
      }
      await history.rates.insertMissing(missing)
      historyAt = now().getTime()
    } catch (error) {
      // Asked again in six hours rather than the next: see HISTORY_RETRY_MS.
      historyAt = now().getTime() - HISTORY_EVERY_MS + HISTORY_RETRY_MS
      // The feed's own words name a day of a public archive; a failure of the database is told by
      // its kind only (privacy.md).
      log.warn(
        {
          provider: 'cba',
          ...(error instanceof FeedError ? { reason: error.message } : describeFailure(error)),
        },
        'official history failed',
      )
    }
  }

  /**
   * The provider's answer, or null — its failure logged, with how old the cache already is. An
   * answer dated past tomorrow is a failure too (Р-25): `9999-12-31` is a .NET service's «no
   * date», it would look fresh for ever, and no trip could take it.
   */
  async function fetchFrom(
    feed: RateFeed,
    today: string,
    lastKnown: string | null,
  ): Promise<Published | null> {
    try {
      const answer = await feed.fetchLatest()
      if (answer.date > today && !isRateFresh(answer.date, today)) {
        log.warn(
          { provider: feed.provider, date: answer.date, lastKnown },
          'official rate dated in the future',
        )
        return null
      }
      return answer
    } catch (error) {
      // The feed's own words, or the kind alone: the cause a deploy needs (MOL-39, С-2) survives
      // as the driver's code — `ENOTFOUND`, `ECONNREFUSED`, `CERT_HAS_EXPIRED` (MOL-153).
      log.warn(
        {
          provider: feed.provider,
          lastKnown,
          ...(error instanceof FeedError ? { reason: error.message } : describeFailure(error)),
        },
        'official rate fetch failed',
      )
      return null
    }
  }

  /**
   * What a new rate is measured against for a jump (Р-19, Р-22). The central bank, by its own
   * latest rates. An open source is asked only while the central bank is silent, so its own
   * history is an earlier episode, often months old — or nothing, exactly when a trip is about to
   * take it: without three of its own from the last week, it is measured against the central
   * bank's latest, in the same unit.
   */
  async function referenceFor(answer: Published): Promise<ReadonlyMap<string, readonly bigint[]>> {
    const currencies = answer.rates.map((rate) => rate.currency)
    const own = await rates.history(answer.provider, currencies, answer.date)
    const central =
      answer.provider === 'cba' ? own : await rates.history('cba', currencies, answer.date)
    const values = (past: readonly PastRate[] | undefined) => (past ?? []).map((row) => row.scaled)

    return new Map(
      currencies.map((currency) => {
        if (answer.provider === 'cba') return [currency, values(own.get(currency))]
        const recent = (own.get(currency) ?? []).filter((row) => isRateFresh(row.date, answer.date))
        return [
          currency,
          recent.length >= RATE_JUMP_MIN_HISTORY ? values(recent) : values(central.get(currency)),
        ]
      }),
    )
  }

  // Each rate is marked when it jumped (Р-19): kept, since it may be true, and logged, since it
  // may be a comma in the wrong place. A write that fails is the database's failure, not the
  // provider's: logged as such, and not counted against the central bank (adversarial Г).
  async function store(answer: Published): Promise<void> {
    try {
      const reference = await referenceFor(answer)
      const marked = answer.rates.map((rate): CachedRate => ({
        ...rate,
        jump: isRateJump(rate.scaled, reference.get(rate.currency) ?? []),
      }))
      for (const rate of marked.filter((row) => row.jump)) {
        log.warn(
          {
            provider: rate.provider,
            currency: rate.currency,
            date: rate.date,
            scaled: String(rate.scaled),
          },
          'official rate jumped',
        )
      }
      await rates.upsert(marked)
    } catch (error) {
      // A `DrizzleQueryError` carries the query and its parameters: told by its kind (privacy.md).
      log.warn(
        { provider: answer.provider, ...describeFailure(error) },
        'official rate cache write failed',
      )
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

    const central = await fetchFrom(primary, today, lastKnown)
    if (central) {
      failures = 0
      await store(central)
    } else {
      failures += 1
    }
    await fillHistory(today)

    const centralDate = central?.date ?? lastKnown
    const stale = centralDate !== null && !isRateFresh(centralDate, today)
    if (failures <= FALLBACK_AFTER_FAILURES && !stale) return

    for (const fallback of fallbacks) {
      const answer = await fetchFrom(fallback, today, lastKnown)
      if (!answer) continue
      await store(answer)
      if (isRateFresh(answer.date, today)) return
    }
  }
}
