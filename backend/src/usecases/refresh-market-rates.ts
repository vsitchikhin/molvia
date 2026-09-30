import {
  OFFICIAL_RATE_FRESH_DAYS,
  isMarketPlausible,
  isRateFresh,
  yerevanDate,
} from '@molvia/model'
import type { CachedRate, MarketRate } from '@molvia/model'
import { describeFailure } from '@/db/failure'
import type { MarketRateRepository } from '@/db/market-rates-repository'
import type { RateRepository } from '@/db/rates-repository'
import type { MarketFile } from '@/rates/cba-market'
import { FeedError } from '@/rates/feed'
import type { RefreshLog } from './refresh-official-rates'

export interface MarketRefreshDeps {
  readonly files: readonly MarketFile[]
  readonly market: Pick<MarketRateRepository, 'upsert'>
  readonly rates: Pick<RateRepository, 'between'>
  readonly log: RefreshLog
  readonly now?: () => Date
}

const DAY_MS = 24 * 60 * 60 * 1000

function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(day) - days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The official rate each market figure is held against: the central bank's latest of that currency
 * on or before the figure's day, fresh for it. Null when the cache has none — a day of the history
 * older than the official one kept — and then the header of the file is what vouches for it.
 */
function officialOn(
  byCurrency: ReadonlyMap<string, readonly CachedRate[]>,
  rate: MarketRate,
): bigint | null {
  const rows = byCurrency.get(rate.currency) ?? []
  // The last row dated no later than the figure: rows are oldest first.
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((rows[middle]?.date ?? '') <= rate.date) low = middle + 1
    else high = middle
  }
  const found = rows[low - 1]
  return found && isRateFresh(found.date, rate.date) ? found.scaled : null
}

/**
 * Why a file's figures are not to be written, or null (MOL-137, Р-7): a day after today, or a figure
 * over fifteen percent from the official rate of its day — a column that moved.
 */
function refusal(
  rates: readonly MarketRate[],
  official: readonly CachedRate[],
  today: string,
): object | null {
  const byCurrency = new Map<string, CachedRate[]>()
  for (const row of official) {
    const rows = byCurrency.get(row.currency) ?? []
    rows.push(row)
    byCurrency.set(row.currency, rows)
  }
  for (const rate of rates) {
    if (rate.date > today) return { reason: 'dated in the future', date: rate.date }
    const measure = officialOn(byCurrency, rate)
    if (measure !== null && !isMarketPlausible(rate.scaled, measure)) {
      return {
        reason: 'far from the official rate',
        channel: rate.channel,
        currency: rate.currency,
        date: rate.date,
        side: rate.side,
      }
    }
  }
  return null
}

/**
 * The refresh of the market (MOL-137), run in the hour of the official one and after it, so a
 * figure of today is held against today's official rate. Each file on its own: asked only if it
 * changed since it was last written, refused whole when anything in it is not where it should be,
 * written whole otherwise. A run never throws — the market is only something to compare with, and
 * a file that failed is a line in the log and the old figures kept.
 *
 * The tag of a file is remembered only once it is written: a refused file is asked for again the
 * next hour, and a fix at the bank's end is picked up without a restart.
 */
export function marketRatesRefresh({
  files,
  market,
  rates,
  log,
  now = () => new Date(),
}: MarketRefreshDeps): () => Promise<void> {
  const tags = new Map<string, string | null>()

  return async () => {
    const today = yerevanDate(now())
    for (const file of files) {
      try {
        const answer = await file.fetch(tags.get(file.name) ?? null)
        if (answer === 'unchanged') continue
        const days = answer.rates.map((rate) => rate.date).sort()
        const [first = today] = days
        const official = await rates.between(
          'cba',
          daysBefore(first, OFFICIAL_RATE_FRESH_DAYS),
          today,
        )
        const refused = refusal(answer.rates, official, today)
        if (refused) {
          log.warn({ file: file.name, ...refused }, 'market rates refused')
          continue
        }
        await market.upsert(answer.rates)
        tags.set(file.name, answer.etag)
      } catch (error) {
        // A feed's own words name a cell of a public file; anything else is described by its kind
        // only, as every failure is (privacy.md).
        log.warn(
          {
            file: file.name,
            ...(error instanceof FeedError ? { reason: error.message } : describeFailure(error)),
          },
          'market rates failed',
        )
      }
    }
  }
}
