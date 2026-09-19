import { and, inArray, lte, max, sql } from 'drizzle-orm'
import type { AmdRate } from '@molvia/model'
import type { Conn } from './index'
import { officialRates } from './schema'

export interface RateRepository {
  /**
   * What a provider published, written whole: one statement, so a response is in the cache
   * entirely or not at all. A day already there is overwritten — the cache mirrors its
   * provider, and a trip that took the old number keeps it in its own columns (MOL-39, Р-8).
   */
  upsert(rates: readonly AmdRate[]): Promise<void>

  /**
   * The latest row of every provider for each of `currencies`, dated no later than `date`.
   * Which provider a trip takes is the domain's rule (`pickOfficialRate`), not a query's.
   */
  latestOnOrBefore(
    currencies: readonly AmdRate['currency'][],
    date: string,
  ): Promise<readonly AmdRate[]>

  /** When any provider's answer was last written — whether the boot refresh can be skipped. */
  lastFetchedAt(): Promise<Date | null>
}

export function createRateRepository(db: Conn): RateRepository {
  return {
    async upsert(rates) {
      if (rates.length === 0) return
      await db
        .insert(officialRates)
        .values(
          rates.map((rate) => ({
            provider: rate.provider,
            currency: rate.currency,
            rateDate: rate.date,
            scaled: rate.scaled,
          })),
        )
        .onConflictDoUpdate({
          target: [officialRates.provider, officialRates.currency, officialRates.rateDate],
          set: { scaled: sql`excluded.scaled`, fetchedAt: sql`now()` },
        })
    },

    async latestOnOrBefore(currencies, date) {
      if (currencies.length === 0) return []
      const rows = await db
        .selectDistinctOn([officialRates.provider, officialRates.currency])
        .from(officialRates)
        .where(
          and(inArray(officialRates.currency, [...currencies]), lte(officialRates.rateDate, date)),
        )
        .orderBy(
          officialRates.provider,
          officialRates.currency,
          sql`${officialRates.rateDate} desc`,
        )
      return rows.map((row) => ({
        provider: row.provider,
        currency: row.currency,
        date: row.rateDate,
        scaled: row.scaled,
      }))
    },

    async lastFetchedAt() {
      const [row] = await db.select({ at: max(officialRates.fetchedAt) }).from(officialRates)
      return row?.at ?? null
    },
  }
}
