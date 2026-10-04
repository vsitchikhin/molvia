import {
  HOME_BANK,
  RATE_JUMP_HISTORY,
  RATE_JUMP_MIN_HISTORY,
  isRateFresh,
  isRateJump,
  yerevanDate,
  describeFailure,
} from '@molvia/model'
import type { AmdRate, CachedRate, RateProvider } from '@molvia/model'
import type { PastRate, RateRepository } from '@/db/rates-repository'
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

/**
 * How many days of a country bank's archive one run asks for (MOL-110, Р-5): the archive answers one
 * day a request, some 0,4 s each, and the market waits behind the official refresh in the same run —
 * so the two years since 2022 come in over some fifteen hourly runs, not in one of twelve minutes.
 */
export const ARCHIVE_DAYS_PER_RUN = 120

/**
 * A stretch of the archive longer than this with no day of the bank's is a hole to walk again: no
 * holiday of a central bank is so long — the National Bank of Georgia's longest, the first week of
 * January, is six days.
 */
export const ARCHIVE_GAP_DAYS = 10

/** With no hole, how far back the daily walk still looks: a failed week closes itself. */
export const ARCHIVE_RECENT_DAYS = 31

const DAY_MS = 24 * 60 * 60 * 1000

function dayAfter(day: string, days = 1): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
}

/**
 * The first day the archive of a country bank is walked from (MOL-110, Р-5), given the days of it
 * the cache holds: the start of the history while the cache's first day is far from it, the day
 * after the first hole — so a walk cut short by `ARCHIVE_DAYS_PER_RUN` or by a failure goes on
 * where it stopped — and with no hole, the last month.
 */
export function archiveWalkFrom(kept: readonly string[], from: string, today: string): string {
  const days = [...new Set(kept)].filter((day) => day >= from && day <= today).sort()
  const [first] = days
  if (first === undefined || daysBetween(from, first) > ARCHIVE_GAP_DAYS) return from
  for (const [index, day] of days.entries()) {
    const next = days[index + 1] ?? today
    if (daysBetween(day, next) > ARCHIVE_GAP_DAYS) return dayAfter(day)
  }
  const recent = dayAfter(today, -ARCHIVE_RECENT_DAYS)
  return recent > from ? recent : from
}

/**
 * The central banks whose own rate is a pair's official one: the Central Bank of Armenia and the
 * country banks of `HOME_BANK` (MOL-110). Each is measured for a jump by its own rates alone.
 */
const HOME_BANKS: ReadonlySet<RateProvider> = new Set(['cba', ...Object.values(HOME_BANK)])

export interface RefreshLog {
  warn(details: object, message: string): void
}

/** The central bank's archive of its official rate — asked for the whole history at once. */
export interface RateHistoryFeed {
  fetchRange(from: string, to: string): Promise<readonly AmdRate[]>
}

/**
 * A country's own central bank (MOL-110): asked every hour beside the Central Bank of Armenia, its
 * archive walked a day a request — the National Bank of Georgia answers any day with the rate in
 * force on it, and no range.
 */
export interface HomeBankFeed extends RateFeed {
  fetchOn(date: string): Promise<Published>
}

export interface RefreshDeps {
  /** The Central Bank of Armenia — asked first on every refresh, whatever happened before. */
  readonly primary: RateFeed
  /** Open sources in order of trust: the Bank of Russia, then the aggregator. */
  readonly fallbacks: readonly RateFeed[]
  /** The country banks of `HOME_BANK`, asked every hour, whatever the others did (MOL-110). */
  readonly homeBanks?: readonly HomeBankFeed[]
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
  homeBanks = [],
  rates,
  log,
  now = () => new Date(),
  history,
}: RefreshDeps): () => Promise<void> {
  let failures = 0
  let historyAt: number | null = null
  /** When each country bank's archive was last walked through to today, or last failed. */
  const archiveAt = new Map<RateProvider, number>()
  /**
   * Where a walk cut short by `ARCHIVE_DAYS_PER_RUN` goes on: the day after the last one asked. The
   * cache cannot say it — a Sunday asked is written as the Saturday it answers with, and the walk
   * would ask the Sunday again.
   */
  const archiveNext = new Map<RateProvider, string>()

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
   * A country bank's archive (MOL-110, Р-5), a day a request from `archiveWalkFrom`, at most
   * `ARCHIVE_DAYS_PER_RUN` of them: only the days the cache lacks are written, each judged for a
   * jump among the bank's own as `missingDays` judges the central bank's. Walked through to today,
   * it is walked again a day later, the last month only; cut short, the next run goes on; a failure
   * is a line in the log and is asked again in six hours, as the central bank's archive is.
   */
  async function walkArchive(bank: HomeBankFeed, today: string): Promise<void> {
    if (!history) return
    const at = archiveAt.get(bank.provider)
    if (at !== undefined && now().getTime() - at < HISTORY_EVERY_MS) return
    try {
      const kept = await history.rates.between(bank.provider, OFFICIAL_HISTORY_FROM, today)
      const start =
        archiveNext.get(bank.provider) ??
        archiveWalkFrom(
          kept.map((row) => row.date),
          OFFICIAL_HISTORY_FROM,
          today,
        )
      const days: string[] = []
      for (
        let day = start;
        day <= today && days.length < ARCHIVE_DAYS_PER_RUN;
        day = dayAfter(day)
      ) {
        days.push(day)
      }
      const answers = new Map<string, readonly AmdRate[]>()
      for (const day of days) {
        const answer = await bank.fetchOn(day)
        // Tomorrow is a bank setting its rate the evening before — the hourly answer writes it; past
        // tomorrow is the archive being wrong (Р-25), and refuses the walk.
        if (answer.date > today) {
          if (isRateFresh(answer.date, today)) continue
          throw new FeedError(bank.provider, `archive: ${answer.date} is in the future`)
        }
        answers.set(answer.date, answer.rates)
      }
      const missing = missingDays([...answers.values()].flat(), kept)
      for (const rate of missing.filter((row) => row.jump)) {
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
      await history.rates.insertMissing(missing)
      const last = days.at(-1)
      if (last === undefined || last >= today) {
        archiveNext.delete(bank.provider)
        archiveAt.set(bank.provider, now().getTime())
      } else {
        archiveNext.set(bank.provider, dayAfter(last))
        archiveAt.delete(bank.provider)
      }
    } catch (error) {
      archiveNext.delete(bank.provider)
      archiveAt.set(bank.provider, now().getTime() - HISTORY_EVERY_MS + HISTORY_RETRY_MS)
      log.warn(
        {
          provider: bank.provider,
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
      // The feed's own words, or the kind alone (MOL-153): the cause a deploy needs (MOL-39, С-2)
      // is a `FeedError` already — `reach` words a request with no answer by its `cause`.
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
   * What a new rate is measured against for a jump (Р-19, Р-22). A central bank whose rate is a
   * pair's official one — the Central Bank of Armenia, a country bank of `HOME_BANK` — by its own
   * latest rates. An open source is asked only while the central bank is silent, so its own
   * history is an earlier episode, often months old — or nothing, exactly when a trip is about to
   * take it: without three of its own from the last week, it is measured against the central
   * bank's latest, in the same unit.
   */
  async function referenceFor(answer: Published): Promise<ReadonlyMap<string, readonly bigint[]>> {
    const currencies = answer.rates.map((rate) => rate.currency)
    const own = await rates.history(answer.provider, currencies, answer.date)
    const home = HOME_BANKS.has(answer.provider)
    const central = home ? own : await rates.history('cba', currencies, answer.date)
    const values = (past: readonly PastRate[] | undefined) => (past ?? []).map((row) => row.scaled)

    return new Map(
      currencies.map((currency) => {
        if (home) return [currency, values(own.get(currency))]
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

    // A country bank is asked whatever the central bank did: it is the official source of its own
    // pairs, and nothing stands in for it but the others' rows already in the cache (MOL-110, Р-4).
    for (const bank of homeBanks) {
      const answer = await fetchFrom(bank, today, null)
      if (answer) await store(answer)
      await walkArchive(bank, today)
    }

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
